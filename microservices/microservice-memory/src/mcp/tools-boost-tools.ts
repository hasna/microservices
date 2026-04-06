// --- Boost tools ---

server.tool(
  "memory_boost",
  "Temporarily boost a memory's importance (stacks additively, expires after TTL)",
  {
    memory_id: z.string(),
    boost_type: z.enum(["manual", "accessed", "referenced", "linked", "searched"]).optional().default("manual"),
    boost_value: z.number().min(0.1).max(10.0).optional().default(1.0),
    ttl_minutes: z.number().int().min(1).optional().default(60),
    reason: z.string().optional(),
  },
  async ({ memory_id, boost_type, boost_value, ttl_minutes, reason }) => {
    const expiresAt = new Date(Date.now() + ttl_minutes * 60 * 1000);
    return text(await boostMemory(sql, { memoryId: memory_id, boostType: boost_type, boostValue: boost_value, expiresAt, reason }));
  },
);

server.tool(
  "memory_get_boost",
  "Get the current total boost value for a memory",
  { memory_id: z.string() },
  async ({ memory_id }) => text(await getMemoryBoost(sql, memory_id)),
);

server.tool(
  "memory_decay_boosts",
  "Remove expired boost records from the database",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text({ expired: await decayExpiredBoosts(sql, workspace_id) }),
);

