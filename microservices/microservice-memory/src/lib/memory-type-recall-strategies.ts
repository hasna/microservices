/**
 * Memory-type recall strategies — blend retrieval results based on
 * memory type (episodic/semantic/procedural/context) using type-specific
 * weighting, boosting, and decay functions.
 *
 * Each memory type has different retrieval characteristics:
 * - episodic: recency-weighted (recent = more relevant), importance-weighted
 * - semantic: importance-weighted (high importance = more relevant), stable
 * - procedural: exact match preferred (usually retrieved by name/pattern)
 * - context: recency-weighted (ephemeral, use soon or lose it)
 */

import type { Sql } from "postgres";

export type MemoryType = "episodic" | "semantic" | "procedural" | "context";

export interface RecallStrategy {
  type: MemoryType;
  recencyWeight: number; // 0-1, how much recency affects score
  importanceWeight: number; // 0-1, how much importance affects score
  linkWeight: number; // 0-1, how much incoming links boost score
  accessFrequencyWeight: number; // 0-1, how much access frequency boosts score
  minImportanceFloor: number; // discard memories below this importance
  decayModel: "none" | "linear" | "exponential" | "logarithmic";
  decayHalfLifeHours: number | null; // for exponential/logarithmic decay
  boostNewMemories: boolean; // boost newly created memories
  boostNewMemoryHours: number; // how many hours "new" means
  boostNewMemoryMultiplier: number; // how much to boost new memories
}

export const DEFAULT_STRATEGIES: Record<MemoryType, RecallStrategy> = {
  episodic: {
    type: "episodic",
    recencyWeight: 0.6,
    importanceWeight: 0.3,
    linkWeight: 0.1,
    accessFrequencyWeight: 0.0,
    minImportanceFloor: 0.1,
    decayModel: "exponential",
    decayHalfLifeHours: 72, // importance halves every 3 days
    boostNewMemories: true,
    boostNewMemoryHours: 2,
    boostNewMemoryMultiplier: 1.3,
  },
  semantic: {
    type: "semantic",
    recencyWeight: 0.1,
    importanceWeight: 0.7,
    linkWeight: 0.2,
    accessFrequencyWeight: 0.0,
    minImportanceFloor: 0.2,
    decayModel: "logarithmic",
    decayHalfLifeHours: 8760, // ~1 year
    boostNewMemories: false,
    boostNewMemoryHours: 0,
    boostNewMemoryMultiplier: 1.0,
  },
  procedural: {
    type: "procedural",
    recencyWeight: 0.0,
    importanceWeight: 0.5,
    linkWeight: 0.3,
    accessFrequencyWeight: 0.2,
    minImportanceFloor: 0.3,
    decayModel: "none",
    decayHalfLifeHours: null,
    boostNewMemories: false,
    boostNewMemoryHours: 0,
    boostNewMemoryMultiplier: 1.0,
  },
  context: {
    type: "context",
    recencyWeight: 0.9,
    importanceWeight: 0.1,
    linkWeight: 0.0,
    accessFrequencyWeight: 0.0,
    minImportanceFloor: 0.05,
    decayModel: "linear",
    decayHalfLifeHours: 1, // very fast decay
    boostNewMemories: true,
    boostNewMemoryHours: 0.5,
    boostNewMemoryMultiplier: 1.5,
  },
};

export interface ScoredMemory {
  id: string;
  content: string;
  summary: string | null;
  memoryType: MemoryType;
  importance: number;
  createdAt: Date;
  expiresAt: Date | null;
  accessCount: number;
  incomingLinkCount: number;
  baseScore: number;
  recencyScore: number;
  importanceScore: number;
  linkScore: number;
  accessScore: number;
  finalScore: number;
  appliedStrategy: MemoryType;
}

export interface RecallOptions {
  workspaceId: string;
  query?: string;
  memoryTypes?: MemoryType[];
  limit?: number;
  namespace?: string;
  collectionId?: string;
  minImportance?: number;
  strategies?: Partial<Record<MemoryType, RecallStrategy>>;
}

/**
 * Compute recency score using exponential decay.
 */
function computeRecencyScore(createdAt: Date, strategy: RecallStrategy): number {
  const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

  if (strategy.decayModel === "none") return 1.0;
  if (strategy.decayModel === "linear") {
    if (!strategy.decayHalfLifeHours) return 1.0;
    return Math.max(0, 1 - ageHours / (strategy.decayHalfLifeHours * 2));
  }
  if (strategy.decayModel === "exponential") {
    if (!strategy.decayHalfLifeHours) return 1.0;
    return Math.pow(0.5, ageHours / strategy.decayHalfLifeHours);
  }
  if (strategy.decayModel === "logarithmic") {
    if (!strategy.decayHalfLifeHours) return 1.0;
    const maxAge = strategy.decayHalfLifeHours * 2;
    return Math.max(0.1, 1 - Math.log10(1 + ageHours / maxAge) / Math.log10(2));
  }
  return 1.0;
}

/**
 * Compute importance score — importance is already 0-1, use directly.
 */
function computeImportanceScore(importance: number): number {
  return Math.max(0, Math.min(1, importance));
}

/**
 * Compute link score based on incoming links.
 */
function computeLinkScore(incomingLinkCount: number): number {
  // Diminishing returns: 1 link = 0.3, 5 links = 0.8, 10+ links = 1.0
  return Math.min(1, 1 - Math.pow(0.5, incomingLinkCount + 1) * 2);
}

/**
 * Compute access frequency score.
 */
function computeAccessScore(accessCount: number): number {
  // Logarithmic: more accesses = higher score but with diminishing returns
  if (accessCount === 0) return 0;
  return Math.min(1, Math.log10(accessCount + 1) / Math.log10(100));
}

/**
 * Boost newly created memories.
 */
function applyNewMemoryBoost(createdAt: Date, strategy: RecallStrategy): number {
  if (!strategy.boostNewMemories) return 1.0;
  const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  if (ageHours <= strategy.boostNewMemoryHours) {
    return strategy.boostNewMemoryMultiplier;
  }
  return 1.0;
}

/**
 * Recall memories using type-specific strategies — retrieves memories
 * and scores them using different weights based on memory type.
 */
export async function recallWithStrategies(
  sql: Sql,
  options: RecallOptions,
): Promise<ScoredMemory[]> {
  const strategy = options.strategies ?? DEFAULT_STRATEGIES;
  const types = options.memoryTypes ?? ["episodic", "semantic", "procedural", "context"];

  // Build query conditions
  const conditions: string[] = [`m.workspace_id = $1`];
  const params: any[] = [options.workspaceId];
  let paramIdx = 2;

  if (options.namespace) {
    conditions.push(`c.namespace = $${paramIdx++}`);
    params.push(options.namespace);
  }

  if (options.collectionId) {
    conditions.push(`m.collection_id = $${paramIdx++}`);
    params.push(options.collectionId);
  }

  if (options.minImportance !== undefined) {
    conditions.push(`m.importance >= $${paramIdx++}`);
    params.push(options.minImportance);
  }

  if (options.memoryTypes && options.memoryTypes.length > 0) {
    conditions.push(`m.memory_type = ANY($${paramIdx++}::text[])`);
    params.push(options.memoryTypes);
  }

  const whereClause = conditions.join(" AND ");

  // Fetch memories with access and link counts
  const rows = await sql.unsafe(`
    SELECT
      m.id,
      LEFT(m.content, 500) AS content,
      m.summary,
      m.memory_type,
      m.importance,
      m.created_at,
      m.expires_at,
      m.is_pinned,
      COALESCE(ac.access_count, 0)::int AS access_count,
      COALESCE(lc.incoming_link_count, 0)::int AS incoming_link_count
    FROM memory.memories m
    JOIN memory.collections c ON c.id = m.collection_id
    LEFT JOIN (
      SELECT memory_id, COUNT(*)::int AS access_count
      FROM memory.memory_access_log
      GROUP BY memory_id
    ) ac ON ac.memory_id = m.id
    LEFT JOIN (
      SELECT target_memory_id AS memory_id, COUNT(*)::int AS incoming_link_count
      FROM memory.memory_links
      GROUP BY target_memory_id
    ) lc ON lc.memory_id = m.id
    WHERE ${whereClause}
      AND (m.expires_at IS NULL OR m.expires_at > NOW())
      AND m.is_pinned = false
    ORDER BY m.created_at DESC
    LIMIT 1000
  `, params) as any[];

  // Score each memory by type-specific strategy
  const scored: ScoredMemory[] = [];

  for (const row of rows) {
    const memType = row.memory_type as MemoryType;
    const strat = { ...DEFAULT_STRATEGIES[memType], ...(strategy[memType] ?? {}) };

    // Filter by minimum importance floor
    if (row.importance < strat.minImportanceFloor) continue;

    const recencyScore = computeRecencyScore(row.created_at, strat);
    const importanceScore = computeImportanceScore(row.importance);
    const linkScore = computeLinkScore(row.incoming_link_count);
    const accessScore = computeAccessScore(row.access_count);
    const newBoost = applyNewMemoryBoost(row.created_at, strat);

    // Weighted combination
    const baseScore =
      strat.recencyWeight * recencyScore +
      strat.importanceWeight * importanceScore +
      strat.linkWeight * linkScore +
      strat.accessFrequencyWeight * accessScore;

    const finalScore = baseScore * newBoost;

    scored.push({
      id: row.id,
      content: row.content,
      summary: row.summary,
      memoryType: memType,
      importance: Number(row.importance),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      accessCount: row.access_count,
      incomingLinkCount: row.incoming_link_count,
      baseScore,
      recencyScore,
      importanceScore,
      linkScore,
      accessScore,
      finalScore,
      appliedStrategy: memType,
    });
  }

  // Sort by final score descending
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // Apply limit
  const limit = options.limit ?? 20;
  return scored.slice(0, limit);
}

/**
 * Get a breakdown of scores by memory type — useful for understanding
 * what types of memories are being recalled and how they're being scored.
 */
export async function getRecallBreakdown(
  sql: Sql,
  workspaceId: string,
  query?: string,
): Promise<{
  byType: Record<MemoryType, { count: number; avgScore: number; topScore: number }>;
  total: number;
}> {
  const results = await recallWithStrategies(sql, {
    workspaceId,
    query,
    limit: 1000,
  });

  const byType: Record<MemoryType, { count: number; avgScore: number; topScore: number }> = {
    episodic: { count: 0, avgScore: 0, topScore: 0 },
    semantic: { count: 0, avgScore: 0, topScore: 0 },
    procedural: { count: 0, avgScore: 0, topScore: 0 },
    context: { count: 0, avgScore: 0, topScore: 0 },
  };

  for (const m of results) {
    const t = byType[m.memoryType];
    t.count++;
    t.avgScore = (t.avgScore * (t.count - 1) + m.finalScore) / t.count;
    if (m.finalScore > t.topScore) t.topScore = m.finalScore;
  }

  return { byType, total: results.length };
}
