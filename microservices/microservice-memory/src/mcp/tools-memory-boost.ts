// ─── Memory Boost ─────────────────────────────────────────────────────────────

server.tool(
  "memory_boost",
  "Temporarily boost a memory's importance to resist decay",
  {
    memory_id: z.string(),
    boost_amount: z.number().optional().default(0.3),
    boost_ttl_seconds: z.number().int().optional().default(604800),
    reason: z.string().optional(),
  },
  async ({ memory_id, boost_amount, boost_ttl_seconds, reason }) => {
    const { boostMemory } = await import("../lib/memory-boost.js");
    return text(await boostMemory(sql, memory_id, boost_amount, boost_ttl_seconds, reason));
  },
);

server.tool(
  "memory_get_boost",
  "Get active boost for a memory",
  { memory_id: z.string() },
  async ({ memory_id }) => {
    const { getMemoryBoost } = await import("../lib/memory-boost.js");
    const boost = await getMemoryBoost(sql, memory_id);
    return text(boost ?? { boost: null });
  },
);

server.tool(
  "memory_decay_boost",
  "Remove or reduce an active boost from a memory",
  { memory_id: z.string(), decay_by: z.number().optional().default(1) },
  async ({ memory_id, decay_by }) => {
    const { decayMemoryBoost } = await import("../lib/memory-boost.js");
    return text(await decayMemoryBoost(sql, memory_id, decay_by));
  },
);

