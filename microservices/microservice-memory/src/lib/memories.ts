/**
 * Memory CRUD and search operations.
 */

import type { Sql } from "postgres";
import { generateEmbedding } from "./embeddings.js";

export type MemoryType = "episodic" | "semantic" | "procedural" | "context";

export interface Memory {
  id: string;
  workspace_id: string;
  user_id: string | null;
  collection_id: string | null;
  content: string;
  summary: string | null;
  importance: number;
  memory_type: MemoryType;
  priority: number;
  metadata: any;
  embedding_text: string | null;
  embedding: any;
  expires_at: Date | null;
  ttl_seconds: number;
  is_pinned: boolean;
  pinned_at: Date | null;
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
  memoryType?: MemoryType;
  priority?: number;
  metadata?: any;
  expiresAt?: Date;
  ttlSeconds?: number;
  isPinned?: boolean;
}

export interface SearchQuery {
  workspaceId: string;
  userId?: string;
  text: string;
  mode?: "semantic" | "text" | "hybrid";
  limit?: number;
  collectionId?: string;
  namespace?: string;
  memoryType?: MemoryType;
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

  const memoryType = data.memoryType ?? "semantic";
  const priority = data.priority ?? 0;
  const isPinned = data.isPinned ?? false;
  const ttlSeconds = data.ttlSeconds ?? 0;

  // Compute expires_at: if ttlSeconds is set and no explicit expiresAt given,
  // set expires_at = now + ttl_seconds; pinned entries ignore TTL so we still set it
  let expiresAt = data.expiresAt ?? null;
  if (expiresAt === null && ttlSeconds > 0) {
    const now = new Date();
    expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  }

  if (hasPgvector && embedding) {
    const [mem] = await sql<Memory[]>`
      INSERT INTO memory.memories
        (workspace_id, user_id, collection_id, content, summary, importance, memory_type, priority, metadata, embedding_text, embedding, expires_at, ttl_seconds, is_pinned)
      VALUES
        (${data.workspaceId}, ${data.userId ?? null}, ${data.collectionId ?? null},
         ${data.content}, ${data.summary ?? null}, ${importance}, ${memoryType}, ${priority}, ${sql.json(metadata)},
         ${data.content}, ${`[${embedding.join(",")}]`}, ${expiresAt}, ${ttlSeconds}, ${isPinned})
      RETURNING *
    `;
    return mem!;
  } else {
    const [mem] = await sql<Memory[]>`
      INSERT INTO memory.memories
        (workspace_id, user_id, collection_id, content, summary, importance, memory_type, priority, metadata, embedding_text, expires_at, ttl_seconds, is_pinned)
      VALUES
        (${data.workspaceId}, ${data.userId ?? null}, ${data.collectionId ?? null},
         ${data.content}, ${data.summary ?? null}, ${importance}, ${memoryType}, ${priority}, ${sql.json(metadata)},
         ${data.content}, ${expiresAt}, ${ttlSeconds}, ${isPinned})
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
  if (query.namespace) {
    // JOIN with collections to filter by namespace
    if (query.collectionId) {
      return sql<Memory[]>`
        SELECT m.* FROM memory.memories m
        JOIN memory.collections c ON m.collection_id = c.id
        WHERE m.workspace_id = ${query.workspaceId}
          AND c.namespace = ${query.namespace}
          ${query.userId ? sql`AND (m.user_id = ${query.userId} OR m.user_id IS NULL)` : sql``}
          AND m.collection_id = ${query.collectionId}
          ${query.memoryType ? sql`AND m.memory_type = ${query.memoryType}` : sql``}
          AND (m.expires_at IS NULL OR m.expires_at > NOW())
          AND m.embedding IS NOT NULL
        ORDER BY m.embedding <=> ${embeddingStr}::vector, m.priority DESC
        LIMIT ${limit}
      `;
    }
    return sql<Memory[]>`
      SELECT m.* FROM memory.memories m
      JOIN memory.collections c ON m.collection_id = c.id
      WHERE m.workspace_id = ${query.workspaceId}
        AND c.namespace = ${query.namespace}
        ${query.userId ? sql`AND (m.user_id = ${query.userId} OR m.user_id IS NULL)` : sql``}
        ${query.memoryType ? sql`AND m.memory_type = ${query.memoryType}` : sql``}
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
        AND m.embedding IS NOT NULL
      ORDER BY m.embedding <=> ${embeddingStr}::vector, m.priority DESC
      LIMIT ${limit}
    `;
  }
  if (query.collectionId) {
    return sql<Memory[]>`
      SELECT * FROM memory.memories
      WHERE workspace_id = ${query.workspaceId}
        ${query.userId ? sql`AND (user_id = ${query.userId} OR user_id IS NULL)` : sql``}
        AND collection_id = ${query.collectionId}
        ${query.memoryType ? sql`AND memory_type = ${query.memoryType}` : sql``}
        AND (expires_at IS NULL OR expires_at > NOW())
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingStr}::vector, priority DESC
      LIMIT ${limit}
    `;
  }
  return sql<Memory[]>`
    SELECT * FROM memory.memories
    WHERE workspace_id = ${query.workspaceId}
      ${query.userId ? sql`AND (user_id = ${query.userId} OR user_id IS NULL)` : sql``}
      ${query.memoryType ? sql`AND memory_type = ${query.memoryType}` : sql``}
      AND (expires_at IS NULL OR expires_at > NOW())
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingStr}::vector, priority DESC
    LIMIT ${limit}
  `;
}

async function textSearch(
  sql: Sql,
  query: SearchQuery,
  limit: number,
): Promise<Memory[]> {
  if (query.namespace) {
    // JOIN with collections to filter by namespace
    if (query.collectionId) {
      return sql<Memory[]>`
        SELECT m.* FROM memory.memories m
        JOIN memory.collections c ON m.collection_id = c.id
        WHERE m.workspace_id = ${query.workspaceId}
          AND c.namespace = ${query.namespace}
          ${query.userId ? sql`AND (m.user_id = ${query.userId} OR m.user_id IS NULL)` : sql``}
          AND m.collection_id = ${query.collectionId}
          ${query.memoryType ? sql`AND m.memory_type = ${query.memoryType}` : sql``}
          AND (m.expires_at IS NULL OR m.expires_at > NOW())
          AND to_tsvector('english', m.content) @@ plainto_tsquery('english', ${query.text})
        ORDER BY ts_rank(to_tsvector('english', m.content), plainto_tsquery('english', ${query.text})) DESC, m.priority DESC, m.created_at DESC
        LIMIT ${limit}
      `;
    }
    return sql<Memory[]>`
      SELECT m.* FROM memory.memories m
      JOIN memory.collections c ON m.collection_id = c.id
      WHERE m.workspace_id = ${query.workspaceId}
        AND c.namespace = ${query.namespace}
        ${query.userId ? sql`AND (m.user_id = ${query.userId} OR m.user_id IS NULL)` : sql``}
        ${query.memoryType ? sql`AND m.memory_type = ${query.memoryType}` : sql``}
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
        AND to_tsvector('english', m.content) @@ plainto_tsquery('english', ${query.text})
      ORDER BY ts_rank(to_tsvector('english', m.content), plainto_tsquery('english', ${query.text})) DESC, m.priority DESC, m.created_at DESC
      LIMIT ${limit}
    `;
  }
  if (query.collectionId) {
    return sql<Memory[]>`
      SELECT * FROM memory.memories
      WHERE workspace_id = ${query.workspaceId}
        ${query.userId ? sql`AND (user_id = ${query.userId} OR user_id IS NULL)` : sql``}
        AND collection_id = ${query.collectionId}
        ${query.memoryType ? sql`AND memory_type = ${query.memoryType}` : sql``}
        AND (expires_at IS NULL OR expires_at > NOW())
        AND to_tsvector('english', content) @@ plainto_tsquery('english', ${query.text})
      ORDER BY ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${query.text})) DESC, priority DESC, created_at DESC
      LIMIT ${limit}
    `;
  }
  return sql<Memory[]>`
    SELECT * FROM memory.memories
    WHERE workspace_id = ${query.workspaceId}
      ${query.userId ? sql`AND (user_id = ${query.userId} OR user_id IS NULL)` : sql``}
      ${query.memoryType ? sql`AND memory_type = ${query.memoryType}` : sql``}
      AND (expires_at IS NULL OR expires_at > NOW())
      AND to_tsvector('english', content) @@ plainto_tsquery('english', ${query.text})
    ORDER BY ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${query.text})) DESC, priority DESC, created_at DESC
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
  options?: { namespace?: string; memoryType?: MemoryType },
): Promise<Memory[]> {
  if (options?.namespace) {
    if (userId) {
      return sql<Memory[]>`
        SELECT m.* FROM memory.memories m
        JOIN memory.collections c ON m.collection_id = c.id
        WHERE m.workspace_id = ${workspaceId}
          AND c.namespace = ${options.namespace}
          AND (m.user_id = ${userId} OR m.user_id IS NULL)
          ${options.memoryType ? sql`AND m.memory_type = ${options.memoryType}` : sql``}
          AND (m.expires_at IS NULL OR m.expires_at > NOW())
        ORDER BY m.priority DESC, m.created_at DESC
        LIMIT ${limit}
      `;
    }
    return sql<Memory[]>`
      SELECT m.* FROM memory.memories m
      JOIN memory.collections c ON m.collection_id = c.id
      WHERE m.workspace_id = ${workspaceId}
        AND c.namespace = ${options.namespace}
        ${options.memoryType ? sql`AND m.memory_type = ${options.memoryType}` : sql``}
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
      ORDER BY m.priority DESC, m.created_at DESC
      LIMIT ${limit}
    `;
  }
  if (userId) {
    return sql<Memory[]>`
      SELECT * FROM memory.memories
      WHERE workspace_id = ${workspaceId}
        AND (user_id = ${userId} OR user_id IS NULL)
        ${options?.memoryType ? sql`AND memory_type = ${options.memoryType}` : sql``}
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY priority DESC, created_at DESC
      LIMIT ${limit}
    `;
  }
  return sql<Memory[]>`
    SELECT * FROM memory.memories
    WHERE workspace_id = ${workspaceId}
      ${options?.memoryType ? sql`AND memory_type = ${options.memoryType}` : sql``}
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY priority DESC, created_at DESC
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

export interface UpdateMemoryInput {
  content?: string;
  summary?: string;
  importance?: number;
  memoryType?: MemoryType;
  priority?: number;
  metadata?: any;
  expiresAt?: Date | null;
  isPinned?: boolean;
  ttlSeconds?: number;
}

export interface MemoryStats {
  workspace_id: string;
  total_count: number;
  expired_count: number;
  pinned_count: number;
  type_distribution: Record<MemoryType, number>;
  namespace_counts: Record<string, number>;
  collection_counts: Record<string, number>;
}

export interface RecommendQuery {
  workspaceId: string;
  userId?: string;
  memoryIds?: string[];
  namespace?: string;
  limit?: number;
}

/**
 * Update memory fields: content, summary, importance, type, priority, metadata, expires_at, is_pinned, ttl_seconds.
 * Pass null in expiresAt to clear expiry (make permanent).
 * Setting isPinned to true records pinned_at; setting to false clears pinned_at.
 */
export async function updateMemory(
  sql: Sql,
  id: string,
  input: UpdateMemoryInput,
): Promise<Memory | null> {
  const fields: { col: string; val: any }[] = [];
  if (input.content !== undefined) fields.push({ col: "content", val: input.content });
  if (input.summary !== undefined) fields.push({ col: "summary", val: input.summary });
  if (input.importance !== undefined)
    fields.push({ col: "importance", val: Math.max(0, Math.min(1, input.importance)) });
  if (input.memoryType !== undefined) fields.push({ col: "memory_type", val: input.memoryType });
  if (input.priority !== undefined) fields.push({ col: "priority", val: input.priority });
  if (input.metadata !== undefined)
    fields.push({ col: "metadata", val: JSON.stringify(input.metadata) });
  if (input.expiresAt !== undefined) fields.push({ col: "expires_at", val: input.expiresAt });
  if (input.ttlSeconds !== undefined) {
    fields.push({ col: "ttl_seconds", val: input.ttlSeconds });
    // Recompute expires_at from ttl if it was set
    if (input.ttlSeconds > 0) {
      const now = new Date();
      fields.push({ col: "expires_at", val: new Date(now.getTime() + input.ttlSeconds * 1000) });
    }
  }
  if (input.isPinned !== undefined) {
    fields.push({ col: "is_pinned", val: input.isPinned });
    fields.push({ col: "pinned_at", val: input.isPinned ? new Date() : null });
  }
  if (fields.length === 0) return getMemory(sql, id);
  const cols = fields.map((f) => f.col);
  const vals = fields.map((f) => f.val);
  const setClause = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
  const query = `UPDATE memory.memories SET updated_at = NOW(), ${setClause} WHERE id = $${vals.length + 1} RETURNING *`;
  const result = await sql.unsafe(query, ...vals, id);
  return (result as Memory[])[0] ?? null;
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

/**
 * Pin a memory so it is never auto-deleted and ignores TTL.
 */
export async function pinMemory(sql: Sql, id: string): Promise<Memory | null> {
  const [mem] = await sql<Memory[]>`
    UPDATE memory.memories
    SET is_pinned = true, pinned_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return mem ?? null;
}

/**
 * Unpin a memory, restoring normal TTL/expiry behavior.
 */
export async function unpinMemory(sql: Sql, id: string): Promise<Memory | null> {
  const [mem] = await sql<Memory[]>`
    UPDATE memory.memories
    SET is_pinned = false, pinned_at = NULL, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return mem ?? null;
}

/**
 * Fork a memory: create a copy under a new namespace (and optionally a new collection).
 * The forked copy is never pinned regardless of the original's state.
 * Returns the newly forked memory.
 */
export async function forkMemory(
  sql: Sql,
  id: string,
  targetNamespace: string,
  targetCollectionId?: string,
): Promise<Memory | null> {
  const original = await getMemory(sql, id);
  if (!original) return null;

  // Resolve target collection from namespace if needed
  let collectionId = targetCollectionId ?? null;
  if (!collectionId && targetNamespace) {
    const [col] = await sql<any[]>`
      SELECT id FROM memory.collections
      WHERE workspace_id = ${original.workspace_id}
        AND namespace = ${targetNamespace}
      LIMIT 1
    `;
    if (col) collectionId = col.id;
  }

  const [mem] = await sql<Memory[]>`
    INSERT INTO memory.memories
      (workspace_id, user_id, collection_id, content, summary, importance, memory_type, priority, metadata, embedding_text, expires_at, ttl_seconds, is_pinned)
    VALUES
      (${original.workspace_id}, ${original.user_id}, ${collectionId},
       ${original.content}, ${original.summary}, ${original.importance}, ${original.memory_type},
       ${original.priority}, ${sql.json(original.metadata ?? {})},
       ${original.embedding_text}, NULL, 0, false)
    RETURNING *
  `;
  return mem ?? null;
}

/**
 * Get memory statistics for a workspace: total, expired, pinned counts,
 * type distribution, and per-namespace/collection counts.
 */
export async function getMemoryStats(
  sql: Sql,
  workspaceId: string,
): Promise<MemoryStats> {
  // Total count
  const [totalRow] = await sql<any[]>`
    SELECT COUNT(*) as cnt FROM memory.memories WHERE workspace_id = ${workspaceId}
  `;
  const totalCount = Number(totalRow?.cnt ?? 0);

  // Expired count (past expires_at, not including pinned)
  const [expiredRow] = await sql<any[]>`
    SELECT COUNT(*) as cnt FROM memory.memories
    WHERE workspace_id = ${workspaceId}
      AND is_pinned = false
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
  `;
  const expiredCount = Number(expiredRow?.cnt ?? 0);

  // Pinned count
  const [pinnedRow] = await sql<any[]>`
    SELECT COUNT(*) as cnt FROM memory.memories WHERE workspace_id = ${workspaceId} AND is_pinned = true
  `;
  const pinnedCount = Number(pinnedRow?.cnt ?? 0);

  // Type distribution
  const typeRows = await sql<any[]>`
    SELECT memory_type, COUNT(*) as cnt
    FROM memory.memories
    WHERE workspace_id = ${workspaceId}
    GROUP BY memory_type
  `;
  const typeDistribution: Record<string, number> = { episodic: 0, semantic: 0, procedural: 0, context: 0 };
  for (const row of typeRows) {
    typeDistribution[row.memory_type] = Number(row.cnt);
  }

  // Namespace counts (join with collections)
  const nsRows = await sql<any[]>`
    SELECT c.namespace, COUNT(m.id) as cnt
    FROM memory.memories m
    JOIN memory.collections c ON m.collection_id = c.id
    WHERE m.workspace_id = ${workspaceId}
    GROUP BY c.namespace
  `;
  const namespaceCounts: Record<string, number> = {};
  for (const row of nsRows) {
    namespaceCounts[row.namespace] = Number(row.cnt);
  }

  // Collection counts
  const colRows = await sql<any[]>`
    SELECT collection_id, COUNT(*) as cnt
    FROM memory.memories
    WHERE workspace_id = ${workspaceId} AND collection_id IS NOT NULL
    GROUP BY collection_id
  `;
  const collectionCounts: Record<string, number> = {};
  for (const row of colRows) {
    collectionCounts[row.collection_id] = Number(row.cnt);
  }

  return {
    workspace_id: workspaceId,
    total_count: totalCount,
    expired_count: expiredCount,
    pinned_count: pinnedCount,
    type_distribution: typeDistribution as Record<MemoryType, number>,
    namespace_counts: namespaceCounts,
    collection_counts: collectionCounts,
  };
}

/**
 * Recommend memories based on recent access patterns.
 * Finds memories similar to the given memory IDs (by embedding cosine distance)
 * or recent memories in the workspace if no IDs are provided.
 * Prioritises unpinned, non-expired memories.
 */
export async function recommendMemories(
  sql: Sql,
  query: RecommendQuery,
): Promise<Memory[]> {
  const limit = query.limit ?? 10;
  const hasPgvector = await checkPgvector(sql);

  if (query.memoryIds && query.memoryIds.length > 0 && hasPgvector) {
    // Fetch embeddings of seed memories and find similar ones
    const seedRows = await sql<any[]>`
      SELECT embedding FROM memory.memories
      WHERE id = ANY(${query.memoryIds})
        AND embedding IS NOT NULL
    `;
    if (seedRows.length > 0) {
      // Average the seed embeddings
      const dim = seedRows[0].embedding.length;
      const avgEmbedding = new Array(dim).fill(0);
      for (const row of seedRows) {
        for (let i = 0; i < dim; i++) {
          avgEmbedding[i] += row.embedding[i] / seedRows.length;
        }
      }
      const embeddingStr = `[${avgEmbedding.map((v) => v.toFixed(6)).join(",")}]`;
      const baseQuery = `
        SELECT * FROM memory.memories
        WHERE workspace_id = $1
          AND is_pinned = false
          AND (expires_at IS NULL OR expires_at > NOW())
          AND embedding IS NOT NULL
          AND id != ALL($2)
        ORDER BY embedding <=> $3::vector, priority DESC, created_at DESC
        LIMIT ${limit}
      `;
      return sql.unsafe(baseQuery, [query.workspaceId, query.memoryIds, embeddingStr]) as any;
    }
  }

  // Fallback: return recently accessed (high priority, recent) memories
  if (query.namespace) {
    return sql<Memory[]>`
      SELECT m.* FROM memory.memories m
      JOIN memory.collections c ON m.collection_id = c.id
      WHERE m.workspace_id = ${query.workspaceId}
        AND c.namespace = ${query.namespace}
        ${query.userId ? sql`AND (m.user_id = ${query.userId} OR m.user_id IS NULL)` : sql``}
        AND m.is_pinned = false
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
      ORDER BY m.priority DESC, m.created_at DESC
      LIMIT ${limit}
    `;
  }
  return sql<Memory[]>`
    SELECT * FROM memory.memories
    WHERE workspace_id = ${query.workspaceId}
      ${query.userId ? sql`AND (user_id = ${query.userId} OR user_id IS NULL)` : sql``}
      AND is_pinned = false
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY priority DESC, created_at DESC
    LIMIT ${limit}
  `;
}
