/**
 * Flag evaluation engine — determines flag value for a given context.
 *
 * Evaluation order:
 * 1. Override for this specific user/workspace
 * 2. Rules (sorted by priority desc): percentage, user_list, attribute, plan
 * 3. Default value
 */

import type { Sql } from "postgres";

export interface EvalContext {
  userId?: string;
  workspaceId?: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface EvalResult {
  key: string;
  value: string;
  source: "override" | "rule" | "default" | "disabled";
  ruleId?: string;
}

export async function evaluateFlag(
  sql: Sql,
  key: string,
  ctx: EvalContext,
): Promise<EvalResult> {
  const [flag] = await sql<
    [{ id: string; default_value: string; enabled: boolean; type: string }]
  >`
    SELECT id, default_value, enabled, type FROM flags.flags WHERE key = ${key}`;
  if (!flag) throw new Error(`Flag '${key}' not found`);
  if (!flag.enabled)
    return { key, value: flag.default_value, source: "disabled" };

  // 1. Check overrides
  if (ctx.userId) {
    const [ov] = await sql<[{ value: string }]>`
      SELECT value FROM flags.overrides WHERE flag_id = ${flag.id} AND target_type = 'user' AND target_id = ${ctx.userId}`;
    if (ov) return { key, value: ov.value, source: "override" };
  }
  if (ctx.workspaceId) {
    const [ov] = await sql<[{ value: string }]>`
      SELECT value FROM flags.overrides WHERE flag_id = ${flag.id} AND target_type = 'workspace' AND target_id = ${ctx.workspaceId}`;
    if (ov) return { key, value: ov.value, source: "override" };
  }

  // 2. Evaluate rules by priority
  const rules = await sql<
    { id: string; type: string; config: any; value: string }[]
  >`
    SELECT id, type, config, value FROM flags.rules
    WHERE flag_id = ${flag.id} AND enabled = true ORDER BY priority DESC`;

  for (const rule of rules) {
    const match = evaluateRule(rule, ctx);
    if (match)
      return { key, value: rule.value, source: "rule", ruleId: rule.id };
  }

  // 3. Default
  return { key, value: flag.default_value, source: "default" };
}

function evaluateRule(
  rule: { type: string; config: any },
  ctx: EvalContext,
): boolean {
  switch (rule.type) {
    case "user_list": {
      const users = (rule.config.users as string[]) ?? [];
      return ctx.userId ? users.includes(ctx.userId) : false;
    }
    case "percentage": {
      const pct = (rule.config.percentage as number) ?? 0;
      if (!ctx.userId) return false;
      // Deterministic hash of userId for consistent assignment
      const hash = simpleHash(ctx.userId);
      return hash % 100 < pct;
    }
    case "attribute": {
      const attr = rule.config.attribute as string;
      const op = rule.config.operator as string;
      const expected = rule.config.value;
      const actual = ctx.attributes?.[attr];
      if (actual === undefined) return false;
      if (op === "eq") return String(actual) === String(expected);
      if (op === "neq") return String(actual) !== String(expected);
      if (op === "contains") return String(actual).includes(String(expected));
      if (op === "gt") return Number(actual) > Number(expected);
      if (op === "lt") return Number(actual) < Number(expected);
      return false;
    }
    case "plan": {
      const plans = (rule.config.plans as string[]) ?? [];
      const userPlan = ctx.attributes?.plan as string | undefined;
      return userPlan ? plans.includes(userPlan) : false;
    }
    default:
      return false;
  }
}

/** Simple deterministic hash for consistent percentage rollouts */
function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export async function evaluateAllFlags(
  sql: Sql,
  workspaceId: string | undefined,
  ctx: EvalContext,
): Promise<Record<string, EvalResult>> {
  const flags = await sql<{ key: string }[]>`
    SELECT key FROM flags.flags WHERE enabled = true AND (workspace_id IS NULL OR workspace_id = ${workspaceId ?? null})`;
  const results: Record<string, EvalResult> = {};
  await Promise.all(
    flags.map(async (f) => {
      try {
        results[f.key] = await evaluateFlag(sql, f.key, ctx);
      } catch {}
    }),
  );
  return results;
}
