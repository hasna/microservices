/**
 * Search operations: full-text, semantic, and hybrid.
 */

import type { Sql } from "postgres";
import { generateEmbedding } from "./embeddings.js";

export interface SearchResult {
  doc_id: string;
  collection: string;
  content: string;
  metadata: any;
  score: number;
  highlight?: string;
}

export interface SearchQuery {
  text: string;
  collection?: string;
  workspaceId?: string;
  mode?: "text" | "semantic" | "hybrid";
  limit?: number;
}

export async function search(
  sql: Sql,
  query: SearchQuery,
): Promise<SearchResult[]> {
  const { text, collection, workspaceId, mode = "text", limit = 10 } = query;

  if (!text || text.trim() === "") return [];

  const safeLimit = Math.max(1, Math.min(limit, 200));

  if (mode === "text") {
    return textSearch(sql, text, collection, workspaceId, safeLimit);
  }

  if (mode === "semantic") {
    const embedding = await generateEmbedding(text);
    if (!embedding) {
      // Fall back to text search when no key
      return textSearch(sql, text, collection, workspaceId, safeLimit);
    }
    return semanticSearch(sql, embedding, collection, workspaceId, safeLimit);
  }

  if (mode === "hybrid") {
    const embedding = await generateEmbedding(text);
    if (!embedding) {
      // Fall back to text search when no embedding available
      return textSearch(sql, text, collection, workspaceId, safeLimit);
    }
    return hybridSearch(
      sql,
      text,
      embedding,
      collection,
      workspaceId,
      safeLimit,
    );
  }

  return textSearch(sql, text, collection, workspaceId, safeLimit);
}

async function textSearch(
  sql: Sql,
  text: string,
  collection: string | undefined,
  workspaceId: string | undefined,
  limit: number,
): Promise<SearchResult[]> {
  type Row = {
    doc_id: string;
    collection: string;
    content: string;
    metadata: any;
    score: number;
    highlight: string;
  };

  if (collection && workspaceId) {
    return sql<Row[]>`
      SELECT
        doc_id,
        collection,
        content,
        metadata,
        ts_rank(fts_vector, plainto_tsquery('english', ${text})) AS score,
        ts_headline('english', content, plainto_tsquery('english', ${text}),
          'MaxWords=30, MinWords=10, StartSel=<<, StopSel=>>'
        ) AS highlight
      FROM search.documents
      WHERE fts_vector @@ plainto_tsquery('english', ${text})
        AND collection = ${collection}
        AND workspace_id = ${workspaceId}
      ORDER BY score DESC
      LIMIT ${limit}
    `;
  }

  if (collection) {
    return sql<Row[]>`
      SELECT
        doc_id,
        collection,
        content,
        metadata,
        ts_rank(fts_vector, plainto_tsquery('english', ${text})) AS score,
        ts_headline('english', content, plainto_tsquery('english', ${text}),
          'MaxWords=30, MinWords=10, StartSel=<<, StopSel=>>'
        ) AS highlight
      FROM search.documents
      WHERE fts_vector @@ plainto_tsquery('english', ${text})
        AND collection = ${collection}
      ORDER BY score DESC
      LIMIT ${limit}
    `;
  }

  if (workspaceId) {
    return sql<Row[]>`
      SELECT
        doc_id,
        collection,
        content,
        metadata,
        ts_rank(fts_vector, plainto_tsquery('english', ${text})) AS score,
        ts_headline('english', content, plainto_tsquery('english', ${text}),
          'MaxWords=30, MinWords=10, StartSel=<<, StopSel=>>'
        ) AS highlight
      FROM search.documents
      WHERE fts_vector @@ plainto_tsquery('english', ${text})
        AND workspace_id = ${workspaceId}
      ORDER BY score DESC
      LIMIT ${limit}
    `;
  }

  return sql<Row[]>`
    SELECT
      doc_id,
      collection,
      content,
      metadata,
      ts_rank(fts_vector, plainto_tsquery('english', ${text})) AS score,
      ts_headline('english', content, plainto_tsquery('english', ${text}),
        'MaxWords=30, MinWords=10, StartSel=<<, StopSel=>>'
      ) AS highlight
    FROM search.documents
    WHERE fts_vector @@ plainto_tsquery('english', ${text})
    ORDER BY score DESC
    LIMIT ${limit}
  `;
}

async function semanticSearch(
  sql: Sql,
  embedding: number[],
  collection: string | undefined,
  workspaceId: string | undefined,
  limit: number,
): Promise<SearchResult[]> {
  const embStr = JSON.stringify(embedding);

  type Row = {
    doc_id: string;
    collection: string;
    content: string;
    metadata: any;
    score: number;
  };

  if (collection && workspaceId) {
    return sql<Row[]>`
      SELECT
        doc_id,
        collection,
        content,
        metadata,
        1 - (embedding <=> ${embStr}::vector) AS score
      FROM search.documents
      WHERE embedding IS NOT NULL
        AND collection = ${collection}
        AND workspace_id = ${workspaceId}
      ORDER BY embedding <=> ${embStr}::vector
      LIMIT ${limit}
    `;
  }

  if (collection) {
    return sql<Row[]>`
      SELECT
        doc_id,
        collection,
        content,
        metadata,
        1 - (embedding <=> ${embStr}::vector) AS score
      FROM search.documents
      WHERE embedding IS NOT NULL
        AND collection = ${collection}
      ORDER BY embedding <=> ${embStr}::vector
      LIMIT ${limit}
    `;
  }

  if (workspaceId) {
    return sql<Row[]>`
      SELECT
        doc_id,
        collection,
        content,
        metadata,
        1 - (embedding <=> ${embStr}::vector) AS score
      FROM search.documents
      WHERE embedding IS NOT NULL
        AND workspace_id = ${workspaceId}
      ORDER BY embedding <=> ${embStr}::vector
      LIMIT ${limit}
    `;
  }

  return sql<Row[]>`
    SELECT
      doc_id,
      collection,
      content,
      metadata,
      1 - (embedding <=> ${embStr}::vector) AS score
    FROM search.documents
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${embStr}::vector
    LIMIT ${limit}
  `;
}

async function hybridSearch(
  sql: Sql,
  text: string,
  embedding: number[],
  collection: string | undefined,
  workspaceId: string | undefined,
  limit: number,
): Promise<SearchResult[]> {
  // Run both in parallel
  const [textResults, semanticResults] = await Promise.all([
    textSearch(sql, text, collection, workspaceId, limit),
    semanticSearch(sql, embedding, collection, workspaceId, limit),
  ]);

  // Merge results by doc_id, average the scores
  const scoreMap = new Map<
    string,
    SearchResult & { textScore: number; semScore: number }
  >();

  for (const r of textResults) {
    scoreMap.set(r.doc_id, { ...r, textScore: r.score, semScore: 0 });
  }

  for (const r of semanticResults) {
    const existing = scoreMap.get(r.doc_id);
    if (existing) {
      existing.semScore = r.score;
    } else {
      scoreMap.set(r.doc_id, { ...r, textScore: 0, semScore: r.score });
    }
  }

  const merged: SearchResult[] = [];
  for (const entry of scoreMap.values()) {
    merged.push({
      doc_id: entry.doc_id,
      collection: entry.collection,
      content: entry.content,
      metadata: entry.metadata,
      score: (entry.textScore + entry.semScore) / 2,
      highlight: entry.highlight,
    });
  }

  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, limit);
}

export async function similarByEmbedding(
  sql: Sql,
  embedding: number[],
  collection?: string,
  workspaceId?: string,
  limit: number = 10,
): Promise<SearchResult[]> {
  const embStr = JSON.stringify(embedding);

  type Row = {
    doc_id: string;
    collection: string;
    content: string;
    metadata: any;
    score: number;
  };

  if (collection && workspaceId) {
    return sql<Row[]>`
      SELECT
        doc_id,
        collection,
        content,
        metadata,
        1 - (embedding <=> ${embStr}::vector) AS score
      FROM search.documents
      WHERE embedding IS NOT NULL
        AND collection = ${collection}
        AND workspace_id = ${workspaceId}
      ORDER BY embedding <=> ${embStr}::vector
      LIMIT ${limit}
    `;
  }

  if (collection) {
    return sql<Row[]>`
      SELECT
        doc_id,
        collection,
        content,
        metadata,
        1 - (embedding <=> ${embStr}::vector) AS score
      FROM search.documents
      WHERE embedding IS NOT NULL
        AND collection = ${collection}
      ORDER BY embedding <=> ${embStr}::vector
      LIMIT ${limit}
    `;
  }

  if (workspaceId) {
    return sql<Row[]>`
      SELECT
        doc_id,
        collection,
        content,
        metadata,
        1 - (embedding <=> ${embStr}::vector) AS score
      FROM search.documents
      WHERE embedding IS NOT NULL
        AND workspace_id = ${workspaceId}
      ORDER BY embedding <=> ${embStr}::vector
      LIMIT ${limit}
    `;
  }

  return sql<Row[]>`
    SELECT
      doc_id,
      collection,
      content,
      metadata,
      1 - (embedding <=> ${embStr}::vector) AS score
    FROM search.documents
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${embStr}::vector
    LIMIT ${limit}
  `;
}

export async function countDocuments(
  sql: Sql,
  collection: string,
  workspaceId?: string,
): Promise<number> {
  if (workspaceId) {
    const [{ count }] = await sql<[{ count: string }]>`
      SELECT COUNT(*) AS count
      FROM search.documents
      WHERE collection = ${collection} AND workspace_id = ${workspaceId}
    `;
    return parseInt(count, 10);
  }

  const [{ count }] = await sql<[{ count: string }]>`
    SELECT COUNT(*) AS count
    FROM search.documents
    WHERE collection = ${collection}
  `;
  return parseInt(count, 10);
}

export interface FacetedSearchResult {
  results: SearchResult[];
  facets: Record<string, { value: string; count: number }[]>;
}

export async function facetedSearch(
  sql: Sql,
  query: SearchQuery & { facet_field: string; facet_limit?: number },
): Promise<FacetedSearchResult> {
  const { text, collection, workspaceId, mode = "text", limit = 10, facet_field, facet_limit = 20 } = query;

  const results = await search(sql, { text, collection, workspaceId, mode, limit });

  // Build facet counts from metadata JSONB field
  const facetLimit = Math.max(1, Math.min(facet_limit, 100));
  let facetSql;
  if (collection && workspaceId) {
    facetSql = sql<{ facet_value: string; count: number }[]>`
      SELECT
        metadata->>${facet_field} AS facet_value,
        COUNT(*)::int AS count
      FROM search.documents
      WHERE fts_vector @@ plainto_tsquery('english', ${text})
        AND collection = ${collection}
        AND workspace_id = ${workspaceId}
        AND metadata->>${facet_field} IS NOT NULL
      GROUP BY facet_value
      ORDER BY count DESC
      LIMIT ${facetLimit}
    `;
  } else if (collection) {
    facetSql = sql<{ facet_value: string; count: number }[]>`
      SELECT
        metadata->>${facet_field} AS facet_value,
        COUNT(*)::int AS count
      FROM search.documents
      WHERE fts_vector @@ plainto_tsquery('english', ${text})
        AND collection = ${collection}
        AND metadata->>${facet_field} IS NOT NULL
      GROUP BY facet_value
      ORDER BY count DESC
      LIMIT ${facetLimit}
    `;
  } else if (workspaceId) {
    facetSql = sql<{ facet_value: string; count: number }[]>`
      SELECT
        metadata->>${facet_field} AS facet_value,
        COUNT(*)::int AS count
      FROM search.documents
      WHERE fts_vector @@ plainto_tsquery('english', ${text})
        AND workspace_id = ${workspaceId}
        AND metadata->>${facet_field} IS NOT NULL
      GROUP BY facet_value
      ORDER BY count DESC
      LIMIT ${facetLimit}
    `;
  } else {
    facetSql = sql<{ facet_value: string; count: number }[]>`
      SELECT
        metadata->>${facet_field} AS facet_value,
        COUNT(*)::int AS count
      FROM search.documents
      WHERE fts_vector @@ plainto_tsquery('english', ${text})
        AND metadata->>${facet_field} IS NOT NULL
      GROUP BY facet_value
      ORDER BY count DESC
      LIMIT ${facetLimit}
    `;
  }

  const facets: Record<string, { value: string; count: number }[]> = {};
  facets[facet_field] = await facetSql;

  return { results, facets };
}

export async function multiCollectionSearch(
  sql: Sql,
  query: SearchQuery & { collections: string[] },
): Promise<SearchResult[]> {
  const { text, collections, workspaceId, mode = "text", limit = 10 } = query;
  if (!collections.length) return [];

  const safeLimit = Math.max(1, Math.min(limit, 200));
  // Run search for each collection in parallel
  const results = await Promise.all(
    collections.map((col) =>
      search(sql, { text, collection: col, workspaceId, mode, limit: safeLimit }),
    ),
  );

  // Merge and resort by score
  const merged: SearchResult[] = results.flat();
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, safeLimit);
}

export async function autocomplete(
  sql: Sql,
  prefix: string,
  collection?: string,
  workspaceId?: string,
  limit: number = 10,
): Promise<{ doc_id: string; collection: string; content: string; metadata: any }[]> {
  if (!prefix || prefix.trim() === "") return [];

  const safeLimit = Math.max(1, Math.min(limit, 50));

  if (collection && workspaceId) {
    return sql<{ doc_id: string; collection: string; content: string; metadata: any }[]>`
      SELECT doc_id, collection, content, metadata
      FROM search.documents
      WHERE content ILIKE ${prefix + "%"}
        AND collection = ${collection}
        AND workspace_id = ${workspaceId}
      ORDER BY updated_at DESC
      LIMIT ${safeLimit}
    `;
  }

  if (collection) {
    return sql<{ doc_id: string; collection: string; content: string; metadata: any }[]>`
      SELECT doc_id, collection, content, metadata
      FROM search.documents
      WHERE content ILIKE ${prefix + "%"}
        AND collection = ${collection}
      ORDER BY updated_at DESC
      LIMIT ${safeLimit}
    `;
  }

  if (workspaceId) {
    return sql<{ doc_id: string; collection: string; content: string; metadata: any }[]>`
      SELECT doc_id, collection, content, metadata
      FROM search.documents
      WHERE content ILIKE ${prefix + "%"}
        AND workspace_id = ${workspaceId}
      ORDER BY updated_at DESC
      LIMIT ${safeLimit}
    `;
  }

  return sql<{ doc_id: string; collection: string; content: string; metadata: any }[]>`
    SELECT doc_id, collection, content, metadata
    FROM search.documents
    WHERE content ILIKE ${prefix + "%"}
    ORDER BY updated_at DESC
    LIMIT ${safeLimit}
  `;
}
