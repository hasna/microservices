// ─── Memory Archival Policies ─────────────────────────────────────────────────

server.tool(
  "memory_create_archival_policy",
  "Create an automatic archival policy for memories",
  {
    workspace_id: z.string(),
    archive_tier: z.enum(["cold", "frozen", "deleted"]),
    trigger: z.enum(["age", "importance_threshold", "access_threshold", "namespace_quota", "manual"]),
    namespace: z.string().optional(),
    memory_type: z.string().optional(),
    age_threshold_seconds: z.number().int().optional(),
    importance_floor: z.number().optional(),
    access_count_floor: z.number().int().optional(),
    namespace_quota: z.number().int().optional(),
    retain_forever: z.boolean().optional().default(false),
    enabled: z.boolean().optional().default(true),
  },
  async ({
    workspace_id, archive_tier, trigger, namespace, memory_type,
    age_threshold_seconds, importance_floor, access_count_floor,
    namespace_quota, retain_forever, enabled,
  }) => {
    const { createArchivalPolicy } = await import("../lib/archival-policies.js");
    return text(await createArchivalPolicy(sql, {
      workspaceId: workspace_id,
      archiveTier: archive_tier as any,
      trigger: trigger as any,
      namespace: namespace ?? null,
      memoryType: memory_type ?? null,
      ageThresholdSeconds: age_threshold_seconds ?? null,
      importanceFloor: importance_floor ?? null,
      accessCountFloor: access_count_floor ?? null,
      namespaceQuota: namespace_quota ?? null,
      retainForever: retain_forever ?? false,
      enabled: enabled ?? true,
    }));
  },
);

server.tool(
  "memory_list_archival_policies",
  "List archival policies for a workspace",
  {
    workspace_id: z.string(),
    enabled: z.boolean().optional(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, enabled, namespace }) => {
    const { listArchivalPolicies } = await import("../lib/archival-policies.js");
    return text(await listArchivalPolicies(sql, workspace_id, {
      enabled: enabled ?? undefined,
      namespace: namespace ?? undefined,
    }));
  },
);

server.tool(
  "memory_execute_archival",
  "Execute archival policies — archive memories matching policy criteria",
  {
    workspace_id: z.string(),
    dry_run: z.boolean().optional().default(false),
  },
  async ({ workspace_id, dry_run }) => {
    const { executeArchivalPolicies } = await import("../lib/archival-policies.js");
    return text(await executeArchivalPolicies(sql, workspace_id));
  },
);

server.tool(
  "memory_get_archival_history",
  "Get archival history for a workspace",
  {
    workspace_id: z.string(),
    limit: z.number().int().optional().default(50),
  },
  async ({ workspace_id, limit }) => {
    const { listArchivalHistory } = await import("../lib/archival-policies.js");
    return text(await listArchivalHistory(sql, workspace_id, limit));
  },
);

