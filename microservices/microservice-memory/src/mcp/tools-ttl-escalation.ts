// ─── TTL Escalation ─────────────────────────────────────────────────────────────

server.tool(
  "memory_get_escalation_candidates",
  "Find memories expiring soon that qualify for TTL escalation based on importance, access, and links",
  {
    workspace_id: z.string(),
    window_hours: z.number().int().positive().optional().default(72),
  },
  async ({ workspace_id, window_hours }) => {
    const { getEscalationCandidates } = await import("../lib/ttl-escalation.js");
    return text(await getEscalationCandidates(sql, workspace_id, window_hours ?? 72));
  },
);

server.tool(
  "memory_escalate_memories",
  "Extend TTL for high-value memories approaching expiry",
  {
    workspace_id: z.string(),
    min_importance_score: z.number().min(0).max(1).optional().default(0.5),
    escalation_multiplier: z.number().positive().optional().default(2.0),
    max_ttl_seconds: z.number().int().positive().optional(),
    check_access_log: z.boolean().optional().default(false),
    access_log_hours_threshold: z.number().int().positive().optional().default(24),
    check_links: z.boolean().optional().default(false),
    dry_run: z.boolean().optional().default(false),
  },
  async ({
    workspace_id, min_importance_score, escalation_multiplier,
    max_ttl_seconds, check_access_log, access_log_hours_threshold,
    check_links, dry_run,
  }) => {
    const { escalateMemories } = await import("../lib/ttl-escalation.js");
    return text(await escalateMemories(sql, workspace_id, {
      minImportanceScore: min_importance_score ?? 0.5,
      escalationMultiplier: escalation_multiplier ?? 2.0,
      maxTTLSeconds: max_ttl_seconds ?? null,
      checkAccessLog: check_access_log ?? false,
      accessLogHoursThreshold: access_log_hours_threshold ?? 24,
      checkLinks: check_links ?? false,
      dryRun: dry_run ?? false,
    }));
  },
);

server.tool(
  "memory_get_escalation_stats",
  "Get TTL escalation stats for a workspace — memories in each value tier expiring soon",
  {
    workspace_id: z.string(),
    window_hours: z.number().int().positive().optional().default(72),
  },
  async ({ workspace_id, window_hours }) => {
    const { getEscalationStats } = await import("../lib/ttl-escalation.js");
    return text(await getEscalationStats(sql, workspace_id, window_hours ?? 72));
  },
);

server.tool(
  "memory_set_escalation_policy",
  "Set workspace-level TTL escalation policy",
  {
    workspace_id: z.string(),
    min_importance_score: z.number().min(0).max(1),
    escalation_multiplier: z.number().positive(),
    max_ttl_seconds: z.number().int().positive().nullable().optional(),
    check_access_log: z.boolean().optional().default(false),
    access_log_hours_threshold: z.number().int().positive().optional().default(24),
    check_links: z.boolean().optional().default(false),
  },
  async ({
    workspace_id, min_importance_score, escalation_multiplier,
    max_ttl_seconds, check_access_log, access_log_hours_threshold, check_links,
  }) => {
    const { setEscalationPolicy } = await import("../lib/ttl-escalation.js");
    await setEscalationPolicy(sql, workspace_id, {
      minImportanceScore: min_importance_score,
      escalationMultiplier: escalation_multiplier,
      maxTTLSeconds: max_ttl_seconds ?? null,
      checkAccessLog: check_access_log ?? false,
      accessLogHoursThreshold: access_log_hours_threshold ?? 24,
      checkLinks: check_links ?? false,
    });
    return text({ ok: true });
  },
);

server.tool(
  "memory_get_escalation_policy",
  "Get current TTL escalation policy for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const { getEscalationPolicy } = await import("../lib/ttl-escalation.js");
    return text(await getEscalationPolicy(sql, workspace_id));
  },
);

