// ─── Duplicate Detection ──────────────────────────────────────────────────────

server.tool(
  "memory_find_duplicates",
  "Find near-duplicate memory groups using embedding similarity",
  {
    workspace_id: z.string(),
    threshold: z.number().min(0).max(1).optional().default(0.95),
    namespace: z.string().optional(),
    limit: z.number().optional().default(20),
  },
  async ({ workspace_id, threshold, namespace, limit }) => {
    const { findDuplicateGroups } = await import("../lib/index.js");
    return text(await findDuplicateGroups(sql, workspace_id, threshold, namespace, limit));
  },
);

server.tool(
  "memory_merge_duplicates",
  "Merge a duplicate group into a single canonical memory",
  {
    group_id: z.string().describe("Duplicate group ID from find_duplicates"),
    keep_id: z.string().optional().describe("ID of memory to keep; omit to keep highest quality"),
    archive_others: z.boolean().optional().default(true),
  },
  async ({ group_id, keep_id, archive_others }) => {
    const { mergeDuplicate } = await import("../lib/index.js");
    return text(await mergeDuplicate(sql, group_id, keep_id, archive_others));
  },
);

