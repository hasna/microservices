// ─── TTL Tiered ───────────────────────────────────────────────────────────────

server.tool(
  "memory_ttl_stats",
  "Get tiered TTL statistics for a workspace: counts per tier (hot, warm, cold, frozen)",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    const { getTtlStats } = await import("../lib/ttl-tiered.js");
    return text(await getTtlStats(sql, workspace_id, namespace));
  },
);

server.tool(
  "memory_purge_soft_expired",
  "Purge memories that have exceeded their soft TTL (extended expiry) but are not yet hard-deleted",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    const { purgeSoftExpired } = await import("../lib/ttl-tiered.js");
    return text({ purged: await purgeSoftExpired(sql, workspace_id, namespace) });
  },
);

