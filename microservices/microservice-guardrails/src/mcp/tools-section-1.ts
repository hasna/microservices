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

