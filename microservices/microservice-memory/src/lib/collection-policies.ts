/**
 * Collection-level policies — defaults and rules applied to memories within a collection.
 */

import type { Sql } from "postgres";

export type MemoryType = "episodic" | "semantic" | "procedural" | "context";

export interface CollectionPolicy {
  id: string;
  collection_id: string;
  workspace_id: string;
  default_memory_type: MemoryType | null;
  default_importance: number | null;
  default_priority: number | null;
  default_ttl_seconds: number | null;
  max_memories: number | null;
  allow_duplicates: boolean | null;
  auto_consolidate: boolean | null;
  consolidation_window_hours: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertCollectionPolicyInput {
  collectionId: string;
  workspaceId: string;
  defaultMemoryType?: MemoryType;
  defaultImportance?: number;
  defaultPriority?: number;
  defaultTtlSeconds?: number;
  maxMemories?: number;
  allowDuplicates?: boolean;
  autoConsolidate?: boolean;
  consolidationWindowHours?: number;
}

/**
 * Create or update (upsert) a collection policy.
 */
export async function upsertCollectionPolicy(
  sql: Sql,
  input: UpsertCollectionPolicyInput,
): Promise<CollectionPolicy> {
  const [policy] = await sql<CollectionPolicy[]>`
    INSERT INTO memory.collection_policies (
      collection_id, workspace_id,
      default_memory_type, default_importance, default_priority,
      default_ttl_seconds, max_memories, allow_duplicates,
      auto_consolidate, consolidation_window_hours
    )
    VALUES (
      ${input.collectionId}, ${input.workspaceId},
      ${input.defaultMemoryType ?? null},
      ${input.defaultImportance ?? null},
      ${input.defaultPriority ?? null},
      ${input.defaultTtlSeconds ?? null},
      ${input.maxMemories ?? null},
      ${input.allowDuplicates ?? null},
      ${input.autoConsolidate ?? null},
      ${input.consolidationWindowHours ?? null}
    )
    ON CONFLICT (collection_id) DO UPDATE SET
      default_memory_type = COALESCE(EXCLUDED.default_memory_type, collection_policies.default_memory_type),
      default_importance = COALESCE(EXCLUDED.default_importance, collection_policies.default_importance),
      default_priority = COALESCE(EXCLUDED.default_priority, collection_policies.default_priority),
      default_ttl_seconds = COALESCE(EXCLUDED.default_ttl_seconds, collection_policies.default_ttl_seconds),
      max_memories = COALESCE(EXCLUDED.max_memories, collection_policies.max_memories),
      allow_duplicates = COALESCE(EXCLUDED.allow_duplicates, collection_policies.allow_duplicates),
      auto_consolidate = COALESCE(EXCLUDED.auto_consolidate, collection_policies.auto_consolidate),
      consolidation_window_hours = COALESCE(EXCLUDED.consolidation_window_hours, collection_policies.consolidation_window_hours),
      updated_at = NOW()
    RETURNING *
  `;
  return policy;
}

/**
 * Get the policy for a collection.
 */
export async function getCollectionPolicy(
  sql: Sql,
  collectionId: string,
): Promise<CollectionPolicy | null> {
  const [policy] = await sql<CollectionPolicy[]>`
    SELECT * FROM memory.collection_policies WHERE collection_id = ${collectionId}
  `;
  return policy ?? null;
}

/**
 * List all policies for a workspace.
 */
export async function listCollectionPolicies(
  sql: Sql,
  workspaceId: string,
): Promise<CollectionPolicy[]> {
  return sql<CollectionPolicy[]>`
    SELECT * FROM memory.collection_policies
    WHERE workspace_id = ${workspaceId}
    ORDER BY collection_id
  `;
}

/**
 * Delete a collection policy.
 */
export async function deleteCollectionPolicy(
  sql: Sql,
  collectionId: string,
): Promise<boolean> {
  const result = await sql.unsafe(
    `DELETE FROM memory.collection_policies WHERE collection_id = $1`,
    [collectionId],
  );
  return (result.count ?? 0) > 0;
}

/**
 * Get the effective defaults for a collection (the policy or global defaults).
 * Returns an object with the resolved defaults to apply to new memories.
 */
export async function getEffectiveCollectionDefaults(
  sql: Sql,
  collectionId: string,
): Promise<{
  memoryType: MemoryType;
  importance: number;
  priority: number;
  ttlSeconds: number;
  maxMemories: number;
  allowDuplicates: boolean;
}> {
  const policy = await getCollectionPolicy(sql, collectionId);
  return {
    memoryType: policy?.default_memory_type ?? "semantic",
    importance: policy?.default_importance ?? 0.5,
    priority: policy?.default_priority ?? 0,
    ttlSeconds: policy?.default_ttl_seconds ?? 0,
    maxMemories: policy?.max_memories ?? 10000,
    allowDuplicates: policy?.allow_duplicates ?? true,
  };
}

/**
 * Check if a collection has reached its memory limit.
 */
export async function isCollectionAtCapacity(
  sql: Sql,
  collectionId: string,
): Promise<{ at_capacity: boolean; current_count: number; max_memories: number | null }> {
  const [policy] = await sql<{ max_memories: number | null }[]>`
    SELECT max_memories FROM memory.collection_policies WHERE collection_id = ${collectionId}
  `;
  if (!policy?.max_memories) {
    return { at_capacity: false, current_count: 0, max_memories: null };
  }

  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*) as count FROM memory.memories WHERE collection_id = ${collectionId}
  `;
  const count = Number(row?.count ?? 0);
  return {
    at_capacity: count >= policy.max_memories,
    current_count: count,
    max_memories: policy.max_memories,
  };
}
