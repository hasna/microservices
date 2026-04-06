// ─── Memory Recall Quality ─────────────────────────────────────────────────────

server.tool(
  "memory_record_recall",
  "Record a memory recall event for quality tracking",
  {
    memory_id: z.string(),
    success: z.boolean(),
    method: z.enum(["search", "direct", "recommend"]).optional().default("direct"),
    latency_ms: z.number().int().optional(),
  },
  async ({ memory_id, success, method, latency_ms }) => {
    const { recordMemoryRecall } = await import("../lib/recall.js");
    await recordMemoryRecall(sql, memory_id, success, latency_ms, method);
    return text({ ok: true });
  },
);

server.tool(
  "memory_get_quality_score",
  "Get quality score breakdown for a memory",
  { memory_id: z.string() },
  async ({ memory_id }) => {
    const { getMemoryQualityScore } = await import("../lib/recall.js");
    return text(await getMemoryQualityScore(sql, memory_id));
  },
);

