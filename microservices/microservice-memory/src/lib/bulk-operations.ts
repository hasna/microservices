/**
 * Bulk memory operations — insert, update, and delete multiple memories at once.
 */

import type { Sql } from "postgres";
import { generateEmbedding } from "./embeddings.js";
import type { Memory, MemoryType, StoreMemoryInput, UpdateMemoryInput } from "./memories.js";

async function checkPgvector(sql: Sql): Promise<boolean> {
  try {
    await sql`SELECT 1::vector`;
    return true;
  } catch {
    return false;
  }
}

// ---- Bulk Insert -----------------------------------------------------------

export interface BulkStoreInput {
  workspaceId: string;
  items: Array<{
    content: string;
    userId?: string;
    collectionId?: string;
    summary?: string;
    importance?: number;
    memoryType?: MemoryType;
    priority?: number;
    metadata?: any;
    expiresAt?: Date;
    ttlSeconds?: number;
    isPinned?: boolean;
  }>;
}

export interface BulkStoreResult {
  inserted: number;
  failed: number;
  ids: string[];
  errors: Array<{ index: number; error: string }>;
}

/**
 * Insert multiple memories in a single transaction.
 * Returns IDs of successfully inserted memories.
 */
export async function bulkStoreMemories(
  sql: Sql,
  input: BulkStoreInput,
): Promise<BulkStoreResult> {
  const result: BulkStoreResult = {
    inserted: 0,
    failed: 0,
    ids: [],
    errors: [],
  };

  if (input.items.length === 0) return result;

  const hasPgvector = await checkPgvector(sql);
  let globalEmbedding: number[] | null = null;
  if (hasPgvector) {
    // Generate a single embedding for the batch for efficiency
    globalEmbedding = await generateEmbedding(input.items.map((i) => i.content).join("\n"));
  }

  try {
    await sql.begin(async (tx: any) => {
      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i]!;
        try {
          const importance = Math.max(0.0, Math.min(1.0, item.importance ?? 0.5));
          const memoryType = item.memoryType ?? "semantic";
          const priority = item.priority ?? 0;
          const isPinned = item.isPinned ?? false;
          const ttlSeconds = item.ttlSeconds ?? 0;
          const metadata = item.metadata ?? {};

          let expiresAt = item.expiresAt ?? null;
          if (expiresAt === null && ttlSeconds > 0) {
            expiresAt = new Date(Date.now() + ttlSeconds * 1000);
          }

          let emb: number[] | null = null;
          if (hasPgvector && globalEmbedding) {
            // Re-generate per-item for accuracy, or use batch embedding
            emb = await generateEmbedding(item.content);
          }

          if (emb) {
            const [row] = await tx<Memory[]>`
              INSERT INTO memory.memories
                (workspace_id, user_id, collection_id, content, summary, importance,
                 memory_type, priority, metadata, embedding_text, embedding, expires_at, ttl_seconds, is_pinned)
              VALUES (
                ${input.workspaceId},
                ${item.userId ?? null},
                ${item.collectionId ?? null},
                ${item.content},
                ${item.summary ?? null},
                ${importance},
                ${memoryType},
                ${priority},
                ${tx.json(metadata)},
                ${item.content},
                ${`[${emb.join(",")}]`},
                ${expiresAt},
                ${ttlSeconds},
                ${isPinned}
              )
              RETURNING id
            `;
            result.ids.push(row!.id);
          } else {
            const [row] = await tx<Memory[]>`
              INSERT INTO memory.memories
                (workspace_id, user_id, collection_id, content, summary, importance,
                 memory_type, priority, metadata, expires_at, ttl_seconds, is_pinned)
              VALUES (
                ${input.workspaceId},
                ${item.userId ?? null},
                ${item.collectionId ?? null},
                ${item.content},
                ${item.summary ?? null},
                ${importance},
                ${memoryType},
                ${priority},
                ${tx.json(metadata)},
                ${expiresAt},
                ${ttlSeconds},
                ${isPinned}
              )
              RETURNING id
            `;
            result.ids.push(row!.id);
          }
          result.inserted++;
        } catch (err: any) {
          result.failed++;
          result.errors.push({ index: i, error: err.message ?? String(err) });
        }
      }
    });
  } catch (err: any) {
    // Transaction-level error — all items failed
    for (let i = 0; i < input.items.length; i++) {
      result.errors.push({ index: i, error: err.message ?? String(err) });
    }
    result.failed = input.items.length;
  }

  return result;
}

// ---- Bulk Update -----------------------------------------------------------

export interface BulkUpdateInput {
  ids: string[];
  updates: Partial<{
    content: string;
    summary: string;
    importance: number;
    priority: number;
    metadata: any;
    isPinned: boolean;
    expiresAt: Date | null;
  }>;
}

export interface BulkUpdateResult {
  updated: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

/**
 * Update multiple memories in a single transaction.
 */
export async function bulkUpdateMemories(
  sql: Sql,
  input: BulkUpdateInput,
): Promise<BulkUpdateResult> {
  const result: BulkUpdateResult = {
    updated: 0,
    failed: 0,
    errors: [],
  };

  if (input.ids.length === 0) return result;

  const sets: string[] = ["updated_at = NOW()"];
  const vals: any[] = [];
  let idx = 1;

  if (input.updates.content !== undefined) {
    sets.push(`content = $${idx++}`);
    vals.push(input.updates.content);
    // Update embedding_text too
    sets.push(`embedding_text = $${idx++}`);
    vals.push(input.updates.content);
  }
  if (input.updates.summary !== undefined) {
    sets.push(`summary = $${idx++}`);
    vals.push(input.updates.summary);
  }
  if (input.updates.importance !== undefined) {
    sets.push(`importance = $${idx++}`);
    vals.push(Math.max(0.0, Math.min(1.0, input.updates.importance)));
  }
  if (input.updates.priority !== undefined) {
    sets.push(`priority = $${idx++}`);
    vals.push(input.updates.priority);
  }
  if (input.updates.metadata !== undefined) {
    sets.push(`metadata = $${idx++}`);
    vals.push(sql.json(input.updates.metadata));
  }
  if (input.updates.isPinned !== undefined) {
    sets.push(`is_pinned = $${idx++}`);
    vals.push(input.updates.isPinned);
    if (input.updates.isPinned) {
      sets.push(`pinned_at = NOW()`);
    } else {
      sets.push(`pinned_at = NULL`);
    }
  }
  if (input.updates.expiresAt !== undefined) {
    sets.push(`expires_at = $${idx++}`);
    vals.push(input.updates.expiresAt);
  }

  if (sets.length === 1) return result; // only updated_at, nothing to do

  vals.push(input.ids);

  try {
    const res = await sql.unsafe(
      `UPDATE memory.memories SET ${sets.join(", ")} WHERE id = ANY($${idx}) RETURNING id`,
      vals,
    ) as any[];
    result.updated = res.length;
    const updatedIds = new Set(res.map((r: any) => r.id));
    for (const id of input.ids) {
      if (!updatedIds.has(id)) {
        result.failed++;
        result.errors.push({ id, error: "Memory not found" });
      }
    }
  } catch (err: any) {
    for (const id of input.ids) {
      result.errors.push({ id, error: err.message ?? String(err) });
    }
    result.failed = input.ids.length;
  }

  return result;
}

// ---- Bulk Delete ----------------------------------------------------------

export interface BulkDeleteResult {
  deleted: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

/**
 * Delete multiple memories in a single transaction.
 */
export async function bulkDeleteMemories(
  sql: Sql,
  ids: string[],
): Promise<BulkDeleteResult> {
  const result: BulkDeleteResult = {
    deleted: 0,
    failed: 0,
    errors: [],
  };

  if (ids.length === 0) return result;

  try {
    const res = await sql`DELETE FROM memory.memories WHERE id = ANY(${ids}) RETURNING id` as any;
    result.deleted = res.length;
    const deletedIds = new Set(res.map((r: any) => r.id));
    for (const id of ids) {
      if (!deletedIds.has(id)) {
        result.failed++;
        result.errors.push({ id, error: "Memory not found" });
      }
    }
  } catch (err: any) {
    for (const id of ids) {
      result.errors.push({ id, error: err.message ?? String(err) });
    }
    result.failed = ids.length;
  }

  return result;
}
