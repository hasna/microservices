// --- Consolidation policies ---

server.tool(
  "memory_upsert_consolidation_policy",
  "Create or update a scheduled consolidation policy for episodic memories",
  {
    workspace_id: z.string(),
    namespace: z.string(),
    name: z.string(),
    trigger: z.enum(["schedule", "count_threshold", "size_threshold", "manual"]).optional(),
    cron_expression: z.string().optional(),
    min_episodic_count: z.number().int().positive().optional(),
    min_total_size_bytes: z.number().int().positive().optional(),
    window_hours: z.number().int().positive().optional().default(24),
    consolidation_mode: z.enum(["summary_only", "delete_source", "archive"]).optional(),
    priority_threshold: z.number().int().optional(),
    memory_type_filter: z.string().optional(),
  },
  async (opts) =>
    text(await upsertConsolidationPolicy(sql, {
      workspaceId: opts.workspace_id,
      namespace: opts.namespace,
      name: opts.name,
      trigger: opts.trigger,
      cronExpression: opts.cron_expression,
      minEpisodicCount: opts.min_episodic_count,
      minTotalSizeBytes: opts.min_total_size_bytes,
      windowHours: opts.window_hours,
      consolidationMode: opts.consolidation_mode,
      priorityThreshold: opts.priority_threshold,
      memoryTypeFilter: opts.memory_type_filter,
    })),
);

server.tool(
  "memory_set_consolidation_policy_enabled",
  "Enable or disable a consolidation policy",
  {
    policy_id: z.string(),
    enabled: z.boolean(),
  },
  async ({ policy_id, enabled }) => {
    await setConsolidationPolicyEnabled(sql, policy_id, enabled);
    return text({ ok: true });
  },
);

server.tool(
  "memory_list_consolidation_policies",
  "List all consolidation policies for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) =>
    text(await listConsolidationPolicies(sql, workspace_id)),
);

server.tool(
  "memory_get_consolidation_policy",
  "Get a consolidation policy by ID",
  { policy_id: z.string() },
  async ({ policy_id }) => text(await getConsolidationPolicy(sql, policy_id)),
);

server.tool(
  "memory_get_due_consolidation_policies",
  "Get enabled consolidation policies that are due to run",
  { workspace_id: z.string() },
  async ({ workspace_id }) =>
    text(await getDueConsolidationPolicies(sql, workspace_id)),
);

server.tool(
  "memory_run_consolidation_policy",
  "Manually trigger a consolidation policy to run immediately",
  { policy_id: z.string() },
  async ({ policy_id }) => text(await runConsolidationPolicy(sql, policy_id)),
);

server.tool(
  "memory_delete_consolidation_policy",
  "Delete a consolidation policy",
  { policy_id: z.string() },
  async ({ policy_id }) =>
    text({ deleted: await deleteConsolidationPolicy(sql, policy_id) }),
);

server.tool(
  "memory_consolidation_stats",
  "Get summary stats of consolidation policies for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await getConsolidationPolicyStats(sql, workspace_id)),
);

