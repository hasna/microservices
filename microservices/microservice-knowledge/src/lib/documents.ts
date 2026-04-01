/**
 * Document CRUD operations.
 */

import type { Sql } from "postgres";

export interface Document {
  id: string;
  collection_id: string;
  title: string;
  source_type: "text" | "url" | "file";
  source_url: string | null;
  content: string;
  content_hash: string | null;
  metadata: any;
  chunk_count: number;
  status: "pending" | "processing" | "ready" | "error";
  error: string | null;
  created_at: Date;
}

export async function getDocument(
  sql: Sql,
  id: string,
): Promise<Document | null> {
  const [doc] = await sql<
    Document[]
  >`SELECT * FROM knowledge.documents WHERE id = ${id}`;
  return doc ?? null;
}

export async function listDocuments(
  sql: Sql,
  collectionId: string,
): Promise<Document[]> {
  return sql<Document[]>`
    SELECT * FROM knowledge.documents
    WHERE collection_id = ${collectionId}
    ORDER BY created_at DESC
  `;
}

export async function deleteDocument(sql: Sql, id: string): Promise<boolean> {
  // Get collection_id before deletion to update counts
  const [doc] = await sql<
    Document[]
  >`SELECT collection_id, chunk_count FROM knowledge.documents WHERE id = ${id}`;
  if (!doc) return false;

  const result = await sql`DELETE FROM knowledge.documents WHERE id = ${id}`;
  const deleted = (result.count ?? 0) > 0;

  if (deleted) {
    await sql`
      UPDATE knowledge.collections
      SET document_count = document_count - 1,
          chunk_count = chunk_count - ${doc.chunk_count}
      WHERE id = ${doc.collection_id}
    `;
  }

  return deleted;
}

/**
 * Compute SHA-256 hash of content for deduplication.
 */
export async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
