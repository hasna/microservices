#!/usr/bin/env bun
/**
 * MCP server for microservice-guardrails.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { checkInput, checkOutput } from "../lib/guard.js";
import { scanPII } from "../lib/pii.js";
import { detectPromptInjection } from "../lib/injection.js";
import { createPolicy, listPolicies } from "../lib/policy.js";
import { listViolations } from "../lib/violations.js";
import { addAllowlistEntry } from "../lib/allowlist.js";

const server = new Server(
  { name: "microservice-guardrails", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "guardrails_check_input",
      description: "Check input text for prompt injection, PII, toxicity, and policy violations",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Input text to check" },
          workspace_id: { type: "string", description: "Optional workspace ID for policy evaluation" },
        },
        required: ["text"],
      },
    },
    {
      name: "guardrails_check_output",
      description: "Check output text for PII (auto-redacted), toxicity, and policy violations",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Output text to check" },
          workspace_id: { type: "string", description: "Optional workspace ID for policy evaluation" },
        },
        required: ["text"],
      },
    },
    {
      name: "guardrails_scan_pii",
      description: "Scan text for PII (emails, phone numbers, SSNs, credit cards, IPs, etc.)",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to scan for PII" },
        },
        required: ["text"],
      },
    },
    {
      name: "guardrails_detect_injection",
      description: "Detect prompt injection attempts in text",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to check for injection" },
        },
        required: ["text"],
      },
    },
    {
      name: "guardrails_create_policy",
      description: "Create a guardrails policy with rules for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          name: { type: "string", description: "Policy name" },
          rules: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["block_words", "max_length", "require_format", "custom_regex"] },
                config: { type: "object" },
                action: { type: "string", enum: ["block", "warn", "sanitize"] },
              },
              required: ["type", "config", "action"],
            },
          },
          active: { type: "boolean" },
        },
        required: ["workspace_id", "name", "rules"],
      },
    },
    {
      name: "guardrails_list_policies",
      description: "List all guardrails policies for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "guardrails_list_violations",
      description: "List guardrail violations with optional filters",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          type: { type: "string", enum: ["prompt_injection", "pii_detected", "policy_violation", "toxicity"] },
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          limit: { type: "number" },
        },
        required: [],
      },
    },
    {
      name: "guardrails_add_allowlist",
      description: "Add an entry to the allowlist for a workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          type: { type: "string", description: "Type: email_domain, ip, user_id, content_pattern" },
          value: { type: "string", description: "The value to allowlist" },
        },
        required: ["workspace_id", "type", "value"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as Record<string, unknown>;

  const text = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  if (name === "guardrails_check_input") {
    return text(await checkInput(sql, String(a.text), a.workspace_id ? String(a.workspace_id) : undefined));
  }

  if (name === "guardrails_check_output") {
    return text(await checkOutput(sql, String(a.text), a.workspace_id ? String(a.workspace_id) : undefined));
  }

  if (name === "guardrails_scan_pii") {
    return text({ matches: scanPII(String(a.text)) });
  }

  if (name === "guardrails_detect_injection") {
    return text(detectPromptInjection(String(a.text)));
  }

  if (name === "guardrails_create_policy") {
    return text(await createPolicy(
      sql,
      String(a.workspace_id),
      String(a.name),
      a.rules as { type: "block_words" | "max_length" | "require_format" | "custom_regex"; config: Record<string, unknown>; action: "block" | "warn" | "sanitize" }[],
      a.active !== undefined ? Boolean(a.active) : true
    ));
  }

  if (name === "guardrails_list_policies") {
    return text(await listPolicies(sql, String(a.workspace_id)));
  }

  if (name === "guardrails_list_violations") {
    return text(await listViolations(sql, {
      workspaceId: a.workspace_id ? String(a.workspace_id) : undefined,
      type: a.type ? String(a.type) : undefined,
      severity: a.severity ? String(a.severity) : undefined,
      limit: a.limit ? Number(a.limit) : undefined,
    }));
  }

  if (name === "guardrails_add_allowlist") {
    return text(await addAllowlistEntry(sql, String(a.workspace_id), String(a.type), String(a.value)));
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  const sql = getDb();
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
