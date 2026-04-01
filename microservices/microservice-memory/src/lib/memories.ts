/**
 * Memory CRUD and search operations.
 */

import type { Sql } from "postgres";
import { generateEmbedding } from "./embeddings.js";

export interface Memory {
  id: string;
  workspace_id: string;
  user_id: string | null;
  collection_id: string | null;
  content: string;
  summary: string | null;
  importance: number;
  metadata: any;
  embedding_text: string | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface StoreMemoryInput {
  workspaceId: string;
  userId?: string;
  collectionId?: string;
  content: string;
  summary?: string;
  importance?: number;
  metadata?: any;
  expiresAt?: Date;
}

export interface SearchQuery {
  workspaceId: string;
  userId?: string;
  text: string;
  mode?: "semantic" | "text" | "hybrid";
  limit?: number;
  collectionId?: string;
}

export async function storeMemory(
  sql: Sql,
  data: StoreMemoryInput,
): Promise<Memory> {
  if (!data.content || data.content.trim() === "") {
    throw new Error("Memory content cannot be empty");
  }

  const importance = Math.max(0.0, Math.min(1.0, data.importance ?? 0.5));
  const metadata = data.metadata ?? {};

  // Generate embedding if OpenAI key is available
  const embedding = await generateEmbedding(data.content);

  // Check if pgvector column exists
  const hasPgvector = await checkPgvector(sql);

  if (hasPgvector && embedding) {
    const [mem] = await sql<Memory[]>`
      INSERT INTO memory.memories
        (workspace_id, user_id, collection_id, content, summary, importance, metadata, embedding_text, embedding, expires_at)
      VALUES
        (${data.workspaceId}, ${data.userId ?? null}, ${data.collectionId ?? null},
         ${data.content}, ${data.summary ?? null}, ${importance}, ${sql.json(metadata)},
         ${data.content}, ${`[${embedding.join(",")}]`}, ${data.expiresAt ?? null})
      RETURNING *
    `;
    return mem!;
  } else {
    const [mem] = await sql<Memory[]>`
      INSERT INTO memory.memories
        (workspace_id, user_id, collection_id, content, summary, importance, metadata, embedding_text, expires_at)
      VALUES
        (${data.workspaceId}, ${data.userId ?? null}, ${data.collectionId ?? null},
         ${data.content}, ${data.summary ?? null}, ${importance}, ${sql.json(metadata)},
         ${data.content}, ${data.expiresAt ?? null})
      RETURNING *
    `;
    return mem!;
  }
}

export async function searchMemories(
  sql: Sql,
  query: SearchQuery,
): Promise<Memory[]> {
  const limit = query.limit ?? 10;
  const mode = query.mode ?? "text";
  const hasPgvector = await checkPgvector(sql);

  // Try semantic search if mode is semantic or hybrid and pgvector is available
  if ((mode === "semantic" || mode === "hybrid") && hasPgvector) {
    const embedding = await generateEmbedding(query.text);
    if (embedding) {
      if (mode === "semantic") {
        return semanticSearch(sql, query, embedding, limit);
      } else {
        // Hybrid: combine semantic + text, deduplicate
        const [semanticResults, textResults] = await Promise.all([
          semanticSearch(sql, query, embedding, limit),
          textSearch(sql, query, limit),
        ]);
        const seen = new Set<string>();
        const combined: Memory[] = [];
        for (const m of [...semanticResults, ...textResults]) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            combined.push(m);
          }
          if (combined.length >= limit) break;
        }
        return combined;
      }
    }
  }

  // Fall back to full-text search
  return textSearch(sql, query, limit);
}

async function semanticSearch(
  sql: Sql,
  query: SearchQuery,
  embedding: number[],
  limit: number,
): Promise<Memory[]> {
  const embeddingStr = `[${embedding.join(",")}]`;
  if (query.collectionId) {
    return sql<Memory[]>`
      SELECT * FROM memory.memories
      WHERE workspace_id = ${query.workspaceId}
        ${query.userId ? sql`AND (user_id = ${query.userId} OR user_id IS NULL)` : sql``}
        AND collection_id = ${query.collectionId}
        AND (expires_at IS NULL OR expires_at > NOW())
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `;
  }
  return sql<Memory[]>`
    SELECT * FROM memory.memories
    WHERE workspace_id = ${query.workspaceId}
      ${query.userId ? sql`AND (user_id = ${query.userId} OR user_id IS NULL)` : sql``}
      AND (expires_at IS NULL OR expires_at > NOW())
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${limit}
  `;
}

async function textSearch(
  sql: Sql,
  query: SearchQuery,
  limit: number,
): Promise<Memory[]> {
  if (query.collectionId) {
    return sql<Memory[]>`
      SELECT * FROM memory.memories
      WHERE workspace_id = ${query.workspaceId}
        ${query.userId ? sql`AND (user_id = ${query.userId} OR user_id IS NULL)` : sql``}
        AND collection_id = ${query.collectionId}
        AND (expires_at IS NULL OR expires_at > NOW())
        AND to_tsvector('english', content) @@ plainto_tsquery('english', ${query.text})
      ORDER BY ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${query.text})) DESC, created_at DESC
      LIMIT ${limit}
    `;
  }
  return sql<Memory[]>`
    SELECT * FROM memory.memories
    WHERE workspace_id = ${query.workspaceId}
      ${query.userId ? sql`AND (user_id = ${query.userId} OR user_id IS NULL)` : sql``}
      AND (expires_at IS NULL OR expires_at > NOW())
      AND to_tsvector('english', content) @@ plainto_tsquery('english', ${query.text})
    ORDER BY ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${query.text})) DESC, created_at DESC
    LIMIT ${limit}
  `;
}

export async function getMemory(sql: Sql, id: string): Promise<Memory | null> {
  const [mem] = await sql<
    Memory[]
  >`SELECT * FROM memory.memories WHERE id = ${id}`;
  return mem ?? null;
}

export async function listMemories(
  sql: Sql,
  workspaceId: string,
  userId?: string,
  limit = 50,
): Promise<Memory[]> {
  if (userId) {
    return sql<Memory[]>`
      SELECT * FROM memory.memories
      WHERE workspace_id = ${workspaceId}
        AND (user_id = ${userId} OR user_id IS NULL)
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }
  return sql<Memory[]>`
    SELECT * FROM memory.memories
    WHERE workspace_id = ${workspaceId}
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function deleteMemory(sql: Sql, id: string): Promise<boolean> {
  const result = await sql`DELETE FROM memory.memories WHERE id = ${id}`;
  return (result.count ?? 0) > 0;
}

export async function updateMemoryImportance(
  sql: Sql,
  id: string,
  importance: number,
): Promise<void> {
  const clamped = Math.max(0.0, Math.min(1.0, importance));
  await sql`
    UPDATE memory.memories
    SET importance = ${clamped}, updated_at = NOW()
    WHERE id = ${id}
  `;
}

// Check if pgvector embedding column exists
async function checkPgvector(sql: Sql): Promise<boolean> {
  try {
    const [row] = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'memory' AND table_name = 'memories' AND column_name = 'embedding'
    `;
    return !!row;
  } catch {
    return false;
  }
}
