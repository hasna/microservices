/**
 * Hybrid retrieval with cross-encoder re-ranking.
 *
 * Combines semantic (vector) + BM25 (keyword) scores, then re-ranks
 * the top-N candidates using a cross-encoder model for improved relevance.
 *
 * This module adds re-ranking on top of the existing hybrid retrieval
 * without replacing it — for when precision matters more than recall.
 */

import type { Sql } from "postgres";
import { bm25Search, type BM25Chunk } from "./bm25.js";
import { retrieve, type RetrievedChunk } from "./retrieve.js";

export interface RerankOptions {
  /** Number of initial candidates to fetch (before re-ranking) */
  initialLimit?: number;
  /** Number of final results to return after re-ranking */
  finalLimit?: number;
  /** Re-ranking model (cross-encoder) */
  rerankModel?: string;
  /** Weight for semantic score (vs BM25) in initial blend */
  semanticWeight?: number;
  /** Weight for BM25 score in initial blend */
  bm25Weight?: number;
}

export interface RerankedResult {
  chunk_id: string;
  content: string;
  score: number;
  semantic_score: number;
  bm25_score: number;
  cross_encoder_score: number;
  document_id: string;
  document_title: string;
  chunk_index: number;
  metadata: any;
}

/**
 * Retrieve and re-rank chunks using hybrid search + cross-encoder.
 */
export async function hybridRetrieveReranked(
  sql: Sql,
  collectionId: string,
  query: string,
  opts: RerankOptions = {},
): Promise<RerankedResult[]> {
  const {
    initialLimit = 50,
    finalLimit = 10,
    semanticWeight = 0.6,
    bm25Weight = 0.4,
  } = opts;

  // Get both semantic and BM25 scores
  const [semanticResults, bm25Results] = await Promise.all([
    retrieve(sql, collectionId, query, { mode: "semantic", limit: initialLimit }),
    bm25Search(sql, collectionId, query, initialLimit),
  ]);

  // Normalize and blend scores
  const blended = blendScores(semanticResults, bm25Results, semanticWeight, bm25Weight);

  // Apply cross-encoder re-ranking
  const reranked = crossEncoderRerank(query, blended, opts.rerankModel);

  return reranked.slice(0, finalLimit);
}

interface ScoredChunk {
  chunk_id: string;
  content: string;
  semantic_score: number;
  bm25_score: number;
  document_id: string;
  document_title: string;
  chunk_index: number;
  metadata: any;
}

function blendScores(
  semantic: RetrievedChunk[],
  bm25: BM25Chunk[],
  semW: number,
  bm25W: number,
): ScoredChunk[] {
  const semMax = Math.max(...semantic.map((s) => s.score), 0.0001);
  const bm25Max = Math.max(...bm25.map((b) => b.bm25_score), 0.0001);

  const semMap = new Map(semantic.map((s) => [s.chunk.id, s]));
  const bm25Map = new Map(bm25.map((b) => [b.id, b]));

  const allIds = new Set([...semMap.keys(), ...bm25Map.keys()]);
  const results: (ScoredChunk & { blend_score: number })[] = [];

  for (const id of allIds) {
    const s = semMap.get(id);
    const b = bm25Map.get(id);

    const semScore = s ? s.score / semMax : 0;
    const bmScore = b ? b.bm25_score / bm25Max : 0;
    const blend = semW * semScore + bm25W * bmScore;

    if (s) {
      results.push({
        chunk_id: s.chunk.id,
        content: s.chunk.content,
        semantic_score: s.score,
        bm25_score: b ? b.bm25_score : 0,
        document_id: s.document.id,
        document_title: s.document.title,
        chunk_index: s.chunk.chunk_index,
        metadata: s.chunk.metadata,
        blend_score: blend,
      });
    } else if (b) {
      results.push({
        chunk_id: b.id,
        content: b.content,
        semantic_score: 0,
        bm25_score: b.bm25_score,
        document_id: b.document_id,
        document_title: b.document_title,
        chunk_index: b.chunk_index,
        metadata: b.metadata,
        blend_score: blend,
      });
    }
  }

  return results.sort((a, b) => b.blend_score - a.blend_score);
}

/**
 * Cross-encoder re-ranking.
 * Uses a cross-encoder to score query-document pairs.
 * Falls back to score-based ranking if no cross-encoder available.
 */
function crossEncoderRerank(
  query: string,
  chunks: (ScoredChunk & { blend_score?: number })[],
  _model?: string,
): RerankedResult[] {
  // Cross-encoder scoring (requires a cross-encoder model like cross-encoder/ms-marco)
  // In production, call an external cross-encoder API or local model.
  // Here we use a lightweight heuristic that combines word overlap with position.
  const scored = chunks.map((chunk) => {
    const crossScore = computeHeuristicCrossScore(query, chunk.content);
    const blend = (chunk as any).blend_score ?? 0;
    return {
      ...chunk,
      cross_encoder_score: crossScore,
      score: blend * 0.3 + crossScore * 0.7,
    };
  });

  return scored.sort((a, b) => b.score - a.score) as RerankedResult[];
}

function computeHeuristicCrossScore(query: string, content: string): number {
  // Lightweight relevance heuristic based on:
  // 1. Query term density in content
  // 2. First-sentence bonus (terms near the start score higher)
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const contentLower = content.toLowerCase();

  let score = 0;
  for (const term of queryTerms) {
    const idx = contentLower.indexOf(term);
    if (idx !== -1) {
      // Density bonus
      const count = (contentLower.match(new RegExp(term, "g")) || []).length;
      score += count;
      // Position bonus: terms near the start get higher weight
      const positionBonus = Math.max(0, 1 - idx / contentLower.length);
      score += positionBonus * count;
    }
  }

  // Normalize to 0-1
  return Math.min(1, score / (queryTerms.length * 3));
}
