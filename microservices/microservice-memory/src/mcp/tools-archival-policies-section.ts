// ---- Archival policies ----

server.tool(
  "memory_create_archival_policy",
  "Create an archival policy for a workspace",
  {
    workspace_id: z.string(),
    archive_tier: z.enum(["cold", "frozen", "deleted"]),
    trigger: z.enum(["age", "importance_threshold", "access_threshold", "namespace_quota", "manual"]),
    namespace: z.string().optional(),
    memory_type: z.string().optional(),
    age_threshold_seconds: z.number().optional(),
    importance_floor: z.number().min(0).max(1).optional(),
    access_count_floor: z.number().optional(),
    namespace_quota: z.number().optional(),
    enabled: z.boolean().optional(),
    retain_forever: z.boolean().optional(),
  },
  async (opts) =>
    text(
      await createArchivalPolicy(sql, {
        workspaceId: opts.workspace_id,
        namespace: opts.namespace,
        memoryType: opts.memory_type,
        archiveTier: opts.archive_tier,
        trigger: opts.trigger,
        ageThresholdSeconds: opts.age_threshold_seconds,
        importanceFloor: opts.importance_floor,
        accessCountFloor: opts.access_count_floor,
        namespaceQuota: opts.namespace_quota,
        enabled: opts.enabled,
        retainForever: opts.retain_forever,
      }),
    ),
);

server.tool(
  "memory_list_archival_policies",
  "List archival policies for a workspace",
  {
    workspace_id: z.string(),
    enabled: z.boolean().optional(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, enabled, namespace }) =>
    text(await listArchivalPolicies(sql, workspace_id, { enabled, namespace })),
);

server.tool(
  "memory_update_archival_policy",
  "Update an archival policy",
  {
    id: z.string(),
    namespace: z.string().optional(),
    memory_type: z.string().optional(),
    archive_tier: z.enum(["cold", "frozen", "deleted"]).optional(),
    trigger: z.enum(["age", "importance_threshold", "access_threshold", "namespace_quota", "manual"]).optional(),
    age_threshold_seconds: z.number().optional(),
    importance_floor: z.number().min(0).max(1).optional(),
    access_count_floor: z.number().optional(),
    namespace_quota: z.number().optional(),
    enabled: z.boolean().optional(),
    retain_forever: z.boolean().optional(),
  },
  async (opts) =>
    text(
      await updateArchivalPolicy(sql, opts.id, {
        namespace: opts.namespace,
        memoryType: opts.memory_type,
        archiveTier: opts.archive_tier,
        trigger: opts.trigger,
        ageThresholdSeconds: opts.age_threshold_seconds,
        importanceFloor: opts.importance_floor,
        accessCountFloor: opts.access_count_floor,
        namespaceQuota: opts.namespace_quota,
        enabled: opts.enabled,
        retainForever: opts.retain_forever,
      }),
    ),
);

server.tool(
  "memory_delete_archival_policy",
  "Delete an archival policy",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deleteArchivalPolicy(sql, id) }),
);

server.tool(
  "memory_execute_archival_policies",
  "Execute all enabled archival policies for a workspace (run on a schedule)",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await executeArchivalPolicies(sql, workspace_id)),
);

server.tool(
  "memory_archival_history",
  "List archival history for a workspace",
  {
    workspace_id: z.string(),
    memory_id: z.string().optional(),
    archive_tier: z.enum(["cold", "frozen", "deleted"]).optional(),
    since: z.string().datetime().optional(),
    limit: z.number().optional().default(100),
  },
  async ({ workspace_id, memory_id, archive_tier, since, limit }) =>
    text(
      await listArchivalHistory(sql, workspace_id, {
        memoryId: memory_id,
        archiveTier: archive_tier,
        since: since ? new Date(since) : undefined,
        limit,
      }),
    ),
);

// Tiered TTL — soft-expire with grace periods
server.tool(
  "memory_apply_soft_expire",
  "Apply soft-expire to all expired memories using namespace grace periods",
  { workspace_id: z.string().optional() },
  async ({ workspace_id }) => ({ content: [{ type: "text", text: JSON.stringify({ softExpired: await applySoftExpire(sql, workspace_id) }) }] }),
);

server.tool(
  "memory_purge_soft_expired",
  "Hard-purge all soft-expired memories past their grace period",
  { workspace_id: z.string().optional() },
  async ({ workspace_id }) => ({ content: [{ type: "text", text: JSON.stringify({ purged: await purgeSoftExpired(sql, workspace_id) }) }] }),
);

server.tool(
  "memory_ttl_stats",
  "Get TTL enforcement statistics for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await getTtlStats(sql, workspace_id)),
);

// Namespace budgets and auto-classification
server.tool(
  "memory_get_namespace_budget",
  "Get memory budget for a namespace",
  { workspace_id: z.string(), namespace: z.string() },
  async ({ workspace_id, namespace }) => text(await getNamespaceBudget(sql, workspace_id, namespace) ?? { error: "not found" }),
);

server.tool(
  "memory_set_namespace_budget",
  "Set or update a namespace memory quota",
  {
    workspace_id: z.string(),
    namespace: z.string(),
    max_memories: z.number(),
    enforce_quota: z.boolean().optional().default(false),
  },
  async ({ workspace_id, namespace, max_memories, enforce_quota }) =>
    text(await setNamespaceBudget(sql, workspace_id, namespace, max_memories, enforce_quota ?? false)),
);

server.tool(
  "memory_enforce_namespace_quota",
  "Enforce namespace memory quota — evict lowest-importance memories if over limit",
  { workspace_id: z.string(), namespace: z.string(), dry_run: z.boolean().optional().default(false) },
  async ({ workspace_id, namespace, dry_run }) =>
    ({ content: [{ type: "text", text: JSON.stringify({ evicted: await enforceNamespaceQuota(sql, workspace_id, namespace, dry_run ?? false) }) }] }),
);

server.tool(
  "memory_classify_memory",
  "Auto-classify a memory into episodic/semantic/procedural/context based on routing rules",
  {
    workspace_id: z.string(),
    memory_id: z.string(),
    content: z.string(),
    summary: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  },
  async ({ workspace_id, memory_id, content, summary, metadata }) =>
    text(await classifyMemory(sql, workspace_id, memory_id, content, summary, metadata) ?? { classified: false }),
);

server.tool(
  "memory_list_classifications",
  "List memory classifications for a workspace",
  { workspace_id: z.string(), classified_type: MemoryTypeEnum.optional() },
  async ({ workspace_id, classified_type }) =>
    text(await listMemoryClassifications(sql, workspace_id, classified_type)),
);

