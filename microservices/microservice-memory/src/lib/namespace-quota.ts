/**
 * Namespace memory budget enforcement — per-namespace memory quotas
 * and auto-classification of memories into episodic/semantic/procedural/context types.
 */

import type { Sql } from "postgres";
import type { MemoryType } from "./memory-types.js";

export interface NamespaceBudget {
  workspaceId: string;
  namespace: string;
  maxMemories: number;
  currentCount: number;
  enforceQuota: boolean;
}

export interface MemoryClassification {
  memoryId: string;
  classifiedType: MemoryType;
  confidence: number;
  reason: string;
}

/**
 * Get current budget for a namespace.
 */
export async function getNamespaceBudget(
  sql: Sql,
  workspaceId: string,
  namespace: string,
): Promise<NamespaceBudget | null> {
  const [row] = await sql<any[]>`
    SELECT workspace_id, namespace, max_memories, current_count, enforce_quota
    FROM memory.namespace_budgets
    WHERE workspace_id = ${workspaceId} AND namespace = ${namespace}
  `;
  return row
    ? { workspaceId: row.workspace_id, namespace: row.namespace, maxMemories: row.max_memories, currentCount: row.current_count, enforceQuota: row.enforce_quota }
    : null;
}

/**
 * Set or update a namespace budget.
 */
export async function setNamespaceBudget(
  sql: Sql,
  workspaceId: string,
  namespace: string,
  maxMemories: number,
  enforceQuota: boolean = false,
): Promise<NamespaceBudget> {
  const [row] = await sql<any[]>`
    INSERT INTO memory.namespace_budgets (workspace_id, namespace, max_memories, enforce_quota)
    VALUES (${workspaceId}, ${namespace}, ${maxMemories}, ${enforceQuota})
    ON CONFLICT (workspace_id, namespace) DO UPDATE SET
      max_memories = ${maxMemories},
      enforce_quota = ${enforceQuota},
      updated_at = NOW()
    RETURNING workspace_id, namespace, max_memories, current_count, enforce_quota
  `;
  return { workspaceId: row.workspace_id, namespace: row.namespace, maxMemories: row.max_memories, currentCount: row.current_count, enforceQuota: row.enforce_quota };
}

/**
 * Recount current memory usage for a namespace and update budget.
 */
export async function refreshNamespaceCount(
  sql: Sql,
  workspaceId: string,
  namespace: string,
): Promise<number> {
  const [result] = await sql.unsafe(
    `SELECT COUNT(*) as c FROM memory.memories m
     JOIN memory.collections c2 ON m.collection_id = c2.id
     WHERE m.workspace_id = $1 AND c2.namespace = $2
       AND (m.soft_expires_at IS NULL OR m.soft_expires_at > NOW())`,
    [workspaceId, namespace],
  );
  const count = Number(result?.c ?? 0);
  await sql.unsafe(
    `INSERT INTO memory.namespace_budgets (workspace_id, namespace, current_count, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (workspace_id, namespace) DO UPDATE SET current_count = $3, updated_at = NOW()`,
    [workspaceId, namespace, count],
  );
  return count;
}

/**
 * Enforce namespace quota — if over limit, evict lowest-importance non-pinned memories.
 * Returns number of evicted memories.
 */
export async function enforceNamespaceQuota(
  sql: Sql,
  workspaceId: string,
  namespace: string,
  dryRun: boolean = false,
): Promise<number> {
  const budget = await getNamespaceBudget(sql, workspaceId, namespace);
  if (!budget || !budget.enforceQuota) return 0;
  if (budget.currentCount <= budget.maxMemories) return 0;

  const toEvict = budget.currentCount - budget.maxMemories;
  if (dryRun) return toEvict;

  const result = await sql.unsafe(
    `DELETE FROM memory.memories m
     USING memory.collections c
     WHERE m.collection_id = c.id
       AND c.namespace = $1
       AND m.workspace_id = $2
       AND m.is_pinned = false
       AND (m.soft_expires_at IS NULL OR m.soft_expires_at > NOW())
       AND m.importance = (
         SELECT MIN(m2.importance)
         FROM memory.memories m2
         JOIN memory.collections c2 ON m2.collection_id = c2.id
         WHERE c2.namespace = $1
           AND m2.workspace_id = $2
           AND m2.is_pinned = false
           AND (m2.soft_expires_at IS NULL OR m2.soft_expires_at > NOW())
       )
     LIMIT $3
     RETURNING m.id`,
    [namespace, workspaceId, toEvict],
  );
  await refreshNamespaceCount(sql, workspaceId, namespace);
  return result.count ?? 0;
}

/**
 * Auto-classify a memory based on type-routing rules.
 * Returns classified type or null if no rules matched.
 */
export async function classifyMemory(
  sql: Sql,
  workspaceId: string,
  memoryId: string,
  content: string,
  summary?: string,
  metadata?: Record<string, unknown>,
): Promise<MemoryClassification | null> {
  const rules = await sql<any[]>`
    SELECT * FROM memory.type_routing_rules
    WHERE workspace_id = ${workspaceId} AND enabled = true
    ORDER BY priority DESC
  `;

  let bestRule: any = null;
  for (const rule of rules) {
    if (rule.namespace && rule.namespace !== "") {
      // namespace-specific rule - skip if we don't have ns in context
      continue;
    }
    const pattern = rule.pattern;
    let matched = false;
    if (rule.match_field === "content") {
      matched = content.includes(pattern) || new RegExp(pattern).test(content);
    } else if (rule.match_field === "summary" && summary) {
      matched = summary.includes(pattern) || new RegExp(pattern).test(summary);
    } else if (rule.match_field === "metadata" && metadata) {
      matched = JSON.stringify(metadata).includes(pattern);
    }
    if (matched) {
      bestRule = rule;
      break;
    }
  }

  if (!bestRule) return null;

  const [existing] = await sql<any[]>`
    SELECT * FROM memory.memory_classifications WHERE memory_id = ${memoryId}
  `;

  if (existing) {
    await sql`UPDATE memory.memory_classifications SET classified_type = ${bestRule.assigned_type}, confidence = 0.8, reason = ${"matched routing rule: " + bestRule.pattern} WHERE memory_id = ${memoryId}`;
  } else {
    await sql`
      INSERT INTO memory.memory_classifications (memory_id, classified_type, confidence, reason)
      VALUES (${memoryId}, ${bestRule.assigned_type}, 0.8, ${"matched routing rule: " + bestRule.pattern})
    `;
  }

  return {
    memoryId,
    classifiedType: bestRule.assigned_type as MemoryType,
    confidence: 0.8,
    reason: "matched routing rule: " + bestRule.pattern,
  };
}

/**
 * List memory classifications for a workspace by type.
 */
export async function listMemoryClassifications(
  sql: Sql,
  workspaceId: string,
  classifiedType?: MemoryType,
): Promise<{ memoryId: string; classifiedType: MemoryType; confidence: number; reason: string }[]> {
  if (classifiedType) {
    return sql<any[]>`
      SELECT mc.memory_id, mc.classified_type, mc.confidence, mc.reason
      FROM memory.memory_classifications mc
      JOIN memory.memories m ON mc.memory_id = m.id
      WHERE m.workspace_id = ${workspaceId} AND mc.classified_type = ${classifiedType}
      ORDER BY mc.created_at DESC
    `;
  }
  return sql<any[]>`
    SELECT mc.memory_id, mc.classified_type, mc.confidence, mc.reason
    FROM memory.memory_classifications mc
    JOIN memory.memories m ON mc.memory_id = m.id
    WHERE m.workspace_id = ${workspaceId}
    ORDER BY mc.created_at DESC
  `;
}