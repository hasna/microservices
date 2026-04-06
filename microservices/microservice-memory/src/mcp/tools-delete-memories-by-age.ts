// ─── Delete Memories by Age ────────────────────────────────────────────────────

server.tool(
  "memory_delete_memories_by_age",
  "Delete memories older than a specified age — useful for compliance and data retention",
  {
    workspace_id: z.string(),
    older_than_days: z.number().int().positive().describe("Delete memories older than this many days"),
    namespace: z.string().optional().describe("Limit to a specific namespace"),
    memory_type: MemoryTypeEnum.optional().describe("Only delete memories of this type"),
    dry_run: z.boolean().optional().default(false).describe("If true, count how many would be deleted without actually deleting"),
  },
  async ({ workspace_id, older_than_days, namespace, memory_type, dry_run }) => {
    const { deleteMemoriesByAge } = await import("../lib/ttl.js");
    return text({ deleted: dry_run ? 0 : await deleteMemoriesByAge(sql, workspace_id, older_than_days, namespace, memory_type), dry_run });
  },
);

