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
