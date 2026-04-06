// --- Recall scoring ---

server.tool(
  "memory_record_recall",
  "Record a memory recall event (success or failure)",
  {
    memory_id: z.string(),
    success: z.boolean(),
    latency_ms: z.number().optional(),
    method: z.enum(["search", "direct", "recommend"]).optional().default("direct"),
  },
  async ({ memory_id, success, latency_ms, method }) => {
    await recordMemoryRecall(sql, memory_id, success, latency_ms, method);
    return text({ ok: true });
  },
);

server.tool(
  "memory_quality_score",
  "Get quality score (0-100) for a memory based on access frequency, recall success, TTL, freshness",
  { memory_id: z.string() },
  async ({ memory_id }) => {
    const score = await getMemoryQualityScore(sql, memory_id);
    return text(score ?? { error: "Memory not found" });
  },
);

server.tool(
  "memory_quality_report",
  "Get quality breakdown for all memories in a workspace",
  {
    workspace_id: z.string(),
    namespace: z.string().optional(),
  },
  async ({ workspace_id, namespace }) =>
    text(await getMemoryQualityReport(sql, workspace_id, namespace)),
);

