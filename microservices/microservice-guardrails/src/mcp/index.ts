#!/usr/bin/env bun
/**
 * MCP server for microservice-guardrails.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { addAllowlistEntry } from "../lib/allowlist.js";
import { checkInput, checkOutput } from "../lib/guard.js";
import { detectPromptInjection } from "../lib/injection.js";
import { scanPII } from "../lib/pii.js";
import { createPolicy, listPolicies } from "../lib/policy.js";
import { listViolations } from "../lib/violations.js";

const server = new McpServer({
  name: "microservice-guardrails",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

server.tool(
  "guardrails_check_input",
  "Check input text for prompt injection, PII, toxicity, and policy violations",
  {
    text: z.string().describe("Input text to check"),
    workspace_id: z.string().optional().describe("Optional workspace ID for policy evaluation"),
  },
  async ({ text: inputText, workspace_id }) =>
    text(await checkInput(sql, inputText, workspace_id)),
);

server.tool(
  "guardrails_check_output",
  "Check output text for PII (auto-redacted), toxicity, and policy violations",
  {
    text: z.string().describe("Output text to check"),
    workspace_id: z.string().optional().describe("Optional workspace ID for policy evaluation"),
  },
  async ({ text: outputText, workspace_id }) =>
    text(await checkOutput(sql, outputText, workspace_id)),
);

server.tool(
  "guardrails_scan_pii",
  "Scan text for PII (emails, phone numbers, SSNs, credit cards, IPs, etc.)",
  { text: z.string().describe("Text to scan for PII") },
  async ({ text: inputText }) => text({ matches: scanPII(inputText) }),
);

server.tool(
  "guardrails_detect_injection",
  "Detect prompt injection attempts in text",
  { text: z.string().describe("Text to check for injection") },
  async ({ text: inputText }) => text(detectPromptInjection(inputText)),
);

server.tool(
  "guardrails_create_policy",
  "Create a guardrails policy with rules for a workspace",
  {
    workspace_id: z.string(),
    name: z.string().describe("Policy name"),
    rules: z.array(z.object({
      type: z.enum(["block_words", "max_length", "require_format", "custom_regex"]),
      config: z.record(z.any()),
      action: z.enum(["block", "warn", "sanitize"]),
    })),
    active: z.boolean().optional().default(true),
  },
  async ({ workspace_id, name, rules, active }) =>
    text(await createPolicy(sql, workspace_id, name, rules as any, active)),
);

server.tool(
  "guardrails_list_policies",
  "List all guardrails policies for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await listPolicies(sql, workspace_id)),
);

server.tool(
  "guardrails_list_violations",
  "List guardrail violations with optional filters",
  {
    workspace_id: z.string().optional(),
    type: z.enum(["prompt_injection", "pii_detected", "policy_violation", "toxicity"]).optional(),
    severity: z.enum(["low", "medium", "high", "critical"]).optional(),
    limit: z.number().optional().default(50),
  },
  async (opts) => text(await listViolations(sql, opts)),
);

server.tool(
  "guardrails_add_allowlist",
  "Add an entry to the allowlist for a workspace",
  {
    workspace_id: z.string(),
    type: z.string().describe("Type: email_domain, ip, user_id, content_pattern"),
    value: z.string().describe("The value to allowlist"),
  },
  async ({ workspace_id, type, value }) =>
    text(await addAllowlistEntry(sql, workspace_id, type, value)),
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
