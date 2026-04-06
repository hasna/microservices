/**
 * Memory importance auto-tuning — analyze access patterns to suggest/adjust importance scores.
 */

import type { Sql } from "postgres";
import { getMemoryAccessFrequency } from "./access-tracks.js";

export interface ImportanceSuggestion {
  memory_id: string;
  current_importance: number;
  suggested_importance: number;
  reason: string;
  access_count_7d: number;
  access_count_30d: number;
  last_accessed: string | null;
  boost_applied: boolean;
}

export interface TuningReport {
  workspace_id: string;
  total_memories: number;
  suggestions: ImportanceSuggestion[];
  increased_count: number;
  decreased_count: number;
  unchanged_count: number;
  applied_count: number;
}

/**
 * Analyze access patterns and suggest importance adjustments for a workspace.
 */
export async function analyzeImportanceTuning(
  sql: Sql,
  workspaceId: string,
  lookbackDays = 30,
): Promise<TuningReport> {
  // Get all memories in workspace with their access counts
  const memories = await sql<{
    id: string;
    importance: number;
    content: string;
    created_at: Date;
  }[]>`
    SELECT m.id, m.importance, m.content, m.created_at
    FROM memory.memories m
    LEFT JOIN memory.namespaces n ON m.namespace_id = n.id
    WHERE n.workspace_id = ${workspaceId}
      AND m.is_archived = false
    LIMIT 500
  `;

  const suggestions: ImportanceSuggestion[] = [];
  let increasedCount = 0;
  let decreasedCount = 0;
  let unchangedCount = 0;

  for (const mem of memories) {
    const [access7d] = await sql<{ count: number }[]>`
      SELECT COUNT(*) as count FROM memory.memory_access_log
      WHERE memory_id = ${mem.id}
        AND accessed_at > NOW() - INTERVAL '7 days'
    `;
    const [access30d] = await sql<{ count: number }[]>`
      SELECT COUNT(*) as count FROM memory.memory_access_log
      WHERE memory_id = ${mem.id}
        AND accessed_at > NOW() - INTERVAL '30 days'
    `;
    const [lastAccess] = await sql<{ accessed_at: Date }[]>`
      SELECT accessed_at FROM memory.memory_access_log
      WHERE memory_id = ${mem.id}
      ORDER BY accessed_at DESC
      LIMIT 1
    `;

    const count7d = access7d?.count ?? 0;
    const count30d = access30d?.count ?? 0;

    // Compute suggested importance based on access frequency
    let suggested = mem.importance;
    let reason = "";

    // High access, low importance → boost
    if (count30d > 20 && mem.importance < 0.7) {
      suggested = Math.min(1.0, mem.importance + 0.2);
      reason = `High access (${count30d}x/30d) but low importance — boosting`;
      increasedCount++;
    } else if (count30d > 10 && mem.importance < 0.5) {
      suggested = Math.min(1.0, mem.importance + 0.1);
      reason = `Moderate access (${count30d}x/30d) — slight boost`;
      increasedCount++;
    } else if (count30d === 0 && mem.importance > 0.3) {
      // Never accessed but high importance → decay suggestion
      suggested = Math.max(0.0, mem.importance - 0.1);
      reason = "Never accessed in 30 days — consider lowering importance";
      decreasedCount++;
    } else if (count7d === 0 && count30d > 0 && mem.importance > 0.4) {
      // Accessed before but not recently
      suggested = Math.max(0.0, mem.importance - 0.05);
      reason = "Accessed in last 30d but not last 7d — slight decay";
      decreasedCount++;
    } else {
      reason = "Importance level appears appropriate";
      unchangedCount++;
    }

    suggestions.push({
      memory_id: mem.id,
      current_importance: mem.importance,
      suggested_importance: Math.round(suggested * 100) / 100,
      reason,
      access_count_7d: count7d,
      access_count_30d: count30d,
      last_accessed: lastAccess?.accessed_at?.toISOString() ?? null,
      boost_applied: false,
    });
  }

  return {
    workspace_id: workspaceId,
    total_memories: memories.length,
    suggestions,
    increased_count: increasedCount,
    decreased_count: decreasedCount,
    unchanged_count: unchangedCount,
    applied_count: 0,
  };
}

/**
 * Apply importance tuning suggestions to update memory scores.
 */
export async function applyImportanceTuning(
  sql: Sql,
  workspaceId: string,
  minDelta = 0.05,
): Promise<{ applied: number; unchanged: number }> {
  const report = await analyzeImportanceTuning(sql, workspaceId);
  let applied = 0;
  let unchanged = 0;

  for (const s of report.suggestions) {
    const delta = Math.abs(s.suggested_importance - s.current_importance);
    if (delta >= minDelta) {
      await sql`
        UPDATE memory.memories
        SET importance = ${s.suggested_importance}
        WHERE id = ${s.memory_id}
      `;
      applied++;
    } else {
      unchanged++;
    }
  }

  return { applied, unchanged };
}

/**
 * Get memories with the most improved importance scores.
 */
export async function getMostImprovedMemories(
  sql: Sql,
  workspaceId: string,
  limit = 20,
): Promise<Array<{
  memory_id: string;
  importance_delta: number;
  current_importance: number;
  access_count_30d: number;
}>> {
  const suggestions = await analyzeImportanceTuning(sql, workspaceId);
  return suggestions
    .filter((s) => s.suggested_importance > s.current_importance)
    .sort((a, b) => (b.suggested_importance - b.current_importance) - (a.suggested_importance - a.current_importance))
    .slice(0, limit)
    .map((s) => ({
      memory_id: s.memory_id,
      importance_delta: Math.round((s.suggested_importance - s.current_importance) * 100) / 100,
      current_importance: s.current_importance,
      access_count_30d: s.access_count_30d,
    }));
}
