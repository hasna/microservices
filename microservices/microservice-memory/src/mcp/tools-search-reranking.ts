// --- Search reranking ---

server.tool(
  "memory_rerank_results",
  "Rerank memory search results using recency, importance, access frequency, and semantic similarity",
  {
    workspace_id: z.string(),
    query_text: z.string(),
    memory_ids: z.array(z.string()),
    recency_weight: z.number().optional().default(0.3),
    importance_weight: z.number().optional().default(0.3),
    frequency_weight: z.number().optional().default(0.2),
    semantic_weight: z.number().optional().default(0.2),
    limit: z.number().optional().default(20),
  },
  async ({
    workspace_id: _workspace_id, query_text, memory_ids,
    recency_weight, importance_weight, frequency_weight, semantic_weight, limit,
  }) =>
    text(await rerankMemories(sql, query_text, memory_ids, {
      recency_weight, importance_weight, frequency_weight, semantic_weight, limit,
    })),
);

