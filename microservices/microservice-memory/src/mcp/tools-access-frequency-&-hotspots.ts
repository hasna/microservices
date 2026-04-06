// --- Access frequency & hotspots ---

server.tool(
  "memory_log_access",
  "Log a memory access event for frequency tracking",
  {
    memory_id: z.string(),
    access_type: z.enum(["read", "write", "search"]),
    response_time_ms: z.number().optional(),
  },
  async ({ memory_id, access_type, response_time_ms }) => {
    await logMemoryAccess(sql, memory_id, access_type, response_time_ms);
    return text({ ok: true });
  },
);

server.tool(
  "memory_get_access_frequency",
  "Get access frequency analysis for memories in a namespace",
  {
    namespace: z.string(),
    hours: z.number().optional().default(24),
  },
  async ({ namespace, hours }) =>
    text(await getMemoryAccessFrequency(sql, namespace, hours)),
);

server.tool(
  "memory_hotspots",
  "Get most frequently accessed memories (hotspots) in a namespace",
  {
    namespace: z.string(),
    limit: z.number().optional().default(10),
  },
  async ({ namespace, limit }) => text(await getMemoryHotspots(sql, namespace, limit)),
);

server.tool(
  "memory_evict_least_valuable",
  "Evict least valuable memories (lowest access frequency + priority) in a namespace",
  {
    namespace: z.string(),
    keep_count: z.number().optional().default(100),
  },
  async ({ namespace, keep_count }) => {
    const evicted = await evictLeastValuable(sql, namespace, keep_count);
    return text({ evicted });
  },
);

