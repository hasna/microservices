// ─── Get Expiring Memories ─────────────────────────────────────────────────────

server.tool(
  "memory_get_expiring_memories",
  "Get memories that are about to expire (within the warning window) — useful for triggering refresh or archival",
  {
    workspace_id: z.string(),
    within_hours: z.number().optional().default(72).describe("Show memories expiring within this many hours (default 72)"),
    namespace: z.string().optional(),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, within_hours, namespace, limit }) => {
    const { getExpiringMemories } = await import("../lib/ttl.js");
    return text(await getExpiringMemories(sql, workspace_id, within_hours ?? 72, namespace, limit));
  },
);

