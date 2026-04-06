/**
 * Knowledge conflict detection — identify contradictory facts
 * across different sources in the knowledge base.
 */

import type { Sql } from "postgres";

export interface ConflictReport {
  workspace_id: string;
  entity_id: string;
  entity_name: string;
  conflicts: KnowledgeConflict[];
  total_conflicts: number;
  severity: "high" | "medium" | "low";
}

export interface KnowledgeConflict {
  type: "value_mismatch" | "contradiction" | "outdated" | "ambiguous";
  field: string;
  conflicting_values: ConflictingValue[];
  resolution_hint?: string;
}

export interface ConflictingValue {
  content: string;
  source_id: string;
  source_name: string;
  confidence: number;
  extracted_at: string;
}

/**
 * Detect conflicts for a specific entity across all its knowledge entries.
 */
export async function detectEntityConflicts(
  sql: Sql,
  entityId: string,
  workspaceId: string,
): Promise<ConflictReport> {
  // Get all knowledge entries for this entity
  const entries = await sql<{
    id: string;
    content: string;
    metadata: Record<string, unknown>;
    source_id: string;
    source_name: string;
    confidence: number;
    created_at: string;
  }[]>`
    SELECT
      k.id,
      k.content,
      k.metadata,
      k.source_id,
      COALESCE(s.name, 'unknown') as source_name,
      k.confidence,
      k.created_at::text
    FROM knowledge.knowledge k
    LEFT JOIN knowledge.sources s ON k.source_id = s.id
    WHERE k.entity_id = ${entityId}
      AND k.workspace_id = ${workspaceId}
      AND k.is_deleted = false
  `;

  if (entries.length < 2) {
    return {
      workspace_id: workspaceId,
      entity_id: entityId,
      entity_name: entries[0]?.metadata?.name as string ?? entityId,
      conflicts: [],
      total_conflicts: 0,
      severity: "low",
    };
  }

  const conflicts: KnowledgeConflict[] = [];

  // Group by field/triple pattern
  const fieldGroups = new Map<string, ConflictingValue[]>();

  for (const entry of entries) {
    const field = (entry.metadata?.field as string) ?? "unknown";
    if (!fieldGroups.has(field)) {
      fieldGroups.set(field, []);
    }
    fieldGroups.get(field)!.push({
      content: entry.content,
      source_id: entry.source_id,
      source_name: entry.source_name,
      confidence: entry.confidence,
      extracted_at: entry.created_at,
    });
  }

  // Detect value mismatches
  for (const [field, values] of fieldGroups) {
    if (values.length < 2) continue;

    // Check for exact duplicates (not conflicts)
    const uniqueValues = new Set(values.map(v => v.content.toLowerCase().trim()));
    if (uniqueValues.size === 1) continue;

    // Check for numeric conflicts
    const numericValues = values.filter(v => !isNaN(Number(v.content)));
    if (numericValues.length >= 2) {
      const nums = numericValues.map(v => Number(v.content));
      const allSame = nums.every(n => n === nums[0]);
      if (!allSame) {
        conflicts.push({
          type: "value_mismatch",
          field,
          conflicting_values: numericValues,
          resolution_hint: "Verify source reliability and recency",
        });
        continue;
      }
    }

    // Check for contradictory claims
    const contradictions = detectContradictions(values);
    if (contradictions.length > 0) {
      conflicts.push({
        type: "contradiction",
        field,
        conflicting_values: contradictions,
        resolution_hint: "Cross-reference authoritative sources",
      });
    }

    // Check for outdated information
    const outdated = detectOutdatedValues(values);
    if (outdated.length > 0) {
      conflicts.push({
        type: "outdated",
        field,
        conflicting_values: outdated,
        resolution_hint: "Update with latest verified information",
      });
    }
  }

  const severity = conflicts.length > 3 ? "high" : conflicts.length > 0 ? "medium" : "low";

  return {
    workspace_id: workspaceId,
    entity_id: entityId,
    entity_name: entries[0]?.metadata?.name as string ?? entityId,
    conflicts,
    total_conflicts: conflicts.length,
    severity,
  };
}

/**
 * Run conflict detection across all entities in a workspace.
 */
export async function scanWorkspaceConflicts(
  sql: Sql,
  workspaceId: string,
  limit = 50,
): Promise<ConflictReport[]> {
  // Get entities with multiple knowledge entries
  const entities = await sql<{ entity_id: string }[]>`
    SELECT entity_id
    FROM knowledge.knowledge
    WHERE workspace_id = ${workspaceId}
      AND is_deleted = false
    GROUP BY entity_id
    HAVING COUNT(*) > 1
    LIMIT ${limit}
  `;

  const reports: ConflictReport[] = [];

  for (const { entity_id } of entities) {
    const report = await detectEntityConflicts(sql, entity_id, workspaceId);
    if (report.conflicts.length > 0) {
      reports.push(report);
    }
  }

  return reports;
}

/**
 * Get conflict statistics for a workspace.
 */
export async function getConflictStats(
  sql: Sql,
  workspaceId: string,
): Promise<{ total_entities: number; entities_with_conflicts: number; total_conflicts: number; by_severity: { high: number; medium: number; low: number } }> {
  const [stats] = await sql<[{ total: string; with_conflicts: string }]>`
    SELECT
      COUNT(DISTINCT entity_id)::text as total,
      COUNT(DISTINCT CASE WHEN conflict_count > 0 THEN entity_id END)::text as with_conflicts
    FROM (
      SELECT entity_id, COUNT(*) as conflict_count
      FROM knowledge.knowledge
      WHERE workspace_id = ${workspaceId} AND is_deleted = false
      GROUP BY entity_id
      HAVING COUNT(*) > 1
    ) sub
  `;

  const reports = await scanWorkspaceConflicts(sql, workspaceId, 10000);

  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const report of reports) {
    bySeverity[report.severity]++;
  }

  return {
    total_entities: Number(stats.total),
    entities_with_conflicts: Number(stats.with_conflicts),
    total_conflicts: reports.reduce((sum, r) => sum + r.total_conflicts, 0),
    by_severity: bySeverity,
  };
}

function detectContradictions(values: ConflictingValue[]): ConflictingValue[] {
  const contradictions: ConflictingValue[] = [];

  // Simple keyword-based contradiction detection
  const positive = ["yes", "true", "correct", "enabled", "active", "supports", "includes"];
  const negative = ["no", "false", "incorrect", "disabled", "inactive", "rejects", "excludes"];

  for (const value of values) {
    const lower = value.content.toLowerCase();
    const hasPositive = positive.some(p => lower.includes(p));
    const hasNegative = negative.some(n => lower.includes(n));

    if (hasPositive && hasNegative) {
      contradictions.push(value);
    } else if (hasPositive && values.some(v => {
      if (v === value) return false;
      const vLower = v.content.toLowerCase();
      return negative.some(n => vLower.includes(n));
    })) {
      contradictions.push(value);
    }
  }

  return contradictions;
}

function detectOutdatedValues(values: ConflictingValue[]): ConflictingValue[] {
  // Find entries significantly older than the newest
  const sorted = [...values].sort((a, b) =>
    new Date(a.extracted_at).getTime() - new Date(b.extracted_at).getTime()
  );

  if (sorted.length < 2) return [];

  const newest = sorted[sorted.length - 1];
  const newestTime = new Date(newest.extracted_at).getTime();

  const outdated: ConflictingValue[] = [];
  for (const value of sorted) {
    const age = newestTime - new Date(value.extracted_at).getTime();
    const dayInMs = 24 * 60 * 60 * 1000;
    // Consider outdated if more than 30 days older than newest
    if (age > 30 * dayInMs && value.confidence < newest.confidence) {
      outdated.push(value);
    }
  }

  return outdated;
}