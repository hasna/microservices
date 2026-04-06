import type { Sql } from "postgres";

/**
 * Cross-collection retrieval: search across multiple collections simultaneously.
 * Useful for workspace-wide knowledge searches.
 */

import { generateEmbedding } from "./embeddings.js";
import { type RetrieveOptions, type RetrievedChunk, retrieve } from "./retrieve.js";

export interface CrossCollectionRetrieveOptions extends Omit<RetrieveOptions, "metadataFilter"> {
  /** Max results per collection (results are merged and re-ranked by score) */
  perCollectionLimit?: number;
}

/**
 * Retrieve from multiple collections and merge results by score.
 * Collections with no results are omitted from the response.
 */
export async function crossCollectionRetrieve(
  sql: Sql,
  collectionIds: string[],
  query: string,
  opts: CrossCollectionRetrieveOptions = {},
): Promise<{
  results: RetrievedChunk[];
  collectionIds: string[];
  totalCollections: number;
  totalResults: number;
  mode: string;
}> {
  const perCollectionLimit = opts.perCollectionLimit ?? 10;
  const mode = opts.mode ?? "text";
  const limit = opts.limit ?? 20;

  // Fetch from all collections in parallel
  const results = await Promise.all(
    collectionIds.map(async (collectionId) => {
      try {
        const chunks = await retrieve(sql, collectionId, query, {
          ...opts,
          limit: perCollectionLimit,
          metadataFilter: undefined,
        });
        return { collectionId, chunks };
      } catch {
        return { collectionId, chunks: [] as RetrievedChunk[] };
      }
    }),
  );

  // Merge all chunks, tagging with source collection
  const merged: (RetrievedChunk & { _collectionId: string })[] = [];
  for (const { collectionId, chunks } of results) {
    for (const chunk of chunks) {
      merged.push({ ...chunk, _collectionId: collectionId });
    }
  }

  // Sort by score descending
  merged.sort((a, b) => b.score - a.score);

  // Trim to limit
  const trimmed = merged.slice(0, limit);

  // Remove the internal _collectionId tag
  const cleaned: RetrievedChunk[] = trimmed.map(({ _collectionId: _, ...rest }) => rest);

  return {
    results: cleaned,
    collectionIds,
    totalCollections: collectionIds.length,
    totalResults: merged.length,
    mode,
  };
}

/**
 * Retrieve from all collections in a workspace.
 */
export async function workspaceRetrieve(
  sql: Sql,
  workspaceId: string,
  query: string,
  opts: CrossCollectionRetrieveOptions = {},
): Promise<{
  results: RetrievedChunk[];
  collectionIds: string[];
  totalCollections: number;
  totalResults: number;
}> {
  // Get all collection IDs for the workspace
  const collections = await sql<{ id: string }[]>`
    SELECT id FROM knowledge.collections WHERE workspace_id = ${workspaceId}
  `;
  const collectionIds = collections.map((c) => c.id);

  if (collectionIds.length === 0) {
    return { results: [], collectionIds: [], totalCollections: 0, totalResults: 0 };
  }

  return crossCollectionRetrieve(sql, collectionIds, query, opts);
}
