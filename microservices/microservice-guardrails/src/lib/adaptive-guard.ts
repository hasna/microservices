/**
 * Adaptive guard — dynamically adjusts check strictness based on
 * per-client and per-workspace violation history.
 *
 * Learns from recent violations to increase or decrease:
 * - PII redaction aggressiveness
 * - Injection detection sensitivity
 * - Whether to block vs warn on marginal matches
 */

import type { Sql } from "postgres";

export type StrictnessLevel = "relaxed" | "normal" | "strict" | "paranoid";

export interface AdaptiveConfig {
  /** Default strictness when no history exists */
  defaultLevel: StrictnessLevel;
  /** Violation weight per severity */
  severityWeights: Record<string, number>;
  /** Window in days for evaluating violation history */
  lookbackDays: number;
  /** Score thresholds per strictness level */
  thresholds: Record<StrictnessLevel, number>;
}

const DEFAULT_CONFIG: AdaptiveConfig = {
  defaultLevel: "normal",
  severityWeights: { low: 1, medium: 3, high: 7, critical: 15 },
  lookbackDays: 7,
  thresholds: {
    relaxed: 50,
    normal: 20,
    strict: 5,
    paranoid: 0,
  },
};

export interface AdaptiveState {
  level: StrictnessLevel;
  score: number;
  violationsLast7Days: number;
  lastViolationAt: Date | null;
  blockRate7Days: number;
}

/**
 * Get the current adaptive state for a workspace.
 */
export async function getAdaptiveState(
  sql: Sql,
  workspaceId: string,
): Promise<AdaptiveState> {
  const lookback = new Date(Date.now() - DEFAULT_CONFIG.lookbackDays * 86400 * 1000);

  const rows = await sql<{
    severity: string;
    result: string;
    count: string;
  }[]>`
    SELECT severity, result, COUNT(*) as count
    FROM guardrails.violations
    WHERE workspace_id = ${workspaceId}
      AND created_at > ${lookback}
    GROUP BY severity, result
  `;

  const totalRows = await sql<{ total: string }[]>`
    SELECT COUNT(*) as total
    FROM guardrails.violations
    WHERE workspace_id = ${workspaceId}
      AND created_at > ${lookback}
  `;

  const blockRows = await sql<{ total: string }[]>`
    SELECT COUNT(*) as total
    FROM guardrails.violations
    WHERE workspace_id = ${workspaceId}
      AND created_at > ${lookback}
      AND result IN ('block', 'sanitize')
  `;

  const totalCount = Number(totalRows[0]?.total ?? 0);
  const blockCount = Number(blockRows[0]?.total ?? 0);
  const blockRate = totalCount > 0 ? blockCount / totalCount : 0;

  let score = 0;
  for (const row of rows) {
    const weight = DEFAULT_CONFIG.severityWeights[row.severity] ?? 1;
    score += weight * Number(row.count);
  }

  const lastViolationRows = await sql<{ created_at: Date }[]>`
    SELECT created_at FROM guardrails.violations
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const level = computeStrictness(score, DEFAULT_CONFIG.thresholds);

  return {
    level,
    score,
    violationsLast7Days: totalCount,
    lastViolationAt: lastViolationRows[0]?.created_at ?? null,
    blockRate7Days: blockRate,
  };
}

function computeStrictness(
  score: number,
  thresholds: Record<StrictnessLevel, number>,
): StrictnessLevel {
  if (score <= thresholds.paranoid) return "paranoid";
  if (score <= thresholds.strict) return "strict";
  if (score <= thresholds.normal) return "normal";
  return "relaxed";
}

/**
 * Adjust the adaptive strictness level for a workspace by applying a delta.
 * Positive delta = stricter, negative = more relaxed.
 */
export async function adjustAdaptiveLevel(
  sql: Sql,
  workspaceId: string,
  direction: "up" | "down",
): Promise<{ newLevel: StrictnessLevel; reason: string }> {
  const state = await getAdaptiveState(sql, workspaceId);

  const levels: StrictnessLevel[] = ["relaxed", "normal", "strict", "paranoid"];
  const currentIdx = levels.indexOf(state.level);
  let newIdx = currentIdx;

  if (direction === "up" && currentIdx < levels.length - 1) {
    newIdx = currentIdx + 1;
  } else if (direction === "down" && currentIdx > 0) {
    newIdx = currentIdx - 1;
  }

  const newLevel = levels[newIdx]!;
  const reason = `Manual ${direction} adjustment from ${state.level} to ${newLevel} (score: ${state.score})`;

  await sql`
    INSERT INTO guardrails.adaptive_states (workspace_id, level, reason, score_at_adjustment)
    VALUES (${workspaceId}, ${newLevel}, ${reason}, ${state.score})
    ON CONFLICT (workspace_id) DO UPDATE
      SET level = EXCLUDED.level,
          reason = EXCLUDED.reason,
          score_at_adjustment = EXCLUDED.score_at_adjustment,
          updated_at = NOW()
  `;

  return { newLevel, reason };
}

/**
 * Apply adaptive strictness to a guard check result.
 * Adjusts the action: warn -> block when level is strict/paranoid.
 */
export function applyAdaptiveStrictness(
  state: AdaptiveState,
  violations: Array<{ severity: string; action: string }>,
): Array<{ severity: string; action: string; overridden: boolean }> {
  return violations.map((v) => {
    let overridden = false;
    let action = v.action;

    if (state.level === "strict" && v.action === "warn" && v.severity === "high") {
      action = "block";
      overridden = true;
    } else if (state.level === "paranoid" && v.action !== "block") {
      if (v.action === "warn" || v.action === "redact") {
        action = "block";
        overridden = true;
      }
    } else if (state.level === "relaxed" && v.action === "block") {
      action = "warn";
      overridden = true;
    }

    return { severity: v.severity, action, overridden };
  });
}
