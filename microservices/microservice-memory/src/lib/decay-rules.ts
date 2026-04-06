/**
 * Decay rules — configurable importance decay for memories per namespace or memory type.
 * Allows different decay rates for episodic (fast decay) vs semantic (slow decay) memories.
 */

import type { Sql } from "postgres";

export type DecayModel = "linear" | "exponential" | "logarithmic";

export interface DecayRule {
  id: string;
  workspaceId: string;
  namespace: string; // empty = default for all namespaces
  memoryType: string; // empty = default for all types
  decayModel: DecayModel;
  initialHalfLifeHours: number; // hours until importance drops to 50%
  minImportance: number; // floor value importance can decay to
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ComputeDecayedImportanceResult {
  originalImportance: number;
  decayedImportance: number;
  ageHours: number;
  decayApplied: boolean;
  ruleId: string | null;
}

export async function upsertDecayRule(
  sql: Sql,
  opts: {
    workspaceId: string;
    namespace?: string;
    memoryType?: string;
    decayModel?: DecayModel;
    initialHalfLifeHours?: number;
    minImportance?: number;
    enabled?: boolean;
  },
): Promise<DecayRule> {
  const [rule] = await sql<DecayRule[]>`
    INSERT INTO memory.decay_rules (
      workspace_id, namespace, memory_type,
      decay_model, initial_half_life_hours, min_importance, enabled
    )
    VALUES (
      ${opts.workspaceId},
      ${opts.namespace ?? ""},
      ${opts.memoryType ?? ""},
      ${opts.decayModel ?? "exponential"},
      ${opts.initialHalfLifeHours ?? 168},
      ${opts.minImportance ?? 0.1},
      ${opts.enabled ?? true}
    )
    ON CONFLICT (workspace_id, namespace, memory_type)
    WHERE namespace != '' AND memory_type != ''
    DO UPDATE SET
      decay_model = EXCLUDED.decay_model,
      initial_half_life_hours = EXCLUDED.initial_half_life_hours,
      min_importance = EXCLUDED.min_importance,
      enabled = EXCLUDED.enabled,
      updated_at = NOW()
    RETURNING *
  `;

  return {
    id: rule.id,
    workspaceId: rule.workspace_id,
    namespace: rule.namespace,
    memoryType: rule.memory_type,
    decayModel: rule.decay_model as DecayModel,
    initialHalfLifeHours: rule.initial_half_life_hours,
    minImportance: rule.min_importance,
    enabled: rule.enabled,
    createdAt: rule.created_at,
    updatedAt: rule.updated_at,
  };
}

export async function getDecayRule(
  sql: Sql,
  workspaceId: string,
  namespace?: string,
  memoryType?: string,
): Promise<DecayRule | null> {
  // Try exact match first
  const [exact] = await sql<DecayRule[]>`
    SELECT * FROM memory.decay_rules
    WHERE workspace_id = ${workspaceId}
      AND namespace = ${namespace ?? ""}
      AND memory_type = ${memoryType ?? ""}
  `;

  if (exact) return formatRule(exact);

  // Fall back to namespace default
  if (memoryType) {
    const [ns] = await sql<DecayRule[]>`
      SELECT * FROM memory.decay_rules
      WHERE workspace_id = ${workspaceId}
        AND namespace = ${namespace ?? ""}
        AND memory_type = ''
    `;
    if (ns) return formatRule(ns);
  }

  // Fall back to type default
  if (namespace) {
    const [mt] = await sql<DecayRule[]>`
      SELECT * FROM memory.decay_rules
      WHERE workspace_id = ${workspaceId}
        AND namespace = ''
        AND memory_type = ${memoryType ?? ""}
    `;
    if (mt) return formatRule(mt);
  }

  // Global default
  const [global] = await sql<DecayRule[]>`
    SELECT * FROM memory.decay_rules
    WHERE workspace_id = ${workspaceId}
      AND namespace = ''
      AND memory_type = ''
  `;

  return global ? formatRule(global) : null;
}

export async function computeDecayedImportance(
  sql: Sql,
  opts: {
    memoryId: string;
    currentImportance: number;
    createdAt: Date;
    namespace?: string;
    memoryType?: string;
  },
): Promise<ComputeDecayedImportanceResult> {
  const rule = await getDecayRule(
    sql,
    opts.memoryId, // will use workspace from a join below
    opts.namespace,
    opts.memoryType,
  );

  // If no rule or disabled, no decay
  if (!rule || !rule.enabled) {
    return {
      originalImportance: opts.currentImportance,
      decayedImportance: opts.currentImportance,
      ageHours: 0,
      decayApplied: false,
      ruleId: null,
    };
  }

  const ageMs = Date.now() - opts.createdAt.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  const { decayedImportance } = applyDecay(
    opts.currentImportance,
    ageHours,
    rule.decayModel,
    rule.initialHalfLifeHours,
    rule.minImportance,
  );

  return {
    originalImportance: opts.currentImportance,
    decayedImportance,
    ageHours,
    decayApplied: decayedImportance < opts.currentImportance,
    ruleId: rule.id,
  };
}

export async function listDecayRules(
  sql: Sql,
  workspaceId: string,
): Promise<DecayRule[]> {
  const rows = await sql<DecayRule[]>`
    SELECT * FROM memory.decay_rules
    WHERE workspace_id = ${workspaceId}
    ORDER BY namespace, memory_type
  `;
  return rows.map(formatRule);
}

export async function deleteDecayRule(
  sql: Sql,
  id: string,
  workspaceId: string,
): Promise<void> {
  await sql`
    DELETE FROM memory.decay_rules
    WHERE id = ${id} AND workspace_id = ${workspaceId}
  `;
}

// ---- Internal helpers ----

function applyDecay(
  importance: number,
  ageHours: number,
  model: DecayModel,
  halfLifeHours: number,
  minImportance: number,
): { decayedImportance: number } {
  // Normalized decay rate constant k such that importance(t) = importance_0 * e^(-kt)
  // At t=halfLife, importance = importance_0 / 2 => e^(-k*halfLife) = 0.5 => k = ln(2)/halfLife
  const k = Math.LN2 / halfLifeHours;

  let decayed: number;
  switch (model) {
    case "linear":
      decayed = importance - (ageHours / halfLifeHours) * (importance - minImportance);
      break;
    case "logarithmic":
      decayed = importance - Math.log1p(ageHours) / Math.log1p(halfLifeHours) * (importance - minImportance);
      break;
    case "exponential":
    default:
      decayed = importance * Math.exp(-k * ageHours);
      break;
  }

  return { decayedImportance: Math.max(decayed, minImportance) };
}

function formatRule(r: any): DecayRule {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    namespace: r.namespace,
    memoryType: r.memory_type,
    decayModel: r.decay_model as DecayModel,
    initialHalfLifeHours: r.initial_half_life_hours,
    minImportance: r.min_importance,
    enabled: r.enabled,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
