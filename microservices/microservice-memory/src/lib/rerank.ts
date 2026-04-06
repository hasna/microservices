/**
 * Search result reranking — improves search quality by reordering results
 * based on recency, importance, access frequency, and semantic similarity.
 */

import type { Sql } from "postgres";
import { generateEmbedding } from "./embeddings.js";

export interface RerankOptions {
  recency_weight?: number;    // weight for recency score (0-1), default 0.3
  importance_weight?: number;  // weight for importance score (0-1), default 0.3
  frequency_weight?: number;  // weight for access frequency score (0-1), default 0.2
  semantic_weight?: number;   // weight for embedding similarity (0-1), default 0.2
  limit?: number;             // max results to return, default 20
}

export interface ScoredMemory {
  id: string;
  content: string;
  summary: string | null;
  memory_type: string;
  importance: number;
  created_at: Date;
  updated_at: Date;
  recency_score: number;     // 0-1, 1 = very recent
  importance_score: number;   // 0-1, from importance field
  frequency_score: number;   // 0-1, normalized access count
  semantic_score: number;     // 0-1, cosine similarity to query embedding
  combined_score: number;     // weighted sum
}

/**
 * Rerank a list of memory IDs by combining recency, importance, access frequency,
 * and semantic similarity scores.
 *
 * @param sql Database handle
 * @param queryText Original search query (used for semantic reranking)
 * @param memoryIds Ordered list of memory IDs from the initial search
 * @param opts Weighting options
 */
export async function rerankMemories(
  sql: Sql,
  queryText: string,
  memoryIds: string[],
  opts: RerankOptions = {},
): Promise<ScoredMemory[]> {
  if (memoryIds.length === 0) return [];

  const {
    recency_weight = 0.3,
    importance_weight = 0.3,
    frequency_weight = 0.2,
    semantic_weight = 0.2,
    limit = 20,
  } = opts;

  // Fetch memories with their data
  const rows = await sql<any[]>`
    SELECT m.id, m.content, m.summary, m.memory_type, m.importance,
           m.created_at, m.updated_at,
           mm.embedding,
           COALESCE(access_log.access_count, 0) as access_count,
           MAX(access_log.accessed_at) as last_accessed
    FROM memory.memories m
    LEFT JOIN memory.memory_access_log access_log
      ON access_log.memory_id = m.id
    WHERE m.id IN ${sql(memoryIds)}
    GROUP BY m.id, m.content, m.summary, m.memory_type, m.importance,
             m.created_at, m.updated_at, mm.embedding, access_log.access_count
  `;

  // Get query embedding for semantic reranking
  const queryEmbedding = await generateEmbedding(queryText);

  // Compute scores
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;

  // Find max access count for normalization
  const maxAccessCount = Math.max(...rows.map((r) => Number(r.access_count ?? 0)), 1);

  const scored: ScoredMemory[] = rows.map((row) => {
    // Recency score: exponential decay, half-life of 7 days
    const ageMs = now - new Date(row.created_at).getTime();
    const ageDays = ageMs / msPerDay;
    const recency_score = Math.exp(-0.1 * ageDays);

    // Importance score: directly from 0-1 field
    const importance_score = row.importance ?? 0.5;

    // Frequency score: normalized log scale
    const frequency_score = Math.log1p(Number(row.access_count ?? 0)) / Math.log1p(maxAccessCount);

    // Semantic score: cosine similarity to query
    let semantic_score = 0;
    if (queryEmbedding && row.embedding) {
      const memEmb = row.embedding;
      if (Array.isArray(memEmb) && memEmb.length === queryEmbedding.length) {
        const dot = memEmb.reduce((s: number, a: number, i: number) => s + a * queryEmbedding[i], 0);
        const normA = Math.sqrt(memEmb.reduce((s: number, a: number) => s + a * a, 0));
        const normB = Math.sqrt(queryEmbedding.reduce((s: number, a: number) => s + a * a, 0));
        semantic_score = normA && normB ? dot / (normA * normB) * 0.5 + 0.5 : 0; // shift to 0-1
      }
    }

    const combined_score =
      recency_weight * recency_score +
      importance_weight * importance_score +
      frequency_weight * frequency_score +
      semantic_weight * semantic_score;

    return {
      id: row.id,
      content: row.content,
      summary: row.summary,
      memory_type: row.memory_type,
      importance: row.importance,
      created_at: row.created_at,
      updated_at: row.updated_at,
      recency_score,
      importance_score,
      frequency_score,
      semantic_score,
      combined_score,
    };
  });

  // Sort by combined score descending
  scored.sort((a, b) => b.combined_score - a.combined_score);

  return scored.slice(0, limit);
}

/**
 * Quick rerank that only uses recency + importance (no DB access needed for embeddings).
 * Useful as a fast fallback when embeddings aren't available.
 */
export function rerankMemoriesFast(
  memories: Array<{ id: string; created_at: Date; importance: number }>,
  opts: { recency_weight?: number; importance_weight?: number; limit?: number } = {},
): Array<{ id: string; recency_score: number; importance_score: number; combined_score: number }> {
  const { recency_weight = 0.5, importance_weight = 0.5, limit = 20 } = opts;
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;

  const maxImportance = Math.max(...memories.map((m) => m.importance), 1);

  const scored = memories.map((m) => {
    const ageDays = (now - new Date(m.created_at).getTime()) / msPerDay;
    const recency_score = Math.exp(-0.1 * ageDays);
    const importance_score = m.importance / maxImportance;
    return {
      id: m.id,
      recency_score,
      importance_score,
      combined_score: recency_weight * recency_score + importance_weight * importance_score,
    };
  });

  scored.sort((a, b) => b.combined_score - a.combined_score);
  return scored.slice(0, limit);
}
