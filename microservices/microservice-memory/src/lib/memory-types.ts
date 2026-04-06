/**
 * Memory type configurations — defaults and behavior per memory type
 * (episodic/semantic/procedural/context).
 * Lets workspaces customize how each memory type is stored, consolidated, and retrieved.
 */

import type { Sql } from "postgres";

export type MemoryType = "episodic" | "semantic" | "procedural" | "context";

export interface MemoryTypeConfig {
  workspaceId: string;
  memoryType: MemoryType;
  defaultTtlSeconds: number | null;
  autoConsolidate: boolean;
  consolidationMode: "summary_only" | "delete_source" | "archive";
  maxMemories: number | null;
  importanceFloor: number;
  decayModel: "linear" | "exponential" | "logarithmic";
  halfLifeHours: number | null;
  allowBoost: boolean;
  searchWeight: number; // boost factor for this type in hybrid search
  createdAt: Date;
  updatedAt: Date;
}

const TYPE_DEFAULTS: Record<MemoryType, Omit<MemoryTypeConfig, "workspaceId" | "memoryType" | "createdAt" | "updatedAt">> = {
  episodic: {
    defaultTtlSeconds: 30 * 24 * 3600, // 30 days — short-lived, auto-consolidated
    autoConsolidate: true,
    consolidationMode: "summary_only",
    maxMemories: 10000,
    importanceFloor: 0.1,
    decayModel: "exponential",
    halfLifeHours: 72, // importance halves every 3 days
    allowBoost: true,
    searchWeight: 1.2, // episodic memories get slight boost in recall (recent = relevant)
  },
  semantic: {
    defaultTtlSeconds: null, // permanent unless manually expired
    autoConsolidate: false,
    consolidationMode: "summary_only",
    maxMemories: null,
    importanceFloor: 0.2,
    decayModel: "logarithmic",
    halfLifeHours: 8760, // ~1 year
    allowBoost: true,
    searchWeight: 1.0,
  },
  procedural: {
    defaultTtlSeconds: null, // permanent — procedures are facts
    autoConsolidate: false,
    consolidationMode: "archive",
    maxMemories: null,
    importanceFloor: 0.3,
    decayModel: "linear",
    halfLifeHours: 87600, // ~10 years (very slow)
    allowBoost: false, // procedures should not be boosted/dimmed
    searchWeight: 0.8,
  },
  context: {
    defaultTtlSeconds: 3600, // 1 hour — ephemeral context, not stored long-term
    autoConsolidate: true,
    consolidationMode: "delete_source",
    maxMemories: 1000,
    importanceFloor: 0.05,
    decayModel: "exponential",
    halfLifeHours: 1, // very fast decay
    allowBoost: false,
    searchWeight: 0.5,
  },
};

export async function getMemoryTypeConfig(
  sql: Sql,
  workspaceId: string,
  memoryType: MemoryType,
): Promise<MemoryTypeConfig> {
  const [row] = await sql<any[]>`
    SELECT * FROM memory.memory_type_configs
    WHERE workspace_id = ${workspaceId} AND memory_type = ${memoryType}
  `;

  if (row) {
    return {
      workspaceId: row.workspace_id,
      memoryType: row.memory_type as MemoryType,
      defaultTtlSeconds: row.default_ttl_seconds,
      autoConsolidate: row.auto_consolidate,
      consolidationMode: row.consolidation_mode,
      maxMemories: row.max_memories,
      importanceFloor: row.importance_floor,
      decayModel: row.decay_model,
      halfLifeHours: row.half_life_hours,
      allowBoost: row.allow_boost,
      searchWeight: row.search_weight,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // Return workspace-level defaults merged with built-in defaults
  return {
    workspaceId,
    memoryType,
    ...TYPE_DEFAULTS[memoryType],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function setMemoryTypeConfig(
  sql: Sql,
  opts: {
    workspaceId: string;
    memoryType: MemoryType;
    defaultTtlSeconds?: number | null;
    autoConsolidate?: boolean;
    consolidationMode?: "summary_only" | "delete_source" | "archive";
    maxMemories?: number | null;
    importanceFloor?: number;
    decayModel?: "linear" | "exponential" | "logarithmic";
    halfLifeHours?: number | null;
    allowBoost?: boolean;
    searchWeight?: number;
  },
): Promise<MemoryTypeConfig> {
  const [row] = await sql<any[]>`
    INSERT INTO memory.memory_type_configs (
      workspace_id, memory_type,
      default_ttl_seconds, auto_consolidate, consolidation_mode,
      max_memories, importance_floor, decay_model, half_life_hours,
      allow_boost, search_weight
    )
    VALUES (
      ${opts.workspaceId}, ${opts.memoryType},
      ${opts.defaultTtlSeconds ?? TYPE_DEFAULTS[opts.memoryType].defaultTtlSeconds},
      ${opts.autoConsolidate ?? TYPE_DEFAULTS[opts.memoryType].autoConsolidate},
      ${opts.consolidationMode ?? TYPE_DEFAULTS[opts.memoryType].consolidationMode},
      ${opts.maxMemories ?? TYPE_DEFAULTS[opts.memoryType].maxMemories},
      ${opts.importanceFloor ?? TYPE_DEFAULTS[opts.memoryType].importanceFloor},
      ${opts.decayModel ?? TYPE_DEFAULTS[opts.memoryType].decayModel},
      ${opts.halfLifeHours ?? TYPE_DEFAULTS[opts.memoryType].halfLifeHours},
      ${opts.allowBoost ?? TYPE_DEFAULTS[opts.memoryType].allowBoost},
      ${opts.searchWeight ?? TYPE_DEFAULTS[opts.memoryType].searchWeight}
    )
    ON CONFLICT (workspace_id, memory_type)
    DO UPDATE SET
      default_ttl_seconds = EXCLUDED.default_ttl_seconds,
      auto_consolidate = EXCLUDED.auto_consolidate,
      consolidation_mode = EXCLUDED.consolidation_mode,
      max_memories = EXCLUDED.max_memories,
      importance_floor = EXCLUDED.importance_floor,
      decay_model = EXCLUDED.decay_model,
      half_life_hours = EXCLUDED.half_life_hours,
      allow_boost = EXCLUDED.allow_boost,
      search_weight = EXCLUDED.search_weight,
      updated_at = NOW()
    RETURNING *
  `;

  return {
    workspaceId: row.workspace_id,
    memoryType: row.memory_type as MemoryType,
    defaultTtlSeconds: row.default_ttl_seconds,
    autoConsolidate: row.auto_consolidate,
    consolidationMode: row.consolidation_mode,
    maxMemories: row.max_memories,
    importanceFloor: row.importance_floor,
    decayModel: row.decay_model,
    halfLifeHours: row.half_life_hours,
    allowBoost: row.allow_boost,
    searchWeight: row.search_weight,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listMemoryTypeConfigs(
  sql: Sql,
  workspaceId: string,
): Promise<MemoryTypeConfig[]> {
  const rows = await sql<any[]>`
    SELECT * FROM memory.memory_type_configs
    WHERE workspace_id = ${workspaceId}
    ORDER BY memory_type
  `;

  const configured = new Map(rows.map((r) => [r.memory_type, r]));

  // Merge built-in defaults for types not yet explicitly configured
  const allTypes: MemoryType[] = ["episodic", "semantic", "procedural", "context"];
  return allTypes.map((t) => {
    if (configured.has(t)) {
      const r = configured.get(t)!;
      return {
        workspaceId: r.workspace_id,
        memoryType: r.memory_type as MemoryType,
        defaultTtlSeconds: r.default_ttl_seconds,
        autoConsolidate: r.auto_consolidate,
        consolidationMode: r.consolidation_mode,
        maxMemories: r.max_memories,
        importanceFloor: r.importance_floor,
        decayModel: r.decay_model,
        halfLifeHours: r.half_life_hours,
        allowBoost: r.allow_boost,
        searchWeight: r.search_weight,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    }
    return {
      workspaceId,
      memoryType: t,
      ...TYPE_DEFAULTS[t],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });
}

export async function deleteMemoryTypeConfig(
  sql: Sql,
  workspaceId: string,
  memoryType: MemoryType,
): Promise<void> {
  await sql`
    DELETE FROM memory.memory_type_configs
    WHERE workspace_id = ${workspaceId} AND memory_type = ${memoryType}
  `;
}

/**
 * List distinct namespaces used by collections in a workspace.
 */
export async function getNamespaces(
  sql: Sql,
  workspaceId: string,
): Promise<string[]> {
  const rows = await sql<{ namespace: string }[]>`
    SELECT DISTINCT namespace FROM memory.collections
    WHERE workspace_id = ${workspaceId}
    ORDER BY namespace
  `;
  return rows.map((r) => r.namespace);
}

/**
 * Get memory counts per type for a workspace (optionally filtered by namespace).
 */
export async function getMemoryTypeBreakdown(
  sql: Sql,
  workspaceId: string,
  namespace?: string,
): Promise<Record<MemoryType, number>> {
  let rows: any[];
  if (namespace) {
    rows = await sql.unsafe(`
      SELECT m.memory_type, COUNT(m.id) as count
      FROM memory.memories m
      JOIN memory.collections c ON m.collection_id = c.id
      WHERE m.workspace_id = $1 AND c.namespace = $2
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
      GROUP BY m.memory_type
    `, [workspaceId, namespace]) as any[];
  } else {
    rows = await sql.unsafe(`
      SELECT memory_type, COUNT(id) as count
      FROM memory.memories
      WHERE workspace_id = $1
        AND (expires_at IS NULL OR expires_at > NOW())
      GROUP BY memory_type
    `, [workspaceId]) as any[];
  }

  const breakdown: Record<MemoryType, number> = {
    episodic: 0,
    semantic: 0,
    procedural: 0,
    context: 0,
  };
  for (const row of rows) {
    breakdown[row.memory_type as MemoryType] = Number(row.count);
  }
  return breakdown;
}

/**
 * Get all memories of a specific type in a workspace.
 */
export async function getMemoriesByType(
  sql: Sql,
  workspaceId: string,
  memoryType: MemoryType,
  opts: { limit?: number; offset?: number; collectionId?: string } = {},
): Promise<any[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  if (opts.collectionId) {
    return sql`
      SELECT * FROM memory.memories
      WHERE workspace_id = ${workspaceId}
        AND memory_type = ${memoryType}
        AND collection_id = ${opts.collectionId}
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
  }
  return sql`
    SELECT * FROM memory.memories
    WHERE workspace_id = ${workspaceId}
      AND memory_type = ${memoryType}
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

/**
 * Set an explicit expires_at timestamp on a memory (ignores ttl_seconds).
 */
export async function setMemoryExpiry(
  sql: Sql,
  memoryId: string,
  expiresAt: Date,
): Promise<any | null> {
  const [mem] = await sql`
    UPDATE memory.memories
    SET expires_at = ${expiresAt}, ttl_seconds = 0, updated_at = NOW()
    WHERE id = ${memoryId}
    RETURNING *
  `;
  return mem ?? null;
}

/**
 * Clear the expiry on a memory (make it non-expiring).
 */
export async function clearMemoryExpiry(
  sql: Sql,
  memoryId: string,
): Promise<any | null> {
  const [mem] = await sql`
    UPDATE memory.memories
    SET expires_at = NULL, ttl_seconds = 0, updated_at = NOW()
    WHERE id = ${memoryId}
    RETURNING *
  `;
  return mem ?? null;
}

/**
 * Get memories expiring within the next N seconds for a workspace.
 */
export async function getExpiringMemories(
  sql: Sql,
  workspaceId: string,
  withinSeconds = 3600,
): Promise<any[]> {
  return sql`
    SELECT * FROM memory.memories
    WHERE workspace_id = ${workspaceId}
      AND is_pinned = false
      AND expires_at IS NOT NULL
      AND expires_at <= NOW() + (${withinSeconds} || ' seconds')::interval
      AND expires_at > NOW()
    ORDER BY expires_at ASC
  `;
}

/**
 * Count memories by TTL status for a workspace.
 */
export async function getTTLStats(
  sql: Sql,
  workspaceId: string,
): Promise<{
  no_ttl: number;
  with_ttl: number;
  expired: number;
  expiring_soon: number;
  pinned: number;
}> {
  const [row] = await sql<any[]>`
    SELECT
      COUNT(*) FILTER (WHERE ttl_seconds = 0 AND expires_at IS NULL) AS no_ttl,
      COUNT(*) FILTER (WHERE ttl_seconds > 0 OR expires_at IS NOT NULL) AS with_ttl,
      COUNT(*) FILTER (WHERE expires_at < NOW()) AS expired,
      COUNT(*) FILTER (WHERE expires_at > NOW() AND expires_at <= NOW() + INTERVAL '1 day') AS expiring_soon,
      COUNT(*) FILTER (WHERE is_pinned = true) AS pinned
    FROM memory.memories
    WHERE workspace_id = ${workspaceId}
  `;
  return {
    no_ttl: Number(row.no_ttl),
    with_ttl: Number(row.with_ttl),
    expired: Number(row.expired),
    expiring_soon: Number(row.expiring_soon),
    pinned: Number(row.pinned),
  };
}

/**
 * Get a breakdown of all memory types in a workspace with storage size estimates.
 */
export async function getMemoryTypeBreakdown(
  sql: Sql,
  workspaceId: string,
): Promise<Array<{
  memory_type: string;
  count: number;
  avg_importance: number;
  avg_ttl_seconds: number | null;
  pinned_count: number;
  total_content_chars: number;
  oldest_memory: string | null;
  newest_memory: string | null;
}>> {
  return sql.unsafe(`
    SELECT
      m.memory_type,
      COUNT(*)::int AS count,
      AVG(m.importance)::float AS avg_importance,
      AVG(m.ttl_seconds) AS avg_ttl_seconds,
      COUNT(*) FILTER (WHERE m.is_pinned = true)::int AS pinned_count,
      SUM(LENGTH(m.content))::int AS total_content_chars,
      MIN(m.created_at)::text AS oldest_memory,
      MAX(m.created_at)::text AS newest_memory
    FROM memory.memories m
    WHERE m.workspace_id = $1
    GROUP BY m.memory_type
    ORDER BY count DESC
  `, [workspaceId]) as any[];
}

/**
 * Suggest a memory type for a given content sample based on its characteristics.
 * This is a heuristic helper — inspects content length, structure, and keywords.
 */
export function suggestMemoryType(content: string, metadata?: Record<string, any>): MemoryType {
  const lower = content.toLowerCase();
  const wordCount = content.split(/\s+/).length;

  // Procedural indicators
  if (/\b(function|procedure|algorithm|step|instruction|how to|recipe|formula)\b/.test(lower)) {
    return "procedural";
  }

  // Context indicators — very short, ephemeral
  if (wordCount < 30 || (metadata?.["transient"] === true)) {
    return "context";
  }

  // Episodic indicators — first person, time references, event descriptions
  if (/\b(yesterday|last week|remember|when I|at the meeting|event|happened|experienced)\b/.test(lower)) {
    return "episodic";
  }

  // Semantic — factual, definitional, long-form knowledge
  if (wordCount > 100 || /\b(knowledge|fact|concept|definition|theory|principle)\b/.test(lower)) {
    return "semantic";
  }

  // Default to semantic (general-purpose)
  return "semantic";
}

/**
 * Migrate all memories of one type to another type (bulk type reassignment).
 * Useful when workspace settings change and you want to reclassify existing memories.
 * Returns count of migrated memories.
 */
export async function migrateMemoryType(
  sql: Sql,
  workspaceId: string,
  fromType: MemoryType,
  toType: MemoryType,
): Promise<number> {
  const result = await sql.unsafe(`
    UPDATE memory.memories
    SET memory_type = $3, updated_at = NOW()
    WHERE workspace_id = $1 AND memory_type = $2
    RETURNING id
  `, [workspaceId, fromType, toType]);
  return result.count ?? 0;
}
