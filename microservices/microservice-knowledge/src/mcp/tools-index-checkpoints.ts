// ─── Index Checkpoints ────────────────────────────────────────────────────────

server.tool(
  "knowledge_create_index_checkpoint",
  "Create a checkpoint for a document's current index state",
  {
    document_id: z.string().uuid(),
    content_hash: z.string(),
    chunk_count: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  },
  async ({ document_id, content_hash, chunk_count, total_tokens }) => {
    const result = await createIndexCheckpoint(sql, document_id, content_hash, chunk_count, total_tokens);
    return text(JSON.stringify(result));
  },
);

server.tool(
  "knowledge_get_checkpoint",
  "Get the latest index checkpoint for a document",
  {
    document_id: z.string().uuid(),
  },
  async ({ document_id }) => {
    const result = await getLatestCheckpoint(sql, document_id);
    return text(JSON.stringify(result));
  },
);

server.tool(
  "knowledge_compute_delta",
  "Compute delta chunks since the last checkpoint",
  {
    document_id: z.string().uuid(),
    new_content_hash: z.string(),
    new_chunk_count: z.number().int().nonnegative(),
    new_total_tokens: z.number().int().nonnegative(),
  },
  async ({ document_id, new_content_hash, new_chunk_count, new_total_tokens }) => {
    const result = await computeDelta(sql, document_id, new_content_hash, new_chunk_count, new_total_tokens);
    return text(JSON.stringify(result));
  },
);

server.tool(
  "knowledge_list_checkpoints",
  "List all checkpoints for a document",
  {
    document_id: z.string().uuid(),
  },
  async ({ document_id }) => {
    const result = await listCheckpoints(sql, document_id);
    return text(JSON.stringify(result));
  },
);

server.tool(
  "knowledge_prune_checkpoints",
  "Prune old checkpoints, keeping only the most recent N versions",
  {
    document_id: z.string().uuid(),
    keep_versions: z.number().int().positive().default(3),
  },
  async ({ document_id, keep_versions }) => {
    const result = await pruneOldCheckpoints(sql, document_id, keep_versions);
    return text(JSON.stringify({ deleted: result }));
  },
);

