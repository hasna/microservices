// ─── Boost Management ─────────────────────────────────────────────────────────

server.tool(
  "memory_boost",
  "Boost a memory's priority/temporarily elevate its importance score",
  {
    memory_id: z.string(),
    boost_amount: z.number().min(0).max(1).optional().default(0.2),
    reason: z.string().optional(),
  },
  async ({ memory_id, boost_amount, reason }) => {
    const { boostMemory } = await import("../lib/index.js");
    return text(await boostMemory(sql, memory_id, boost_amount, reason));
  },
);

server.tool(
  "memory_get_boost",
  "Get current boost information for a memory",
  { memory_id: z.string() },
  async ({ memory_id }) => {
    const { getMemoryBoost } = await import("../lib/index.js");
    return text(await getMemoryBoost(sql, memory_id));
  },
);

server.tool(
  "memory_decay_boosts",
  "Decay all expired boosts (run this periodically to restore boosted memories to normal)",
  {
    workspace_id: z.string().optional(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) => {
    const { decayExpiredBoosts } = await import("../lib/index.js");
    return text({ decayed: await decayExpiredBoosts(sql, workspace_id, namespace) });
  },
);

