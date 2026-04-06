/**
 * Document indexing operations.
 */

import type { Sql } from "postgres";
import { generateEmbedding } from "./embeddings.js";

export interface IndexDocumentInput {
  collection: string;
  docId: string;
  content: string;
  workspaceId?: string;
  metadata?: any;
}

export async function indexDocument(
  sql: Sql,
  data: IndexDocumentInput,
): Promise<void> {
  const { collection, docId, content, workspaceId, metadata } = data;

  // Generate embedding if OpenAI key is available
  const embedding = await generateEmbedding(content);

  if (embedding) {
    // Upsert with embedding (pgvector column)
    await sql`
      INSERT INTO search.documents (collection, workspace_id, doc_id, content, metadata, embedding)
      VALUES (
        ${collection},
        ${workspaceId ?? null},
        ${docId},
        ${content},
        ${sql.json(metadata ?? {})},
        ${JSON.stringify(embedding)}::vector
      )
      ON CONFLICT (collection, doc_id) DO UPDATE SET
        content      = EXCLUDED.content,
        workspace_id = EXCLUDED.workspace_id,
        metadata     = EXCLUDED.metadata,
        embedding    = EXCLUDED.embedding,
        updated_at   = NOW()
    `;
  } else {
    // Upsert without embedding
    await sql`
      INSERT INTO search.documents (collection, workspace_id, doc_id, content, metadata)
      VALUES (
        ${collection},
        ${workspaceId ?? null},
        ${docId},
        ${content},
        ${sql.json(metadata ?? {})}
      )
      ON CONFLICT (collection, doc_id) DO UPDATE SET
        content      = EXCLUDED.content,
        workspace_id = EXCLUDED.workspace_id,
        metadata     = EXCLUDED.metadata,
        updated_at   = NOW()
    `;
  }
}

export async function deleteDocument(
  sql: Sql,
  collection: string,
  docId: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM search.documents
    WHERE collection = ${collection} AND doc_id = ${docId}
    RETURNING id
  `;
  return result.length > 0;
}

export async function deleteCollection(
  sql: Sql,
  collection: string,
  workspaceId?: string,
): Promise<number> {
  if (workspaceId) {
    const result = await sql`
      DELETE FROM search.documents
      WHERE collection = ${collection} AND workspace_id = ${workspaceId}
      RETURNING id
    `;
    return result.length;
  }
  const result = await sql`
    DELETE FROM search.documents
    WHERE collection = ${collection}
    RETURNING id
  `;
  return result.length;
}

export async function getDocument(
  sql: Sql,
  collection: string,
  docId: string,
): Promise<{ doc_id: string; collection: string; content: string; metadata: any; updated_at: string } | null> {
  const result = await sql<{ doc_id: string; collection: string; content: string; metadata: any; updated_at: string }[]>`
    SELECT doc_id, collection, content, metadata, updated_at
    FROM search.documents
    WHERE collection = ${collection} AND doc_id = ${docId}
  `;
  return result[0] ?? null;
}

export async function batchIndexDocuments(
  sql: Sql,
  documents: IndexDocumentInput[],
): Promise<{ indexed: number; failed: number }> {
  let indexed = 0;
  let failed = 0;
  for (const doc of documents) {
    try {
      await indexDocument(sql, doc);
      indexed++;
    } catch {
      failed++;
    }
  }
  return { indexed, failed };
}

export async function updateDocument(
  sql: Sql,
  collection: string,
  docId: string,
  data: Partial<Omit<IndexDocumentInput, "collection" | "docId">>,
): Promise<boolean> {
  const { content, workspaceId, metadata } = data;
  if (!content && workspaceId === undefined && metadata === undefined) {
    return false;
  }
  const result = await sql`
    UPDATE search.documents
    SET
      content      = COALESCE(${content ?? null}, content),
      workspace_id = ${workspaceId ?? workspaceId === undefined ? null : workspaceId},
      metadata     = COALESCE(${metadata !== undefined ? sql.json(metadata) : null}, metadata),
      updated_at   = NOW()
    WHERE collection = ${collection} AND doc_id = ${docId}
    RETURNING id
  `;
  return result.length > 0;
}

export async function listCollections(
  sql: Sql,
  workspaceId?: string,
): Promise<{ collection: string; count: number }[]> {
  if (workspaceId) {
    return sql<{ collection: string; count: number }[]>`
      SELECT collection, COUNT(*)::int AS count
      FROM search.documents
      WHERE workspace_id = ${workspaceId}
      GROUP BY collection
      ORDER BY collection
    `;
  }
  return sql<{ collection: string; count: number }[]>`
    SELECT collection, COUNT(*)::int AS count
    FROM search.documents
    GROUP BY collection
    ORDER BY collection
  `;
}
