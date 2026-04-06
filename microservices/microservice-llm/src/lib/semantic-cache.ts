/**
 * Semantic response cache — stores LLM responses indexed by embedding similarity.
 * Enables sub-millisecond cache hits for semantically similar prompts.
 */

import type { Sql } from "postgres";
import { createHash } from "node:crypto";

export interface CachedResponse {
  id: string;
  workspace_id: string;
  text_hash: string;
  text_snippet: string;
  response_content: string;
  model: string;
  provider: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  similarity: number;
  created_at: Date;
}

/**
 * Store a response in the semantic cache.
 */
export async function cacheResponse(
  sql: Sql,
  opts: {
    workspaceId: string;
    prompt: string;
    promptEmbedding?: number[];
    responseContent: string;
    model: string;
    provider: string;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
  },
): Promise<{ id: string; text_hash: string }> {
  const textHash = createHash("sha256").update(opts.prompt).digest("hex");
  const snippet = opts.prompt.slice(0, 200);

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO llm.response_cache
      (workspace_id, text_hash, text_snippet, prompt_embedding, response_content,
       model, provider, prompt_tokens, completion_tokens, cost_usd)
    VALUES (
      ${opts.workspaceId},
      ${textHash},
      ${snippet},
      ${opts.promptEmbedding ? JSON.stringify(opts.promptEmbedding) : null},
      ${opts.responseContent},
      ${opts.model},
      ${opts.provider},
      ${opts.promptTokens},
      ${opts.completionTokens},
      ${opts.costUsd}
    )
    ON CONFLICT (workspace_id, text_hash) DO UPDATE SET
      response_content  = EXCLUDED.response_content,
      model              = EXCLUDED.model,
      provider           = EXCLUDED.provider,
      prompt_tokens      = EXCLUDED.prompt_tokens,
      completion_tokens  = EXCLUDED.completion_tokens,
      cost_usd           = EXCLUDED.cost_usd
    RETURNING id
  `;

  return { id: row.id, text_hash: textHash };
}

/**
 * Look up a cached response by exact hash (fast path).
 */
export async function getCachedByHash(
  sql: Sql,
  workspaceId: string,
  promptHash: string,
): Promise<CachedResponse | null> {
  const [row] = await sql<any[]>`
    SELECT id, workspace_id, text_hash, text_snippet, response_content,
           model, provider, prompt_tokens, completion_tokens, cost_usd, created_at
    FROM llm.response_cache
    WHERE workspace_id = ${workspaceId} AND text_hash = ${promptHash}
  `;

  if (!row) return null;

  return {
    ...row,
    similarity: 1.0,
    response_content: row.response_content,
  };
}

/**
 * Look up a cached response by embedding similarity (semantic cache hit).
 * Uses cosine similarity on the stored prompt_embedding vector.
 * Requires pgvector extension.
 */
export async function getCachedByEmbedding(
  sql: Sql,
  workspaceId: string,
  queryEmbedding: number[],
  similarityThreshold = 0.95,
  limit = 5,
): Promise<CachedResponse[]> {
  const embeddingJson = JSON.stringify(queryEmbedding);

  const rows = await sql<any[]>`
    SELECT id, workspace_id, text_hash, text_snippet, response_content,
           model, provider, prompt_tokens, completion_tokens, cost_usd, created_at,
           COALESCE(
             (prompt_embedding <=> ${embeddingJson}::vector),
             1.0
           ) AS similarity
    FROM llm.response_cache
    WHERE workspace_id = ${workspaceId}
      AND prompt_embedding IS NOT NULL
      AND (prompt_embedding <=> ${embeddingJson}::vector) < ${1 - similarityThreshold}
    ORDER BY prompt_embedding <=> ${embeddingJson}::vector
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: row.id,
    workspace_id: row.workspace_id,
    text_hash: row.text_hash,
    text_snippet: row.text_snippet,
    response_content: row.response_content,
    model: row.model,
    provider: row.provider,
    prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens,
    cost_usd: parseFloat(row.cost_usd),
    similarity: 1 - parseFloat(row.similarity),
    created_at: row.created_at,
  }));
}

/**
 * List cached responses for a workspace.
 */
export async function listCachedResponses(
  sql: Sql,
  workspaceId: string,
  limit = 50,
  offset = 0,
): Promise<{ responses: CachedResponse[]; total: number }> {
  const responses = await sql<any[]>`
    SELECT id, workspace_id, text_hash, text_snippet, response_content,
           model, provider, prompt_tokens, completion_tokens, cost_usd, created_at
    FROM llm.response_cache
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [{ count }] = await sql<{ count: string }[]>`
    SELECT COUNT(*) as count FROM llm.response_cache
    WHERE workspace_id = ${workspaceId}
  `;

  return {
    responses: responses.map((r) => ({ ...r, similarity: 1.0, response_content: r.response_content })),
    total: parseInt(count),
  };
}

/**
 * Invalidate cache entries for a workspace (e.g., after model update).
 */
export async function invalidateCache(
  sql: Sql,
  workspaceId: string,
  model?: string,
): Promise<{ deleted: number }> {
  const [{ count }] = model
    ? await sql<{ count: string }[]>`
        DELETE FROM llm.response_cache
        WHERE workspace_id = ${workspaceId} AND model = ${model}
        RETURNING count(*) as count
      `
    : await sql<{ count: string }[]>`
        DELETE FROM llm.response_cache
        WHERE workspace_id = ${workspaceId}
        RETURNING count(*) as count
      `;

  return { deleted: parseInt(count) };
}

/**
 * Get cache statistics for a workspace.
 */
export async function getCacheStats(
  sql: Sql,
  workspaceId: string,
): Promise<{
  total_entries: number;
  total_tokens_saved: number;
  estimated_cost_saved: number;
  by_model: { model: string; count: number }[];
}> {
  const [row] = await sql<any[]>`
    SELECT
      COUNT(*)                                               AS total_entries,
      COALESCE(SUM(prompt_tokens), 0)                        AS total_tokens_saved,
      COALESCE(SUM(cost_usd), 0)::numeric                    AS estimated_cost_saved
    FROM llm.response_cache
    WHERE workspace_id = ${workspaceId}
  `;

  const byModel = await sql<any[]>`
    SELECT model, COUNT(*) as count
    FROM llm.response_cache
    WHERE workspace_id = ${workspaceId}
    GROUP BY model
    ORDER BY count DESC
  `;

  return {
    total_entries: parseInt(row?.total_entries ?? "0"),
    total_tokens_saved: parseInt(row?.total_tokens_saved ?? "0"),
    estimated_cost_saved: parseFloat(row?.estimated_cost_saved ?? "0"),
    by_model: byModel.map((r) => ({ model: r.model, count: parseInt(r.count) })),
  };
}
