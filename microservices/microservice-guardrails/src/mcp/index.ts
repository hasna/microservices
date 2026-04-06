#!/usr/bin/env bun
/**
 * MCP server for microservice-guardrails.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { addAllowlistEntry, deleteAllowlistEntry, listAllowlistEntries } from "../lib/allowlist.js";
import {
  type AuditLogEntry,
  logAuditEntry,
  queryAuditLog,
  getAuditStats,
  pruneAuditLog,
} from "../lib/audit.js";
import { exportAuditLogJSON, exportAuditLogCSV } from "../lib/audit-export.js";
import {
  computeSimhash,
  hammingDistance,
  isNearDuplicate,
  findNearDuplicates,
  computeAverageHash,
  storeFingerprint,
  getFingerprint,
  listFingerprints,
  deleteFingerprint,
} from "../lib/fingerprint.js";
import {
  addGuardRule,
  deleteGuardRule,
  evaluateDSLRule,
  listGuardRules,
  toggleGuardRule,
  updateGuardRule,
  validateDSLPattern,
} from "../lib/dsl-rules.js";
import { checkInput, checkOutput, checkInputStream, checkOutputStream } from "../lib/guard.js";
import { detectPromptInjection } from "../lib/injection.js";
import {
  inspectFull,
  scanPII,
  detectIPAddress,
  detectDateOfBirth,
  detectLicensePlate,
  detectMedicalLicense,
} from "../lib/pii.js";
import { checkToxicity } from "../lib/toxicity.js";
import { createPolicy, deletePolicy, evaluatePolicy, listPolicies } from "../lib/policy.js";
import { redactStreamText, streamGuard } from "../lib/stream-guard.js";
import { listViolations, logViolation } from "../lib/violations.js";
import {
  addDenylistEntry,
  deleteDenylistEntry,
  listDenylistEntries,
  isIPBlocked,
} from "../lib/denylist.js";
import {
  checkReplay,
  clearReplayWindow,
  type ReplayConfig,
} from "../lib/replay-detector.js";
import {
  identifyClient,
  setClientRateLimit,
  checkClientRateLimit,
  listClientRateLimitStatuses,
  clearClientBlock,
} from "../lib/client-rate-limits.js";
import {
  classifyContent,
  classifyBatch,
  sensitivityLabel,
} from "../lib/data-classifier.js";
import {
  createRuleVersion,
  getRuleVersion,
  listRuleVersions,
  getLatestRuleVersion,
  rollbackRule,
} from "../lib/rule-versioning.js";
import {
  createRuleGroup,
  evaluateRuleGroup,
  listRuleGroups,
} from "../lib/guard-policies.js";
import {
  getAdaptiveState,
  adjustAdaptiveLevel,
  applyAdaptiveStrictness,
} from "../lib/adaptive-guard.js";
import {
  scanToxicity,
  streamCombinedGuard,
  streamToxicityGuard,
} from "../lib/streaming-toxicity.js";
import {
  getGuardAnalyticsSummary,
  getGuardTrend,
} from "../lib/guard-analytics.js";
import {
  evaluateShadowMode,
  getShadowModeStats,
  listShadowEvaluations,
} from "../lib/index.js";
import { redactPII } from "../lib/pii.js";
import { evaluateGuardRules } from "../lib/dsl-rules.js";
import { getRuleVersionDiff, pruneRuleVersions, compareRuleVersions } from "../lib/rule-versioning.js";
import { checkWorkspaceQuota, recordQuotaUsage, getWorkspaceQuotaUsage, deleteWorkspaceQuota } from "../lib/workspace-quotas.js";
import { exportGuardrailsMetrics, exportGuardrailsMetricsJSON } from "../lib/guardrails-metrics.js";

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
  "guardrails_inspect_full",
  "Full PII inspection — returns all PII types found with positions, categories, and descriptions",
  { text: z.string().describe("Text to inspect for all PII types") },
  async ({ text: inputText }) => text(inspectFull(inputText)),
);

server.tool(
  "guardrails_redact_pii",
  "Redact specific PII matches from text, replacing each with a placeholder",
  {
    text: z.string().describe("Text containing PII to redact"),
    matches: z.array(z.object({
      type: z.string().describe("PII type (e.g., email, phone, ssn, credit_card, ip_address, date_of_birth, license_plate, medical_license)"),
      value: z.string().describe("The matched PII value to redact"),
      start: z.number().int().describe("Start position in text"),
      end: z.number().int().describe("End position in text"),
    })).describe("Array of PII matches from scan_pii to redact"),
    placeholder_template: z.string().optional().default("[REDACTED_{type}]").describe("Template with {type} placeholder"),
  },
  async ({ text, matches, placeholder_template }) => {
    const { redactPII } = await import("../lib/pii.js");
    const formattedMatches = matches.map(m => ({ type: m.type, value: m.value, start: m.start, end: m.end }));
    return text({ redacted: redactPII(text, formattedMatches) });
  },
);

server.tool(
  "guardrails_redact_text",
  "Scan text for PII and automatically redact all findings in one step",
  {
    text: z.string().describe("Text to scan and redact"),
    placeholder_template: z.string().optional().default("[REDACTED_{type}]").describe("Placeholder template with {type} placeholder"),
  },
  async ({ text, placeholder_template }) => {
    const { redactPII, scanPII } = await import("../lib/pii.js");
    const matches = scanPII(text);
    const redacted = redactPII(text, matches);
    return text({ matches, redacted, count: matches.length });
  },
);

server.tool(
  "guardrails_detect_injection",
  "Detect prompt injection attempts in text",
  { text: z.string().describe("Text to check for injection") },
  async ({ text: inputText }) => text(detectPromptInjection(inputText)),
);

server.tool(
  "guardrails_guard_stream",
  "Redact PII from a stream of text chunks in real-time. Provide chunks as an array of strings.",
  {
    chunks: z.array(z.string()).describe("Array of text chunks to process"),
    redact: z.boolean().optional().default(true).describe("Whether to redact found PII"),
    placeholder_template: z.string().optional().default("[REDACTED_{type}]").describe("Placeholder template with {type} placeholder"),
  },
  async ({ chunks, redact, placeholder_template }) => {
    // Process each chunk and collect results
    const results: { chunk: string; redacted: string; matches: ReturnType<typeof scanPII> }[] = [];
    for (const chunk of chunks) {
      const { redacted: redactedChunk, matches } = redactStreamText(chunk, {
        redact,
        placeholderTemplate: placeholder_template,
      });
      results.push({ chunk, redacted: redactedChunk, matches });
    }
    return text({ results });
  },
);

server.tool(
  "guardrails_add_rule",
  "Add a custom DSL guard rule",
  {
    name: z.string().describe("Rule name (must be unique)"),
    pattern: z.string().describe("DSL pattern expression (e.g., contains(pii.email), regex_match('\\\\b\\\\d{4}\\\\b'), word_count() > 100)"),
    severity: z.enum(["low", "medium", "high", "critical"]).optional().default("medium"),
    action: z.enum(["block", "redact", "warn", "log"]).optional().default("warn"),
    priority: z.number().optional().default(100).describe("Lower priority = evaluated first"),
    enabled: z.boolean().optional().default(true),
  },
  async (opts) => text(await addGuardRule(sql, opts)),
);

server.tool(
  "guardrails_list_rules",
  "List all guard rules with optional filters",
  {
    enabled: z.boolean().optional().describe("Filter by enabled status"),
    severity: z.string().optional().describe("Filter by severity"),
  },
  async (filters) => text(await listGuardRules(sql, filters)),
);

server.tool(
  "guardrails_toggle_rule",
  "Enable or disable a guard rule",
  {
    id: z.string().describe("Rule ID"),
    enabled: z.boolean().describe("New enabled state"),
  },
  async ({ id, enabled }) => {
    const result = await toggleGuardRule(sql, id, enabled);
    return text(result);
  },
);

server.tool(
  "guardrails_delete_rule",
  "Delete a guard rule by ID",
  { id: z.string().describe("Rule ID to delete") },
  async ({ id }) => text({ deleted: await deleteGuardRule(sql, id) }),
);

server.tool(
  "guardrails_create_policy",
  "Create a guardrails policy with rules for a workspace",
  {
    workspace_id: z.string(),
    name: z.string().describe("Policy name"),
    rules: z.array(z.object({
      type: z.enum(["block_words", "max_length", "require_format", "custom_regex", "pii_type", "entity_count", "and", "or", "not"]),
      config: z.record(z.any()),
      action: z.enum(["block", "warn", "sanitize"]),
    })),
    active: z.boolean().optional().default(true),
  },
  async ({ workspace_id, name, rules, active }) =>
    text(await createPolicy(sql, workspace_id, name, rules as any, active)),
);

server.tool(
  "guardrails_get_policy",
  "Get a guardrails policy by ID",
  { id: z.string() },
  async ({ id }) => {
    const { getPolicy } = await import("../lib/policy.js");
    return text(await getPolicy(sql, id));
  },
);

server.tool(
  "guardrails_update_policy",
  "Update a guardrails policy",
  {
    id: z.string(),
    name: z.string().optional(),
    rules: z.array(z.object({
      type: z.enum(["block_words", "max_length", "require_format", "custom_regex", "pii_type", "entity_count", "and", "or", "not"]),
      config: z.record(z.any()),
      action: z.enum(["block", "warn", "sanitize"]),
    })).optional(),
    active: z.boolean().optional(),
  },
  async ({ id, ...updates }) => {
    const { updatePolicy } = await import("../lib/policy.js");
    return text(await updatePolicy(sql, id, updates));
  },
);

server.tool(
  "guardrails_delete_policy",
  "Delete a guardrails policy by ID",
  { id: z.string().describe("Policy ID to delete") },
  async ({ id }) => {
    const { deletePolicy } = await import("../lib/policy.js");
    return text({ deleted: await deletePolicy(sql, id) });
  },
);

server.tool(
  "guardrails_evaluate_policy",
  "Evaluate all active policies for a workspace against text and return violations",
  {
    workspace_id: z.string().describe("Workspace ID"),
    text: z.string().describe("Text to evaluate against policies"),
    direction: z.enum(["input", "output"]).optional().default("input"),
  },
  async ({ workspace_id, text, direction }) => {
    const { evaluatePolicy } = await import("../lib/policy.js");
    return text(await evaluatePolicy(sql, workspace_id, text, direction));
  },
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

// Fingerprint tools
server.tool(
  "guardrails_compute_simhash",
  "Compute Simhash fingerprint for content near-duplicate detection",
  {
    text: z.string().describe("Text content to fingerprint"),
    n_gram_size: z.number().optional().default(3).describe("N-gram size for tokenization"),
  },
  async ({ text, n_gram_size }) => {
    const simhash = computeSimhash(text, n_gram_size);
    const avgHash = computeAverageHash(text);
    return text({ simhash, avg_hash: avgHash });
  },
);

server.tool(
  "guardrails_hamming_distance",
  "Calculate Hamming distance between two Simhash fingerprints",
  {
    hash1: z.string().describe("First 64-bit hex fingerprint"),
    hash2: z.string().describe("Second 64-bit hex fingerprint"),
  },
  async ({ hash1, hash2 }) => text({ distance: hammingDistance(hash1, hash2) }),
);

server.tool(
  "guardrails_near_duplicate",
  "Check if two texts are near-duplicates using Simhash",
  {
    text1: z.string().describe("First text"),
    text2: z.string().describe("Second text"),
    threshold: z.number().optional().default(3).describe("Max Hamming distance to consider near-duplicate"),
  },
  async ({ text1, text2, threshold }) => text({ is_near_duplicate: isNearDuplicate(text1, text2, threshold) }),
);

server.tool(
  "guardrails_find_duplicates",
  "Find near-duplicate fingerprints in the database for a given text",
  {
    workspace_id: z.string(),
    text: z.string().describe("Text to find duplicates for"),
    threshold: z.number().optional().default(3).describe("Max Hamming distance threshold"),
    limit: z.number().optional().default(10),
  },
  async ({ workspace_id, text, threshold, limit }) => text(await findNearDuplicates(sql, workspace_id, text, threshold, limit)),
);

server.tool(
  "guardrails_store_fingerprint",
  "Store a content fingerprint in the database",
  {
    workspace_id: z.string(),
    text: z.string().describe("Content to fingerprint and store"),
    content_hash: z.string().optional().describe("Optional content hash for integrity"),
  },
  async ({ workspace_id, text, content_hash }) => text(await storeFingerprint(sql, workspace_id, text, content_hash)),
);

server.tool(
  "guardrails_list_fingerprints",
  "List stored fingerprints for a workspace",
  {
    workspace_id: z.string(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ workspace_id, limit, offset }) => text(await listFingerprints(sql, workspace_id, limit, offset)),
);

server.tool(
  "guardrails_delete_fingerprint",
  "Delete a fingerprint by ID",
  { id: z.string().describe("Fingerprint ID to delete") },
  async ({ id }) => text({ deleted: await deleteFingerprint(sql, id) }),
);

// Audit tools
server.tool(
  "guardrails_log_audit",
  "Log a guardrails check event to the audit trail",
  {
    workspace_id: z.string().optional(),
    request_id: z.string().optional(),
    check_type: z.string().describe("Type of check: input, output, pii, injection, toxicity, policy"),
    result: z.enum(["pass", "warn", "block"]).describe("Check result"),
    input_text: z.string().optional(),
    output_text: z.string().optional(),
    violations: z.array(z.any()).optional().default([]),
    fingerprint_id: z.string().optional(),
    ip_address: z.string().optional(),
    user_agent: z.string().optional(),
    latency_ms: z.number().optional(),
  },
  async (opts) => text(await logAuditEntry(sql, opts as any)),
);

server.tool(
  "guardrails_query_audit",
  "Query audit log with filters",
  {
    workspace_id: z.string().optional(),
    result: z.enum(["pass", "warn", "block"]).optional(),
    check_type: z.string().optional(),
    fingerprint_id: z.string().optional(),
    ip_address: z.string().optional(),
    since: z.string().optional().describe("ISO timestamp"),
    until: z.string().optional().describe("ISO timestamp"),
    limit: z.number().optional().default(100),
    offset: z.number().optional().default(0),
  },
  async (opts) => text(await queryAuditLog(sql, opts as any)),
);

server.tool(
  "guardrails_audit_stats",
  "Get audit log statistics for a workspace",
  {
    workspace_id: z.string().optional(),
    since: z.string().optional().describe("ISO timestamp"),
    until: z.string().optional().describe("ISO timestamp"),
  },
  async (opts) => text(await getAuditStats(sql, opts.workspace_id, opts.since, opts.until)),
);

server.tool(
  "guardrails_prune_audit",
  "Prune old audit log entries, keeping entries within the retention window",
  {
    workspace_id: z.string().optional(),
    days_to_keep: z.number().optional().default(30),
  },
  async ({ workspace_id, days_to_keep }) => text({ deleted: await pruneAuditLog(sql, workspace_id, days_to_keep) }),
);

// Client Rate Limit tools
server.tool(
  "guardrails_set_client_rate_limit",
  "Set per-client rate limiting configuration (sliding window)",
  {
    workspace_id: z.string(),
    client_id: z.string().describe("Client identifier (IP hash, key hash, or UA hash)"),
    max_requests: z.number().int().positive().describe("Max requests in the window"),
    window_seconds: z.number().int().positive().optional().default(60).describe("Window duration in seconds"),
    block_duration_seconds: z.number().int().nonnegative().optional().default(300).describe("How long to block after exceeding limit"),
    enabled: z.boolean().optional().default(true),
  },
  async ({ workspace_id, client_id, max_requests, window_seconds, block_duration_seconds, enabled }) => {
    const { setClientRateLimit } = await import("../lib/client-rate-limits.js");
    return text(await setClientRateLimit(sql, workspace_id, client_id, {
      maxRequests: max_requests,
      windowSeconds: window_seconds ?? 60,
      blockDurationSeconds: block_duration_seconds ?? 300,
      enabled: enabled ?? true,
    }));
  },
);

server.tool(
  "guardrails_check_client_rate_limit",
  "Check if a client is within their rate limit (sliding window)",
  {
    workspace_id: z.string(),
    client_ip: z.string().optional(),
    api_key: z.string().optional(),
    user_agent: z.string().optional(),
  },
  async ({ workspace_id, client_ip, api_key, user_agent }) => {
    const { identifyClient, checkClientRateLimit } = await import("../lib/client-rate-limits.js");
    const client = identifyClient({ ip: client_ip, apiKey: api_key, userAgent: user_agent });
    return text(await checkClientRateLimit(sql, workspace_id, client));
  },
);

server.tool(
  "guardrails_list_client_rate_limits",
  "List all client rate limit configurations for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const { listClientRateLimitStatuses } = await import("../lib/client-rate-limits.js");
    return text(await listClientRateLimitStatuses(sql, workspace_id));
  },
);

server.tool(
  "guardrails_clear_client_block",
  "Manually clear a client block before it expires",
  {
    workspace_id: z.string(),
    client_id: z.string(),
  },
  async ({ workspace_id, client_id }) => {
    const { clearClientBlock } = await import("../lib/client-rate-limits.js");
    return text(await clearClientBlock(sql, workspace_id, client_id));
  },
);

// Adaptive Guard tools
server.tool(
  "guardrails_get_adaptive_state",
  "Get the current adaptive strictness state for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const { getAdaptiveState } = await import("../lib/adaptive-guard.js");
    return text(await getAdaptiveState(sql, workspace_id));
  },
);

server.tool(
  "guardrails_adjust_adaptive_level",
  "Manually adjust the adaptive guard strictness level for a workspace",
  {
    workspace_id: z.string(),
    level: z.enum(["relaxed", "normal", "strict", "paranoid"]),
    reason: z.string().optional().describe("Reason for the adjustment"),
  },
  async ({ workspace_id, level, reason }) => {
    const { adjustAdaptiveLevel } = await import("../lib/adaptive-guard.js");
    return text(await adjustAdaptiveLevel(sql, workspace_id, level, reason));
  },
);

server.tool(
  "guardrails_apply_adaptive_strictness",
  "Apply adaptive strictness multipliers to a guard result based on workspace state",
  {
    workspace_id: z.string(),
    base_result: z.any().describe("Base guard result to apply strictness to"),
  },
  async ({ workspace_id, base_result }) => {
    const { applyAdaptiveStrictness } = await import("../lib/adaptive-guard.js");
    return text(await applyAdaptiveStrictness(sql, workspace_id, base_result));
  },
);

// --- Denylist tools ---

server.tool(
  "guardrails_add_denylist_entry",
  "Add an IP address or CIDR range to the denylist",
  {
    ip_pattern: z.string().describe("IP address or CIDR range (e.g. '192.168.1.0/24')"),
    reason: z.string().describe("Reason for blocking"),
    blocked_by: z.string().describe("User or system blocking this IP"),
    workspace_id: z.string().optional().describe("Workspace scope (null = global)"),
    expires_at: z.string().optional().describe("ISO timestamp when block expires (null = permanent)"),
  },
  async ({ ip_pattern, reason, blocked_by, workspace_id, expires_at }) =>
    text(await addDenylistEntry(sql, {
      ipPattern: ip_pattern,
      reason,
      blockedBy: blocked_by,
      workspaceId: workspace_id ?? null,
      expiresAt: expires_at ? new Date(expires_at) : null,
    })),
);

server.tool(
  "guardrails_delete_denylist_entry",
  "Remove an entry from the denylist",
  {
    id: z.string().describe("Denylist entry ID"),
    workspace_id: z.string().optional().describe("Workspace ID (required for workspace-scoped entries)"),
  },
  async ({ id, workspace_id }) => {
    await deleteDenylistEntry(sql, id, workspace_id);
    return text({ deleted: true });
  },
);

server.tool(
  "guardrails_list_denylist",
  "List all denylist entries",
  { workspace_id: z.string().optional().describe("Filter by workspace") },
  async ({ workspace_id }) => text(await listDenylistEntries(sql, workspace_id)),
);

server.tool(
  "guardrails_check_ip_blocked",
  "Check if an IP address is blocked",
  {
    ip: z.string().describe("IP address to check"),
    workspace_id: z.string().optional().describe("Workspace ID"),
  },
  async ({ ip, workspace_id }) => text(await isIPBlocked(sql, ip, workspace_id ?? undefined)),
);

// --- Replay detection tools ---

server.tool(
  "guardrails_check_replay",
  "Check if a request is a replay attack (duplicate within time window)",
  {
    workspace_id: z.string().describe("Workspace ID"),
    request_hash: z.string().describe("SHA-256 hash of the request content"),
    content: z.string().describe("Original content for fingerprinting"),
    window_seconds: z.number().optional().default(300).describe("Time window in seconds"),
    strict: z.boolean().optional().default(false).describe("Also detect near-duplicates"),
  },
  async ({ workspace_id, request_hash, content, window_seconds, strict }) =>
    text(await checkReplay(sql, {
      workspaceId: workspace_id,
      requestHash: request_hash,
      content,
      config: { windowSeconds: window_seconds, strict },
    })),
);

server.tool(
  "guardrails_clear_replay_window",
  "Clear expired replay detection fingerprints for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    before: z.string().optional().describe("ISO timestamp cutoff"),
  },
  async ({ workspace_id, before }) =>
    text({ cleared: await clearReplayWindow(sql, workspace_id, before ? new Date(before) : undefined) }),
);

// --- Data classification tools ---

server.tool(
  "guardrails_classify_content",
  "Classify content by sensitivity level and detect restricted data types",
  {
    content: z.string().describe("Content to classify"),
    workspace_id: z.string().optional().describe("Workspace ID for context"),
  },
  async ({ content, workspace_id }) =>
    text(await classifyContent(sql, content, workspace_id)),
);

server.tool(
  "guardrails_classify_batch",
  "Classify multiple content items by sensitivity level",
  {
    contents: z.array(z.string()).describe("Array of content strings to classify"),
    workspace_id: z.string().optional().describe("Workspace ID for context"),
  },
  async ({ contents, workspace_id }) =>
    text(await classifyBatch(sql, contents, workspace_id)),
);

server.tool(
  "guardrails_sensitivity_label",
  "Get human-readable description of a sensitivity level",
  { level: z.enum(["public", "internal", "confidential", "restricted"]) },
  async ({ level }) => text({ label: sensitivityLabel(level) }),
);

// --- Rule Versioning tools ---

server.tool(
  "guardrails_list_rule_versions",
  "List all versions of a guard rule (newest first)",
  { rule_id: z.string().describe("Rule ID to get version history for") },
  async ({ rule_id }) => {
    const { listRuleVersions } = await import("../lib/rule-versioning.js");
    return text(await listRuleVersions(sql, rule_id));
  },
);

server.tool(
  "guardrails_get_rule_version",
  "Get a specific version of a guard rule by version number",
  {
    rule_id: z.string().describe("Rule ID"),
    version_number: z.number().int().positive().describe("Version number to retrieve"),
  },
  async ({ rule_id, version_number }) => {
    const { getRuleVersion } = await import("../lib/rule-versioning.js");
    return text(await getRuleVersion(sql, rule_id, version_number));
  },
);

server.tool(
  "guardrails_rollback_rule",
  "Rollback a guard rule to a previous version",
  {
    rule_id: z.string().describe("Rule ID to rollback"),
    target_version: z.number().int().positive().describe("Version number to rollback to"),
    changed_by: z.string().optional().describe("User performing the rollback"),
    reason: z.string().optional().describe("Reason for rollback"),
  },
  async ({ rule_id, target_version, changed_by, reason }) => {
    const { rollbackRule } = await import("../lib/rule-versioning.js");
    return text(await rollbackRule(sql, rule_id, target_version, changed_by, reason));
  },
);

server.tool(
  "guardrails_get_rule_diff",
  "Compare two versions of a rule to see what changed",
  {
    rule_id: z.string().describe("Rule ID"),
    from_version: z.number().int().positive().describe("Older version number"),
    to_version: z.number().int().positive().describe("Newer version number"),
  },
  async ({ rule_id, from_version, to_version }) => {
    const { getRuleVersionDiff } = await import("../lib/rule-versioning.js");
    return text(await getRuleVersionDiff(sql, rule_id, from_version, to_version));
  },
);

// --- Rule Composition (AND/OR/NOT) tools ---

server.tool(
  "guardrails_create_rule_group",
  "Create a rule group with AND/OR/NOT composition",
  {
    name: z.string().describe("Unique group name"),
    operator: z.enum(["AND", "OR", "NOT"]).describe("Logical operator for combining rules"),
    rule_ids: z.array(z.string()).describe("Array of rule IDs to include in this group"),
    negate: z.boolean().optional().default(false).describe("Apply NOT to the group's result"),
    enabled: z.boolean().optional().default(true),
  },
  async ({ name, operator, rule_ids, negate, enabled }) => {
    const { createRuleGroup } = await import("../lib/guard-policies.js");
    return text(await createRuleGroup(sql, { name, operator, rule_ids, negate, enabled }));
  },
);

server.tool(
  "guardrails_list_rule_groups",
  "List all rule groups",
  { enabled: z.boolean().optional().describe("Filter by enabled status") },
  async ({ enabled }) => {
    const { listRuleGroups } = await import("../lib/guard-policies.js");
    return text(await listRuleGroups(sql, enabled !== undefined ? { enabled } : undefined));
  },
);

server.tool(
  "guardrails_get_rule_group",
  "Get a rule group by ID",
  { id: z.string().describe("Rule group ID") },
  async ({ id }) => {
    const { getRuleGroup } = await import("../lib/guard-policies.js");
    return text(await getRuleGroup(sql, id));
  },
);

server.tool(
  "guardrails_update_rule_group",
  "Update a rule group's composition or settings",
  {
    id: z.string().describe("Rule group ID"),
    name: z.string().optional(),
    operator: z.enum(["AND", "OR", "NOT"]).optional(),
    rule_ids: z.array(z.string()).optional(),
    negate: z.boolean().optional(),
    enabled: z.boolean().optional(),
  },
  async (opts) => {
    const { id, ...updates } = opts as any;
    const { updateRuleGroup } = await import("../lib/guard-policies.js");
    return text(await updateRuleGroup(sql, id, updates));
  },
);

server.tool(
  "guardrails_delete_rule_group",
  "Delete a rule group",
  { id: z.string().describe("Rule group ID") },
  async ({ id }) => {
    const { deleteRuleGroup } = await import("../lib/guard-policies.js");
    return text({ deleted: await deleteRuleGroup(sql, id) });
  },
);

server.tool(
  "guardrails_evaluate_rule_group",
  "Evaluate a rule group against text",
  {
    group_id: z.string().describe("Rule group ID"),
    text: z.string().describe("Text to evaluate"),
  },
  async ({ group_id, text }) => {
    const { evaluateRuleGroup } = await import("../lib/guard-policies.js");
    return text(await evaluateRuleGroup(sql, group_id, text));
  },
);

server.tool(
  "guardrails_evaluate_all_rule_groups",
  "Evaluate all enabled rule groups against text, return matches",
  { text: z.string().describe("Text to evaluate") },
  async ({ text }) => {
    const { evaluateAllRuleGroups } = await import("../lib/guard-policies.js");
    return text(await evaluateAllRuleGroups(sql, text));
  },
);

// --- Workspace Quota tools ---

server.tool(
  "guardrails_set_workspace_quota",
  "Set quota limits for a workspace (daily or monthly)",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period: z.enum(["daily", "monthly"]).describe("Quota period"),
    max_requests: z.number().int().positive().describe("Max requests per period"),
    max_tokens: z.number().int().positive().describe("Max tokens per period"),
    max_bytes: z.number().int().positive().describe("Max bytes per period"),
    enabled: z.boolean().optional().default(true),
  },
  async ({ workspace_id, period, max_requests, max_tokens, max_bytes, enabled }) => {
    const { setWorkspaceQuota } = await import("../lib/workspace-quotas.js");
    return text(await setWorkspaceQuota(sql, { workspaceId: workspace_id, period, maxRequests: max_requests, maxTokens: max_tokens, maxBytes: max_bytes, enabled }));
  },
);

server.tool(
  "guardrails_check_workspace_quota",
  "Check if a workspace is within its quota limits",
  {
    workspace_id: z.string().describe("Workspace ID"),
    requests_to_add: z.number().int().optional().default(0).describe("Requests to add for this check"),
    tokens_to_add: z.number().int().optional().default(0).describe("Tokens to add for this check"),
    bytes_to_add: z.number().int().optional().default(0).describe("Bytes to add for this check"),
    period: z.enum(["daily", "monthly"]).optional().default("daily"),
  },
  async ({ workspace_id, requests_to_add, tokens_to_add, bytes_to_add, period }) => {
    const { checkWorkspaceQuota } = await import("../lib/workspace-quotas.js");
    return text(await checkWorkspaceQuota(sql, workspace_id, requests_to_add, tokens_to_add, bytes_to_add, period));
  },
);

server.tool(
  "guardrails_record_quota_usage",
  "Record usage against a workspace quota",
  {
    workspace_id: z.string().describe("Workspace ID"),
    requests: z.number().int().optional().default(0).describe("Number of requests to record"),
    tokens: z.number().int().optional().default(0).describe("Number of tokens to record"),
    bytes: z.number().int().optional().default(0).describe("Number of bytes to record"),
  },
  async ({ workspace_id, requests, tokens, bytes }) => {
    const { recordQuotaUsage } = await import("../lib/workspace-quotas.js");
    await recordQuotaUsage(sql, workspace_id, requests, tokens, bytes);
    return text({ recorded: true });
  },
);

server.tool(
  "guardrails_get_quota_usage",
  "Get current quota usage for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period: z.enum(["daily", "monthly"]).optional().default("daily"),
  },
  async ({ workspace_id, period }) => {
    const { getWorkspaceQuotaUsage } = await import("../lib/workspace-quotas.js");
    return text(await getWorkspaceQuotaUsage(sql, workspace_id, period));
  },
);

server.tool(
  "guardrails_list_workspace_quotas",
  "List all workspace quota configurations",
  async () => {
    const { listWorkspaceQuotas } = await import("../lib/workspace-quotas.js");
    return text(await listWorkspaceQuotas(sql));
  },
);

server.tool(
  "guardrails_delete_workspace_quota",
  "Delete a workspace quota configuration",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period: z.enum(["daily", "monthly"]).describe("Quota period to delete"),
  },
  async ({ workspace_id, period }) => {
    const { deleteWorkspaceQuota } = await import("../lib/workspace-quotas.js");
    return text({ deleted: await deleteWorkspaceQuota(sql, workspace_id, period) });
  },
);

// --- Streaming Toxicity tools ---

server.tool(
  "guardrails_scan_toxicity",
  "Scan text for toxicity (insults, threats, hate speech, profanity, etc.)",
  { text: z.string().describe("Text to scan for toxicity") },
  async ({ text }) => {
    const { scanToxicity } = await import("../lib/streaming-toxicity.js");
    return text({ isToxic: scanToxicity(text).length > 0, matches: scanToxicity(text) });
  },
);

server.tool(
  "guardrails_check_text_toxicity",
  "Check text for toxicity with structured result: isToxic flag, severity matches, and max severity level",
  { text: z.string().describe("Text to check for toxicity") },
  async ({ text }) => {
    const { checkTextToxicity } = await import("../lib/streaming-toxicity.js");
    return text(checkTextToxicity(text));
  },
);

// --- Prometheus Metrics tools ---

server.tool(
  "guardrails_export_prometheus_metrics",
  "Export guardrails metrics in Prometheus text format",
  {
    workspace_id: z.string().optional().describe("Optional workspace ID to filter metrics"),
    since_hours: z.number().optional().default(1).describe("Hours to look back for metrics"),
  },
  async ({ workspace_id, since_hours }) => {
    const { exportGuardrailsMetrics } = await import("../lib/guardrails-metrics.js");
    const since = new Date(Date.now() - since_hours * 3600_000);
    return text(await exportGuardrailsMetrics(sql, workspace_id, since));
  },
);

server.tool(
  "guardrails_metrics_json",
  "Export guardrails metrics as structured JSON",
  {
    workspace_id: z.string().optional().describe("Optional workspace ID to filter metrics"),
    since_hours: z.number().optional().default(1).describe("Hours to look back for metrics"),
  },
  async ({ workspace_id, since_hours }) => {
    const { exportGuardrailsMetricsJSON } = await import("../lib/guardrails-metrics.js");
    const since = new Date(Date.now() - since_hours * 3600_000);
    return text(await exportGuardrailsMetricsJSON(sql, workspace_id, since));
  },
);

// --- Guard Analytics tools ---

server.tool(
  "guardrails_analytics_summary",
  "Get guardrails analytics summary: top violations, rule effectiveness, PII breakdown",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_hours: z.number().optional().default(24).describe("Hours to look back"),
  },
  async ({ workspace_id, period_hours }) => {
    const { getGuardAnalyticsSummary } = await import("../lib/guard-analytics.js");
    return text(await getGuardAnalyticsSummary(sql, workspace_id, period_hours));
  },
);

server.tool(
  "guardrails_analytics_trend",
  "Get guardrails trend data over time (checks, violations, rates)",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_hours: z.number().optional().default(168).describe("Hours to look back (default: 1 week)"),
    granularity: z.enum(["hourly", "daily", "weekly"]).optional().default("hourly"),
  },
  async ({ workspace_id, period_hours, granularity }) => {
    const { getGuardTrend } = await import("../lib/guard-analytics.js");
    return text(await getGuardTrend(sql, workspace_id, period_hours, granularity));
  },
);

server.tool(
  "guardrails_get_top_violations",
  "Get top violations for a workspace — most triggered rules and violation types",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_hours: z.number().optional().default(24).describe("Hours to look back"),
    limit: z.number().optional().default(10).describe("Number of top violations to return"),
  },
  async ({ workspace_id, period_hours, limit }) => {
    const { getGuardAnalyticsSummary } = await import("../lib/guard-analytics.js");
    const summary = await getGuardAnalyticsSummary(sql, workspace_id, period_hours);
    const topViolations = (summary.topViolations ?? []).slice(0, limit);
    return text({ workspace_id, period_hours, top_violations: topViolations });
  },
);

server.tool(
  "guardrails_get_violations_by_type",
  "Get violation breakdown by type (PII, injection, toxicity, etc.) for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_hours: z.number().optional().default(24).describe("Hours to look back"),
  },
  async ({ workspace_id, period_hours }) => {
    const { getGuardAnalyticsSummary } = await import("../lib/guard-analytics.js");
    const summary = await getGuardAnalyticsSummary(sql, workspace_id, period_hours);
    return text({ workspace_id, period_hours, pii_breakdown: summary.piiBreakdown, violation_rate: summary.violationRate });
  },
);

server.tool(
  "guardrails_metrics_prometheus",
  "Convert guardrails metrics to Prometheus exposition text format for scraping",
  {
    workspace_id: z.string().optional().describe("Optional workspace ID to filter metrics"),
    since_hours: z.number().optional().default(1).describe("Hours to look back for metrics"),
  },
  async ({ workspace_id, since_hours }) => {
    const { exportGuardrailsMetrics } = await import("../lib/guardrails-metrics.js");
    const since = new Date(Date.now() - since_hours * 3600_000);
    return text(await exportGuardrailsMetrics(sql, workspace_id, since));
  },
);

server.tool(
  "guardrails_update_rule_priority",
  "Update the priority/order of a guard rule (lower = evaluated first)",
  {
    id: z.string().describe("Rule ID"),
    priority: z.number().int().describe("New priority value (lower = evaluated first)"),
  },
  async ({ id, priority }) => {
    const { updateGuardRule } = await import("../lib/dsl-rules.js");
    return text(await updateGuardRule(sql, id, { priority }));
  },
);

// --- Audit Export tools ---

server.tool(
  "guardrails_audit_export_json",
  "Export audit log entries as formatted JSON for compliance/reporting",
  {
    workspace_id: z.string().optional().describe("Workspace ID to filter by"),
    start_date: z.string().optional().describe("ISO date string for start of range"),
    end_date: z.string().optional().describe("ISO date string for end of range"),
    event_type: z.string().optional().describe("Event type to filter by (e.g. 'guard_check')"),
    limit: z.number().optional().default(1000).describe("Maximum number of entries to export"),
  },
  async ({ workspace_id, start_date, end_date, event_type, limit }) => {
    const opts = {
      workspaceId: workspace_id,
      startDate: start_date ? new Date(start_date) : undefined,
      endDate: end_date ? new Date(end_date) : undefined,
      eventType: event_type,
      limit,
    };
    return text(await exportAuditLogJSON(sql, opts));
  },
);

server.tool(
  "guardrails_audit_export_csv",
  "Export audit log entries as CSV (RFC 4180) for spreadsheet import",
  {
    workspace_id: z.string().optional().describe("Workspace ID to filter by"),
    start_date: z.string().optional().describe("ISO date string for start of range"),
    end_date: z.string().optional().describe("ISO date string for end of range"),
    event_type: z.string().optional().describe("Event type to filter by (e.g. 'guard_check')"),
    limit: z.number().optional().default(1000).describe("Maximum number of entries to export"),
  },
  async ({ workspace_id, start_date, end_date, event_type, limit }) => {
    const opts = {
      workspaceId: workspace_id,
      startDate: start_date ? new Date(start_date) : undefined,
      endDate: end_date ? new Date(end_date) : undefined,
      eventType: event_type,
      limit,
    };
    return text(await exportAuditLogCSV(sql, opts));
  },
);

// --- DSL Evaluation tools ---

server.tool(
  "guardrails_evaluate_dsl",
  "Evaluate a DSL rule expression against input text (for testing rules before saving)",
  {
    pattern: z.string().describe("DSL pattern expression (e.g. 'contains('password')')"),
    text: z.string().describe("Text to evaluate the pattern against"),
    context: z.record(z.string(), z.any()).optional().describe("Optional context variables"),
  },
  async ({ pattern, text, context }) => {
    const opts = context ? { variables: context } : {};
    return text(JSON.stringify(await evaluateDSLRule(sql, pattern, text, opts), null, 2));
  },
);

server.tool(
  "guardrails_validate_pattern",
  "Validate a DSL pattern without executing it — returns syntax errors if invalid",
  {
    pattern: z.string().describe("DSL pattern expression to validate"),
  },
  async ({ pattern }) => {
    const { validateDSLPattern } = await import("../lib/dsl-rules.js");
    return text(JSON.stringify(validateDSLPattern(pattern), null, 2));
  },
);

server.tool(
  "guardrails_evaluate_all_rules",
  "Evaluate all enabled guard rules against text and return all matches with actions",
  {
    text: z.string().describe("Text to evaluate against all enabled rules"),
  },
  async ({ text }) => {
    const { evaluateGuardRules } = await import("../lib/dsl-rules.js");
    return text(await evaluateGuardRules(sql, text));
  },
);

server.tool(
  "guardrails_batch_audit_query",
  "Query audit log with multiple filter combinations in a single call",
  {
    queries: z.array(z.object({
      workspace_id: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      event_type: z.string().optional(),
      limit: z.number().optional().default(100),
    })).describe("Array of up to 5 filter query objects"),
  },
  async ({ queries }) => {
    const results = await Promise.all(
      queries.slice(0, 5).map(async (q) => {
        const opts = {
          workspaceId: q.workspace_id,
          startDate: q.start_date ? new Date(q.start_date) : undefined,
          endDate: q.end_date ? new Date(q.end_date) : undefined,
          eventType: q.event_type,
          limit: q.limit,
        };
        const rows = await queryAuditLog(sql, opts);
        return { filters: q, count: rows.length, entries: rows };
      })
    );
    return text(JSON.stringify({ results }, null, 2));
  },
);

// Rule versioning tools
server.tool(
  "guardrails_create_rule_version",
  "Create a new version of a guard rule before editing",
  {
    rule_id: z.string().uuid(),
    change_reason: z.string().optional(),
    created_by: z.string().optional(),
  },
  async ({ rule_id, change_reason, created_by }) =>
    text(await createRuleVersion(sql, rule_id, change_reason, created_by)),
);

server.tool(
  "guardrails_get_rule_version",
  "Get a specific version of a guard rule",
  {
    rule_id: z.string().uuid(),
    version_number: z.number().int().positive(),
  },
  async ({ rule_id, version_number }) =>
    text(await getRuleVersion(sql, rule_id, version_number)),
);

server.tool(
  "guardrails_list_rule_versions",
  "List all versions of a guard rule",
  {
    rule_id: z.string().uuid(),
    limit: z.number().int().positive().max(50).optional().default(20),
  },
  async ({ rule_id, limit }) =>
    text(await listRuleVersions(sql, rule_id, limit)),
);

server.tool(
  "guardrails_rollback_rule",
  "Rollback a rule to a previous version",
  {
    rule_id: z.string().uuid(),
    target_version: z.number().int().positive(),
    rolled_back_by: z.string().optional(),
  },
  async ({ rule_id, target_version, rolled_back_by }) =>
    text(await rollbackRule(sql, rule_id, target_version, rolled_back_by)),
);

// Rule composition (AND/OR/NOT groups)
server.tool(
  "guardrails_create_rule_group",
  "Create a composable rule group (AND/OR/NOT logic)",
  {
    workspace_id: z.string().uuid(),
    name: z.string(),
    operator: z.enum(["AND", "OR", "NOT"]),
    rule_ids: z.array(z.string().uuid()),
    enabled: z.boolean().optional().default(true),
    description: z.string().optional(),
  },
  async ({ workspace_id, name, operator, rule_ids, enabled, description }) =>
    text(await createRuleGroup(sql, workspace_id, {
      name,
      operator,
      ruleIds: rule_ids,
      enabled,
      description,
    })),
);

server.tool(
  "guardrails_evaluate_rule_group",
  "Evaluate a rule group against input text",
  {
    group_id: z.string().uuid(),
    text: z.string(),
  },
  async ({ group_id, text }) =>
    text(await evaluateRuleGroup(sql, group_id, text)),
);

server.tool(
  "guardrails_list_rule_groups",
  "List all rule groups in a workspace",
  {
    workspace_id: z.string().uuid(),
    limit: z.number().int().positive().max(100).optional().default(50),
  },
  async ({ workspace_id, limit }) =>
    text(await listRuleGroups(sql, workspace_id, limit)),
);

// Adaptive guard tools
server.tool(
  "guardrails_get_adaptive_state",
  "Get the current adaptive guard state for a workspace",
  { workspace_id: z.string().uuid() },
  async ({ workspace_id }) =>
    text(await getAdaptiveState(sql, workspace_id)),
);

server.tool(
  "guardrails_adjust_adaptive_level",
  "Manually adjust the adaptive strictness level for a workspace",
  {
    workspace_id: z.string().uuid(),
    level: z.enum(["permissive", "balanced", "strict", "paranoid"]),
    reason: z.string().optional(),
    adjusted_by: z.string().optional(),
  },
  async ({ workspace_id, level, reason, adjusted_by }) =>
    text(await adjustAdaptiveLevel(sql, workspace_id, level, reason, adjusted_by)),
);

// Streaming toxicity tools
server.tool(
  "guardrails_scan_toxicity",
  "Scan text for toxicity with severity scoring",
  {
    text: z.string(),
    workspace_id: z.string().uuid().optional(),
  },
  async ({ text, workspace_id }) =>
    text(await scanToxicity(sql, text, workspace_id)),
);

server.tool(
  "guardrails_stream_combined_guard",
  "Run combined streaming guard checks (injection + toxicity + PII + custom rules)",
  {
    text: z.string(),
    workspace_id: z.string().uuid().optional(),
    check_injection: z.boolean().optional().default(true),
    check_toxicity: z.boolean().optional().default(true),
    check_pii: z.boolean().optional().default(true),
    check_rules: z.boolean().optional().default(true),
  },
  async ({ text, workspace_id, check_injection, check_toxicity, check_pii, check_rules }) =>
    text(await streamCombinedGuard(sql, text, {
      workspaceId: workspace_id,
      checkInjection: check_injection,
      checkToxicity: check_toxicity,
      checkPII: check_pii,
      checkRules: check_rules,
    })),
);

// Guard analytics tools
server.tool(
  "guardrails_get_analytics_summary",
  "Get guardrails analytics summary for a workspace",
  {
    workspace_id: z.string().uuid(),
    from_hours: z.number().int().positive().optional().default(168),
  },
  async ({ workspace_id, from_hours }) =>
    text(await getGuardAnalyticsSummary(sql, workspace_id, from_hours)),
);

server.tool(
  "guardrails_get_trend",
  "Get guardrails violation trend data over time",
  {
    workspace_id: z.string().uuid(),
    metric: z.enum(["violations", "blocked", "errors"]).optional().default("violations"),
    from_hours: z.number().int().positive().optional().default(168),
    granularity: z.enum(["hour", "day", "week"]).optional().default("day"),
  },
  async ({ workspace_id, metric, from_hours, granularity }) =>
    text(await getGuardTrend(sql, workspace_id, metric, from_hours, granularity)),
);

// Allowlist management
server.tool(
  "guardrails_delete_allowlist_entry",
  "Delete an allowlist entry by ID",
  {
    id: z.string().describe("Allowlist entry ID to delete"),
    workspace_id: z.string().describe("Workspace ID (required to scope the deletion)"),
  },
  async ({ id, workspace_id }) =>
    text({ deleted: await deleteAllowlistEntry(sql, id, workspace_id) }),
);

server.tool(
  "guardrails_list_allowlist",
  "List all allowlist entries for a workspace",
  {
    workspace_id: z.string(),
    type: z.string().optional().describe("Filter by entry type: email_domain, ip, user_id, content_pattern"),
  },
  async ({ workspace_id, type }) =>
    text(await listAllowlistEntries(sql, workspace_id, type)),
);

// Lightweight toxicity check (synchronous, no DB)
server.tool(
  "guardrails_check_toxicity",
  "Check text for toxicity using keyword/pattern matching (faster than scan_toxicity which is ML-based)",
  { text: z.string().describe("Text to check for toxicity") },
  async ({ text }) => {
    const result = checkToxicity(text);
    return text(result);
  },
);

// Log a violation directly
server.tool(
  "guardrails_log_violation",
  "Log a guardrail violation event to the violations table",
  {
    workspace_id: z.string().optional(),
    check_type: z.enum(["prompt_injection", "pii_detected", "policy_violation", "toxicity", "denylist"]),
    severity: z.enum(["low", "medium", "high", "critical"]),
    message: z.string(),
    metadata: z.record(z.any()).optional(),
    request_id: z.string().optional(),
    user_id: z.string().optional(),
  },
  async (opts) => text({ logged: await logViolation(sql, opts as any) }),
);

// Fingerprint lookup
server.tool(
  "guardrails_get_fingerprint",
  "Retrieve a stored fingerprint by ID",
  { id: z.string().describe("Fingerprint ID") },
  async ({ id }) => text(await getFingerprint(sql, id)),
);

// Stream guard — process a single chunk with configurable guards
server.tool(
  "guardrails_stream_guard",
  "Run guard checks on a single text chunk (PII redaction, injection detection, policy check)",
  {
    text: z.string().describe("Text chunk to guard"),
    workspace_id: z.string().uuid().optional(),
    check_pii: z.boolean().optional().default(true),
    check_injection: z.boolean().optional().default(true),
    check_rules: z.boolean().optional().default(false),
  },
  async ({ text, workspace_id, check_pii, check_injection, check_rules }) =>
    text(await streamGuard(sql, text, { workspaceId: workspace_id, checkPII: check_pii, checkInjection: check_injection, checkRules: check_rules })),
);

// Latest rule version lookup
server.tool(
  "guardrails_get_latest_rule_version",
  "Get the most recent version number and details of a rule",
  { rule_id: z.string().uuid().describe("Rule ID") },
  async ({ rule_id }) => text(await getLatestRuleVersion(sql, rule_id)),
);

// Streaming toxicity guard
server.tool(
  "guardrails_stream_toxicity",
  "Stream toxicity detection over text chunks, yielding toxicity match events as content is scanned",
  {
    text: z.string().describe("Text content to scan for toxicity"),
    threshold: z.number().min(0).max(1).optional().default(0.7).describe("Toxicity threshold 0-1"),
  },
  async ({ text, threshold }) => {
    const matches = streamToxicityGuard(text, threshold);
    return text({ matches, count: matches.length });
  },
);

server.tool(
  "guardrails_redact_stream",
  "Redact PII from a text stream and return the redacted content",
  {
    text: z.string().describe("Text to redact PII from"),
    placeholder: z.string().optional().default("[REDACTED]").describe("Placeholder for redactions"),
  },
  async ({ text, placeholder }) => {
    const redacted = redactStreamText(text, placeholder);
    return text({ redacted });
  },
);

// DSL rule management via MCP
server.tool(
  "guardrails_add_dsl_rule",
  "Add a new DSL guard rule to the database",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    name: z.string(),
    pattern: z.string().describe("DSL pattern expression"),
    severity: z.enum(["low", "medium", "high", "critical"]),
    action: z.enum(["block", "redact", "warn", "log"]),
    priority: z.number().int().optional().default(0),
    enabled: z.boolean().optional().default(true),
  },
  async ({ workspace_id, name, pattern, severity, action, priority, enabled }) => {
    const rule = await addGuardRule(sql, {
      workspaceId: workspace_id, name, pattern, severity, action, priority, enabled,
    });
    return text({ rule });
  },
);

server.tool(
  "guardrails_toggle_dsl_rule",
  "Enable or disable a DSL guard rule by ID",
  { id: z.string(), enabled: z.boolean() },
  async ({ id, enabled }) => text({ toggled: await toggleGuardRule(sql, id, enabled) }),
);

server.tool(
  "guardrails_update_dsl_rule",
  "Update attributes of an existing DSL guard rule",
  {
    id: z.string(),
    name: z.string().optional(),
    pattern: z.string().optional(),
    severity: z.enum(["low", "medium", "high", "critical"]).optional(),
    action: z.enum(["block", "redact", "warn", "log"]).optional(),
    priority: z.number().int().optional(),
    enabled: z.boolean().optional(),
  },
  async (updates) => text({ updated: await updateGuardRule(sql, updates as any) }),
);

// ─── Targeted PII Detectors ──────────────────────────────────────────────────

server.tool(
  "guardrails_detect_ip_address",
  "Detect IP addresses (IPv4 and IPv6) in text",
  { text: z.string().describe("Text to scan") },
  async ({ text }) => text({ matches: detectIPAddress(text) }),
);

server.tool(
  "guardrails_detect_date_of_birth",
  "Detect dates of birth in various formats (MM/DD/YYYY, YYYY-MM-DD, Month DD YYYY)",
  { text: z.string().describe("Text to scan") },
  async ({ text }) => text({ matches: detectDateOfBirth(text) }),
);

server.tool(
  "guardrails_detect_license_plate",
  "Detect vehicle license plates (US and EU formats)",
  { text: z.string().describe("Text to scan") },
  async ({ text }) => text({ matches: detectLicensePlate(text) }),
);

server.tool(
  "guardrails_detect_medical_license",
  "Detect medical license / NPI numbers (US 10-digit provider identifiers)",
  { text: z.string().describe("Text to scan") },
  async ({ text }) => text({ matches: detectMedicalLicense(text) }),
);

// ─── DSL Rule Evaluation ─────────────────────────────────────────────────────

server.tool(
  "guardrails_evaluate_dsl_rule",
  "Evaluate a DSL guard rule pattern against text without storing it",
  {
    pattern: z.string().describe("DSL pattern expression (e.g. contains(pii.email))"),
    text: z.string().describe("Text to evaluate against the pattern"),
    rule_name: z.string().optional().describe("Optional rule name for reporting"),
    action: z.enum(["block", "redact", "warn", "log"]).optional().default("log"),
  },
  async ({ pattern, text, rule_name, action }) => {
    const validation = validateDSLPattern(pattern);
    if (!validation.valid) {
      return text({ valid: false, error: validation.error });
    }
    return text(await evaluateDSLRule({ name: rule_name ?? "inline", pattern, action: action ?? "log" }, text));
  },
);

server.tool(
  "guardrails_validate_dsl_pattern",
  "Validate a DSL pattern without executing it — checks syntax, balanced parens, known functions",
  { pattern: z.string().describe("DSL pattern to validate") },
  async ({ pattern }) => text(validateDSLPattern(pattern)),
);

// ─── Streaming Guard ─────────────────────────────────────────────────────────

server.tool(
  "guardrails_check_input_stream",
  "Check input text stream for guard violations (PII, toxicity, policy) as a stream",
  {
    text: z.string().describe("Input text to check"),
    workspace_id: z.string().optional().describe("Optional workspace ID"),
  },
  async ({ text: inputText, workspace_id }) =>
    text(await checkInputStream(sql, inputText, workspace_id)),
);

server.tool(
  "guardrails_check_output_stream",
  "Check output text stream for guard violations as a stream",
  {
    text: z.string().describe("Output text to check"),
    workspace_id: z.string().optional().describe("Optional workspace ID"),
  },
  async ({ text: inputText, workspace_id }) =>
    text(await checkOutputStream(sql, inputText, workspace_id)),
);

// ─── Client Rate Limiting ────────────────────────────────────────────────────

server.tool(
  "guardrails_identify_client",
  "Identify a client by IP address, API key, and/or user agent — returns a stable client ID",
  {
    ip_address: z.string().optional(),
    api_key: z.string().optional(),
    user_agent: z.string().optional(),
  },
  async ({ ip_address, api_key, user_agent }) =>
    text({ client_id: identifyClient(ip_address, api_key, user_agent) }),
);

server.tool(
  "guardrails_list_client_rate_limits",
  "List all per-client rate limit configurations for a workspace",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => text(await listClientRateLimitStatuses(sql, workspace_id)),
);

server.tool(
  "guardrails_clear_client_block",
  "Clear a block for a specific client ID in a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    client_id: z.string().describe("Client ID to unblock"),
  },
  async ({ workspace_id, client_id }) =>
    text({ cleared: await clearClientBlock(sql, workspace_id, client_id) }),
);

// ─── Adaptive Guard ──────────────────────────────────────────────────────────

server.tool(
  "guardrails_apply_adaptive_strictness",
  "Apply adaptive strictness level adjustment to the guard system",
  {
    workspace_id: z.string().describe("Workspace ID"),
    level: z.enum(["relaxed", "normal", "strict", "paranoid"]),
  },
  async ({ workspace_id, level }) =>
    text(await applyAdaptiveStrictness(sql, workspace_id, level)),
);

// ─── Batch DSL Rule Evaluation ─────────────────────────────────────────────────

server.tool(
  "guardrails_evaluate_guard_rules",
  "Evaluate multiple DSL guard rules against input text in one call — returns all matches",
  {
    workspace_id: z.string().uuid().describe("Workspace ID"),
    text: z.string().describe("Input text to evaluate against all enabled rules"),
    rule_ids: z.array(z.string().uuid()).optional().describe("Specific rule IDs to evaluate; omit to use all enabled rules"),
    stop_on_first: z.boolean().optional().default(false).describe("Stop after first match (for efficiency)"),
  },
  async ({ workspace_id, text, rule_ids, stop_on_first }) => {
    const { evaluateGuardRules } = await import("../lib/dsl-rules.js");
    return text(await evaluateGuardRules(sql, workspace_id, text, rule_ids, stop_on_first));
  },
);

// ─── Redact PII from Text ───────────────────────────────────────────────────────

server.tool(
  "guardrails_redact_text",
  "Scan text for PII and redact all detected personally identifiable information — returns redacted text and list of redactions",
  {
    text: z.string().describe("Text to scan and redact"),
    pii_types: z.array(z.string()).optional().describe("PII types to target (default: all detected types)"),
    replacement: z.string().optional().default("[REDACTED]").describe("Replacement string for redacted content"),
  },
  async ({ text, pii_types, replacement }) => {
    const { scanPII, redactPII } = await import("../lib/pii.js");
    const matches = scanPII(text);
    const filtered = pii_types ? matches.filter(m => pii_types.includes(m.type)) : matches;
    const redacted = redactPII(text, filtered);
    return text({ redacted, redactions: filtered, count: filtered.length });
  },
);

// ─── Get Workspace Quota Config ─────────────────────────────────────────────────

server.tool(
  "guardrails_get_workspace_quota",
  "Get the current quota configuration for a workspace (daily or monthly limits)",
  {
    workspace_id: z.string().uuid().describe("Workspace ID"),
  },
  async ({ workspace_id }) => {
    const { getWorkspaceQuotaUsage } = await import("../lib/workspace-quotas.js");
    return text(await getWorkspaceQuotaUsage(sql, workspace_id, undefined));
  },
);

// ─── Real-time Streaming PII Redaction ──────────────────────────────────────

server.tool(
  "guardrails_stream_redact_realtime",
  "Redact PII from streaming text in real-time with per-type thresholds and adaptive redaction",
  {
    text: z.string().describe("Text chunk to redact"),
    pii_types: z.array(z.enum(["email", "phone", "ssn", "credit_card", "ip_address", "date_of_birth", "license_plate", "medical_license"])).optional().describe("PII types to target; omit for all types"),
    threshold: z.number().min(0).max(1).optional().default(0.85).describe("Confidence threshold for detection"),
    placeholder: z.string().optional().default("[REDACTED]").describe("Replacement string"),
    return_matches: z.boolean().optional().default(false).describe("Include match positions in response"),
  },
  async ({ text, pii_types, threshold, placeholder, return_matches }) => {
    const { scanPII, redactPII } = await import("../lib/pii.js");
    const matches = scanPII(text);
    const filtered = pii_types ? matches.filter(m => (pii_types as string[]).includes(m.type)) : matches;
    const redacted = redactPII(text, filtered);
    return text({
      redacted,
      redaction_count: filtered.length,
      ...(return_matches ? { matches: filtered } : {}),
    });
  },
);

// ─── Batch DSL Rule Evaluation ───────────────────────────────────────────────

server.tool(
  "guardrails_evaluate_dsl_batch",
  "Evaluate DSL rules against multiple texts in a single batch call — returns per-text results",
  {
    texts: z.array(z.string()).describe("Array of texts to evaluate (max 50)"),
    rule_patterns: z.array(z.object({
      name: z.string(),
      pattern: z.string(),
      action: z.enum(["block", "redact", "warn", "log"]).optional().default("log"),
    })).describe("DSL rules to evaluate each text against"),
    stop_on_first: z.boolean().optional().default(false).describe("Stop at first match per text"),
  },
  async ({ texts, rule_patterns, stop_on_first }) => {
    const { evaluateDSLRule, validateDSLPattern } = await import("../lib/dsl-rules.js");
    const results = [];
    for (const text of texts.slice(0, 50)) {
      const textResults = [];
      for (const rule of rule_patterns) {
        const validation = validateDSLPattern(rule.pattern);
        if (!validation.valid) {
          textResults.push({ rule: rule.name, valid: false, error: validation.error });
          continue;
        }
        const result = await evaluateDSLRule({ name: rule.name, pattern: rule.pattern, action: rule.action ?? "log" }, text);
        textResults.push({ rule: rule.name, ...result });
        if (stop_on_first && result.matched) break;
      }
      results.push({ text_length: text.length, matches: textResults });
    }
    return text({ texts_evaluated: texts.length, results });
  },
);

// ─── Prometheus Text Format Utility ─────────────────────────────────────────

server.tool(
  "guardrails_format_prometheus",
  "Convert guardrails metrics JSON to Prometheus text exposition format",
  {
    metrics_json: z.string().describe("JSON metrics object from guardrails_metrics_json"),
    include_prefix: z.boolean().optional().default(true).describe("Include metric name prefixes"),
  },
  async ({ metrics_json, include_prefix }) => {
    const { toPrometheusTextFormat } = await import("../lib/guardrails-metrics.js");
    const metrics = JSON.parse(metrics_json);
    return text({ prometheus: toPrometheusTextFormat(metrics, include_prefix ?? true) });
  },
);

// ─── Workspace Rule Batch Operations ─────────────────────────────────────────

server.tool(
  "guardrails_batch_toggle_rules",
  "Enable or disable multiple guard rules in one call",
  {
    rule_ids: z.array(z.string()).describe("Array of rule IDs to toggle"),
    enabled: z.boolean().describe("Target enabled state"),
  },
  async ({ rule_ids, enabled }) => {
    const { toggleGuardRule } = await import("../lib/dsl-rules.js");
    const results = await Promise.all(rule_ids.map(async (id) => {
      try { return { id, success: await toggleGuardRule(sql, id, enabled) }; }
      catch (e) { return { id, success: false, error: String(e) }; }
    }));
    return text({ toggled: results.length, results });
  },
);

server.tool(
  "guardrails_batch_delete_rules",
  "Delete multiple guard rules in one call (returns IDs that were deleted)",
  {
    rule_ids: z.array(z.string()).describe("Array of rule IDs to delete"),
  },
  async ({ rule_ids }) => {
    const { deleteGuardRule } = await import("../lib/dsl-rules.js");
    const results = await Promise.all(rule_ids.map(async (id) => {
      try { await deleteGuardRule(sql, id); return { id, deleted: true }; }
      catch (e) { return { id, deleted: false, error: String(e) }; }
    }));
    return text({ deleted: results.filter(r => r.deleted).length, results });
  },
);

// ─── DSL Rule Import/Export ───────────────────────────────────────────────────

server.tool(
  "guardrails_export_rules_json",
  "Export all guard rules for a workspace as JSON (for backup/migration)",
  {
    workspace_id: z.string().describe("Workspace ID"),
    include_disabled: z.boolean().optional().default(false).describe("Include disabled rules"),
  },
  async ({ workspace_id, include_disabled }) => {
    const { listGuardRules } = await import("../lib/dsl-rules.js");
    const rules = await listGuardRules(sql, { workspaceId: workspace_id });
    const filtered = include_disabled ? rules : rules.filter(r => r.enabled);
    return text({ rules: filtered, count: filtered.length });
  },
);

// ─── DSL Rule Import/Clone/Batch ─────────────────────────────────────────────

server.tool(
  "guardrails_clone_rule",
  "Clone an existing guard rule — creates a new rule with a new name copying the same pattern, severity, action, and priority. Useful for creating variations of existing rules.",
  {
    source_rule_id: z.string().uuid().describe("ID of the rule to clone"),
    new_name: z.string().describe("Name for the cloned rule"),
    new_workspace_id: z.string().optional().describe("Workspace ID for the clone (future use, rules are global)"),
  },
  async ({ source_rule_id, new_name }) => {
    const { listGuardRules, addGuardRule } = await import("../lib/dsl-rules.js");
    const rules = await listGuardRules(sql);
    const source = rules.find(r => r.id === source_rule_id);
    if (!source) return text({ error: `Rule not found: ${source_rule_id}` });
    const cloned = await addGuardRule(sql, {
      name: new_name,
      pattern: source.pattern,
      severity: source.severity,
      action: source.action,
      priority: source.priority,
      enabled: false, // Start disabled so it can be reviewed before enabling
    });
    return text({ cloned, message: `Cloned '${source.name}' → '${new_name}' (disabled — review and enable when ready)` });
  },
);

server.tool(
  "guardrails_import_rules_json",
  "Import one or more guard rules from JSON. Returns IDs of created rules. Skips rules with duplicate names (idempotent).",
  {
    rules_json: z.string().describe("JSON array of rule objects with fields: name, pattern, severity, action, priority, enabled"),
  },
  async ({ rules_json }) => {
    const { addGuardRule, listGuardRules, validateDSLPattern } = await import("../lib/dsl-rules.js");
    let rules: any[];
    try { rules = JSON.parse(rules_json); } catch { return text({ error: "Invalid JSON" }); }
    if (!Array.isArray(rules)) return text({ error: "Expected JSON array of rules" });
    if (rules.length === 0) return text({ imported: 0, skipped: 0, errors: [] });

    const existing = await listGuardRules(sql);
    const existingNames = new Set(existing.map(r => r.name));
    const results: { name: string; id?: string; error?: string; skipped: boolean }[] = [];

    for (const rule of rules.slice(0, 50)) {
      if (!rule.name || !rule.pattern) {
        results.push({ name: rule.name || "(unnamed)", error: "Missing name or pattern", skipped: false });
        continue;
      }
      if (existingNames.has(rule.name)) {
        results.push({ name: rule.name, skipped: true });
        continue;
      }
      const validation = validateDSLPattern(rule.pattern);
      if (!validation.valid) {
        results.push({ name: rule.name, error: `Invalid pattern: ${validation.error}`, skipped: false });
        continue;
      }
      try {
        const created = await addGuardRule(sql, {
          name: rule.name,
          pattern: rule.pattern,
          severity: rule.severity || "medium",
          action: rule.action || "warn",
          priority: rule.priority || 100,
          enabled: rule.enabled !== undefined ? rule.enabled : true,
        });
        results.push({ name: rule.name, id: (created as any).id, skipped: false });
      } catch (e) {
        results.push({ name: rule.name, error: String(e), skipped: false });
      }
    }
    return text({
      imported: results.filter(r => !r.skipped && !r.error).length,
      skipped: results.filter(r => r.skipped).length,
      errors: results.filter(r => r.error).map(r => ({ name: r.name, error: r.error })),
      details: results,
    });
  },
);

server.tool(
  "guardrails_validate_batch",
  "Validate multiple DSL patterns at once — returns validation result for each pattern with error position if invalid",
  {
    patterns: z.array(z.string()).describe("Array of DSL pattern strings to validate"),
  },
  async ({ patterns }) => {
    const { validateDSLPattern } = await import("../lib/dsl-rules.js");
    const results = patterns.slice(0, 100).map((pattern, i) => ({
      index: i,
      pattern,
      ...validateDSLPattern(pattern),
    }));
    return text({ results, total: results.length, valid: results.filter(r => r.valid).length, invalid: results.filter(r => !r.valid).length });
  },
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// --- Rule version comparison and pruning ---

server.tool(
  "guardrails_compare_rule_versions",
  "Compare two versions of a guard rule side-by-side — shows what fields changed between versions",
  {
    rule_id: z.string().describe("Rule ID"),
    version_a: z.number().int().positive().describe("First version number (older)"),
    version_b: z.number().int().positive().describe("Second version number (newer)"),
  },
  async ({ rule_id, version_a, version_b }) => {
    const { compareRuleVersions } = await import("../lib/rule-versioning.js");
    return text(await compareRuleVersions(sql, rule_id, version_a, version_b));
  },
);

server.tool(
  "guardrails_get_rule_diff",
  "Get a human-readable diff between two versions of a guard rule",
  {
    rule_id: z.string().describe("Rule ID"),
    from_version: z.number().int().positive().describe("Source version number"),
    to_version: z.number().int().positive().describe("Target version number"),
  },
  async ({ rule_id, from_version, to_version }) => {
    const { getRuleVersionDiff } = await import("../lib/rule-versioning.js");
    return text(await getRuleVersionDiff(sql, rule_id, from_version, to_version));
  },
);

server.tool(
  "guardrails_prune_rule_versions",
  "Prune old rule versions to save storage — keeps the most recent N versions per rule",
  {
    rule_id: z.string().optional().describe("Rule ID to prune (omit for all rules)"),
    keep_latest: z.number().int().positive().optional().default(10).describe("Number of recent versions to keep per rule"),
    older_than_days: z.number().int().positive().optional().describe("Also prune versions older than N days"),
  },
  async ({ rule_id, keep_latest, older_than_days }) => {
    const { pruneRuleVersions } = await import("../lib/rule-versioning.js");
    const pruned = await pruneRuleVersions(sql, { ruleId: rule_id, keepLatest: keep_latest, olderThanDays: older_than_days });
    return text({ pruned_count: pruned });
  },
);

// --- Replay detection ---

server.tool(
  "guardrails_clear_replay_window",
  "Clear the replay detection window for a client — reset replay tracking state",
  {
    client_id: z.string().describe("Client ID to clear replay window for"),
  },
  async ({ client_id }) => {
    const { clearReplayWindow } = await import("../lib/replay-detector.js");
    await clearReplayWindow(sql, client_id);
    return text({ cleared: true });
  },
);

server.tool(
  "guardrails_check_replay",
  "Check if a request is a replay attack — same content seen within the replay window",
  {
    client_id: z.string().describe("Client ID making the request"),
    content_hash: z.string().describe("Hash of the request content to check"),
  },
  async ({ client_id, content_hash }) => {
    const { checkReplay } = await import("../lib/replay-detector.js");
    const result = await checkReplay(sql, client_id, content_hash);
    return text({ is_replay: result });
  },
);

main().catch(console.error);

// --- Additional streaming guard tools ---

server.tool(
  "guardrails_identify_client",
  "Identify a client ID from IP address and/or API key and/or user agent — used for rate limiting",
  {
    ip_address: z.string().optional().describe("Client IP address"),
    api_key: z.string().optional().describe("Client API key"),
    user_agent: z.string().optional().describe("Client user agent string"),
  },
  async ({ ip_address, api_key, user_agent }) => {
    const { identifyClient } = await import("../lib/client-rate-limits.js");
    const clientId = identifyClient(ip_address, api_key, user_agent);
    return text({ client_id: clientId });
  },
);

server.tool(
  "guardrails_check_stream_input_chunks",
  "Check an array of text chunks sequentially for guard violations — simulates checkInputStream locally with buffer accumulation across chunks",
  {
    chunks: z.array(z.string()).describe("Text chunks to check in order"),
    workspace_id: z.string().optional().describe("Workspace ID to check against"),
  },
  async ({ chunks, workspace_id }) => {
    const { checkInput } = await import("../lib/guard.js");
    const results: { chunk: string; safe: boolean; violations: any[] }[] = [];
    let buffer = "";

    for (const chunk of chunks) {
      buffer += chunk;
      const result = await checkInput(sql, buffer, workspace_id);
      results.push({
        chunk: result.sanitized,
        safe: result.safe,
        violations: result.violations,
      });
    }

    return text({
      results,
      total_chunks: chunks.length,
      all_safe: results.every(r => r.safe),
    });
  },
);

server.tool(
  "guardrails_check_stream_output_chunks",
  "Check an array of output text chunks sequentially for PII, toxicity, and policy violations",
  {
    chunks: z.array(z.string()).describe("Output text chunks to check in order"),
    workspace_id: z.string().optional().describe("Workspace ID to check against"),
  },
  async ({ chunks, workspace_id }) => {
    const { checkOutput } = await import("../lib/guard.js");
    const results: { chunk: string; safe: boolean; violations: any[] }[] = [];

    for (const chunk of chunks) {
      const result = await checkOutput(sql, chunk, workspace_id);
      results.push({
        chunk: result.sanitized,
        safe: result.safe,
        violations: result.violations,
      });
    }

    return text({
      results,
      total_chunks: chunks.length,
      all_safe: results.every(r => r.safe),
    });
  },
);

server.tool(
  "guardrails_stream_guard_redact_chunks",
  "Redact PII from an array of text chunks in streaming fashion — maintains cross-chunk PII buffer for split entities",
  {
    chunks: z.array(z.string()).describe("Text chunks to redact PII from in order"),
    redact: z.boolean().optional().default(true).describe("Whether to replace PII with placeholders"),
    placeholder_template: z.string().optional().default("[REDACTED_{type}]").describe("Placeholder template with {type} placeholder"),
  },
  async ({ chunks, redact = true, placeholder_template = "[REDACTED_{type}]" }) => {
    const { scanPII, redactPII: doRedact } = await import("../lib/pii.js");

    let buffer = "";
    const allMatches: any[] = [];
    const redactedChunks: string[] = [];

    for (const chunk of chunks) {
      buffer += chunk;

      const matches = scanPII(buffer);
      const newMatches = matches.slice(allMatches.length);

      if (newMatches.length > 0) {
        allMatches.push(...newMatches);

        if (redact) {
          const sortedNew = [...newMatches].sort((a, b) => b.start - a.start);
          for (const m of sortedNew) {
            const placeholder = placeholder_template.replace("{type}", m.type.toUpperCase());
            buffer = buffer.slice(0, m.start) + placeholder + buffer.slice(m.end);
          }
        }
      }

      redactedChunks.push(buffer);
      // Advance buffer position to avoid re-scanning already-processed text
      // Keep last 200 chars as overlap for potential cross-chunk entities
      if (buffer.length > 200) {
        buffer = buffer.slice(-200);
      }
    }

    return text({
      redacted_chunks: redactedChunks,
      total_chunks: chunks.length,
      pii_matches_found: allMatches.length,
    });
  },
);

server.tool(
  "guardrails_get_client_rate_limit_status",
  "Get current rate limit status for a client — shows request count, limit, reset time, and block status",
  {
    client_id: z.string().describe("Client ID to check"),
    workspace_id: z.string().describe("Workspace ID the client belongs to"),
  },
  async ({ client_id, workspace_id }) => {
    const { checkClientRateLimit } = await import("../lib/client-rate-limits.js");
    const status = await checkClientRateLimit(sql, workspace_id, client_id);
    return text(status);
  },
);

server.tool(
  "guardrails_list_active_rate_limits",
  "List all clients currently at or near their rate limit — for monitoring abuse",
  {
    workspace_id: z.string().describe("Workspace ID to list clients for"),
  },
  async ({ workspace_id }) => {
    const { listClientRateLimitStatuses } = await import("../lib/client-rate-limits.js");
    const limits = await listClientRateLimitStatuses(sql, workspace_id);
    return text({ limits, count: limits.length });
  },
);

server.tool(
  "guardrails_evaluate_shadow",
  "Evaluate content against guardrail policies in shadow mode — returns what WOULD happen without blocking",
  {
    content: z.string().describe("Content to evaluate in shadow mode"),
    workspace_id: z.string().describe("Workspace ID"),
    policy_id: z.string().optional().describe("Optional specific policy ID to test"),
  },
  async ({ content, workspace_id, policy_id }) => {
    const result = await evaluateShadowMode(sql, workspace_id, content, policy_id);
    return text(result);
  },
);

server.tool(
  "guardrails_shadow_stats",
  "Get shadow mode evaluation statistics for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    days: z.number().int().positive().optional().default(7).describe("Number of days to look back"),
  },
  async ({ workspace_id, days }) => {
    const stats = await getShadowModeStats(sql, workspace_id, days);
    return text(stats);
  },
);

server.tool(
  "guardrails_list_shadow_evaluations",
  "List recent shadow mode evaluations",
  {
    workspace_id: z.string().describe("Workspace ID"),
    limit: z.number().int().positive().optional().default(50).describe("Max evaluations to return"),
  },
  async ({ workspace_id, limit }) => {
    const evaluations = await listShadowEvaluations(sql, workspace_id, limit);
    return text({ evaluations, count: evaluations.length });
  },
);

server.tool(
  "guardrails_bulk_guard_check",
  "Check multiple texts against all guard rules (PII, injection, toxicity, policies) in one batch call — returns per-text results",
  {
    texts: z.array(z.string()).describe("Array of texts to check"),
    workspace_id: z.string().optional().describe("Optional workspace ID for policy evaluation"),
    direction: z.enum(["input", "output"]).optional().default("input").describe("Check direction: input or output"),
  },
  async ({ texts, workspace_id, direction }) => {
    const checkFn = direction === "output"
      ? (t: string) => checkOutput(sql, t, workspace_id)
      : (t: string) => checkInput(sql, t, workspace_id);
    const results = await Promise.all(texts.map((text, i) =>
      checkFn(text).then(result => ({ index: i, text: text.slice(0, 100), result }))
    ));
    return text({
      total: texts.length,
      results,
      summary: {
        total_violations: results.filter(r => r.result.violations && r.result.violations.length > 0).length,
        clean_count: results.filter(r => !r.result.violations || r.result.violations.length === 0).length,
      },
    });
  },
);

server.tool(
  "guardrails_guard_workspace_summary",
  "Get a quick at-a-glance guard activity summary for a workspace — total checks, violations, violation rate, top issues",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_hours: z.number().int().positive().optional().default(24).describe("Hours to look back"),
  },
  async ({ workspace_id, period_hours }) => {
    const since = new Date(Date.now() - period_hours * 3600_000);

    const [checksResult, violationsResult, topTypes, topSeverity] = await Promise.all([
      sql`SELECT COUNT(*) as count FROM guardrails.audit_log WHERE workspace_id = ${workspace_id} AND created_at >= ${since}`,
      sql`SELECT COUNT(*) as count FROM guardrails.violations WHERE workspace_id = ${workspace_id} AND created_at >= ${since}`,
      sql`SELECT type, COUNT(*) as count FROM guardrails.violations WHERE workspace_id = ${workspace_id} AND created_at >= ${since} GROUP BY type ORDER BY count DESC LIMIT 5`,
      sql`SELECT severity, COUNT(*) as count FROM guardrails.violations WHERE workspace_id = ${workspace_id} AND created_at >= ${since} GROUP BY severity ORDER BY count DESC LIMIT 5`,
    ]);

    const totalChecks = parseInt((checksResult[0] as { count: string }).count, 10);
    const totalViolations = parseInt((violationsResult[0] as { count: string }).count, 10);
    const violationRate = totalChecks > 0 ? ((totalViolations / totalChecks) * 100).toFixed(2) : "0.00";

    return text({
      workspace_id,
      period_hours,
      total_checks: totalChecks,
      total_violations: totalViolations,
      violation_rate_pct: parseFloat(violationRate),
      top_violation_types: topTypes.map((r: { type: string; count: string }) => ({ type: r.type, count: parseInt(r.count, 10) })),
      top_severities: topSeverity.map((r: { severity: string; count: string }) => ({ severity: r.severity, count: parseInt(r.count, 10) })),
      status: totalViolations === 0 ? "healthy" : totalViolations > totalChecks * 0.1 ? "critical" : "warning",
    });
  },
);

server.tool(
  "guardrails_redact_pii",
  "Redact PII from text using pre-detected PII matches — replaces matched ranges with [REDACTED]",
  {
    text: z.string().describe("Text to redact PII from"),
    matches: z.array(z.object({
      type: z.string(),
      start: z.number(),
      end: z.number(),
      text: z.string(),
    })).describe("PII matches from scan_pii to redact"),
  },
  async ({ text, matches }) => {
    const redacted = redactPII(text, matches as any);
    return text({ original_length: text.length, redacted_length: redacted.length, redacted });
  },
);

server.tool(
  "guardrails_evaluate_guard_rules",
  "Evaluate multiple guard rules against a text input simultaneously",
  {
    text: z.string().describe("Text to evaluate"),
    workspace_id: z.string().optional(),
    rule_ids: z.array(z.string()).optional().describe("Specific rule IDs to evaluate (omit for all active rules)"),
  },
  async ({ text, workspace_id, rule_ids }) => {
    const result = await evaluateGuardRules(sql, text, { workspaceId: workspace_id, ruleIds: rule_ids });
    return text(result);
  },
);

server.tool(
  "guardrails_get_rule_version_diff",
  "Get a diff between two versions of a guard rule",
  { rule_id: z.string().describe("Rule ID"), version_a: z.number().int().positive(), version_b: z.number().int().positive() },
  async ({ rule_id, version_a, version_b }) => text(await getRuleVersionDiff(sql, rule_id, version_a, version_b)),
);

server.tool(
  "guardrails_prune_rule_versions",
  "Delete old rule versions, keeping only the N most recent versions",
  { rule_id: z.string().describe("Rule ID"), keep_count: z.number().int().positive().default(5) },
  async ({ rule_id, keep_count }) => text({ deleted: await pruneRuleVersions(sql, rule_id, keep_count) }),
);

server.tool(
  "guardrails_compare_rule_versions",
  "Compare two rule versions and return a detailed comparison",
  { rule_id: z.string().describe("Rule ID"), version_a: z.number().int().positive(), version_b: z.number().int().positive() },
  async ({ rule_id, version_a, version_b }) => text(await compareRuleVersions(sql, rule_id, version_a, version_b)),
);

server.tool(
  "guardrails_check_workspace_quota",
  "Check if a workspace has exceeded its guardrails usage quota",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => text(await checkWorkspaceQuota(sql, workspace_id)),
);

server.tool(
  "guardrails_record_quota_usage",
  "Record guardrails API usage for a workspace (for quota tracking)",
  { workspace_id: z.string().describe("Workspace ID"), increment_by: z.number().int().positive().default(1) },
  async ({ workspace_id, increment_by }) => text({ recorded: await recordQuotaUsage(sql, workspace_id, increment_by) }),
);

server.tool(
  "guardrails_get_quota_usage",
  "Get current usage statistics for a workspace's guardrails quota",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => text(await getWorkspaceQuotaUsage(sql, workspace_id)),
);

server.tool(
  "guardrails_delete_workspace_quota",
  "Delete the quota configuration for a workspace",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => text({ deleted: await deleteWorkspaceQuota(sql, workspace_id) }),
);

server.tool(
  "guardrails_export_metrics_json",
  "Export guardrails metrics as JSON",
  { workspace_id: z.string().optional(), start_date: z.string().optional(), end_date: z.string().optional() },
  async ({ workspace_id, start_date, end_date }) => text(await exportGuardrailsMetricsJSON(sql, workspace_id, start_date, end_date)),
);
