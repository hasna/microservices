// ─── Memory Versioning ────────────────────────────────────────────────────────

server.tool(
  "memory_create_version",
  "Create a new version entry for a memory (call before updating to track history)",
  {
    memory_id: z.string(),
    content: z.string(),
    summary: z.string().optional(),
    importance: z.number().min(0).max(1),
    memory_type: z.string(),
    changed_by: z.string().optional(),
    change_reason: z.string().optional(),
  },
  async ({ memory_id, content, summary, importance, memory_type, changed_by, change_reason }) => {
    const { createMemoryVersion } = await import("../lib/memory-versioning.js");
    return text(await createMemoryVersion(sql, { memoryId: memory_id, content, summary, importance, memoryType: memory_type, changedBy: changed_by, changeReason: change_reason }));
  },
);

server.tool(
  "memory_get_versions",
  "Get all versions of a memory",
  {
    memory_id: z.string(),
    limit: z.number().optional().default(20),
  },
  async ({ memory_id, limit }) => {
    const { getMemoryVersions } = await import("../lib/memory-versioning.js");
    return text(await getMemoryVersions(sql, memory_id, limit));
  },
);

server.tool(
  "memory_restore_version",
  "Restore a memory to a previous version",
  {
    memory_id: z.string(),
    version_number: z.number().int().min(1),
    restored_by: z.string().optional(),
  },
  async ({ memory_id, version_number, restored_by }) => {
    const { restoreMemoryVersion } = await import("../lib/memory-versioning.js");
    return text(await restoreMemoryVersion(sql, memory_id, version_number, restored_by));
  },
);

server.tool(
  "memory_compare_versions",
  "Compare two versions of a memory",
  {
    memory_id: z.string(),
    version_a: z.number().int().min(1),
    version_b: z.number().int().min(1),
  },
  async ({ memory_id, version_a, version_b }) => {
    const { compareMemoryVersions } = await import("../lib/memory-versioning.js");
    return text(await compareMemoryVersions(sql, memory_id, version_a, version_b));
  },
);

server.tool(
  "memory_prune_versions",
  "Prune old versions keeping only the last N",
  {
    memory_id: z.string(),
    keep_last: z.number().optional().default(10),
  },
  async ({ memory_id, keep_last }) => {
    const { pruneMemoryVersions } = await import("../lib/memory-versioning.js");
    return text({ pruned: await pruneMemoryVersions(sql, memory_id, keep_last) });
  },
);

