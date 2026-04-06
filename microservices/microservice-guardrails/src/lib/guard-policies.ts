/**
 * Rule composition — supports AND, OR, NOT groupings of rules.
 *
 * rule_groups table: named groups that combine multiple rules via logical operators.
 * Composite rules are evaluated by recursively evaluating each sub-rule
 * and combining results according to the group's operator.
 */

import type { Sql } from "postgres";
import { evaluateDSLRule } from "./dsl-rules.js";
import { listGuardRules } from "./dsl-rules.js";
import type { GuardRule, DSLResult } from "./dsl-rules.js";

export type RuleOperator = "AND" | "OR" | "NOT";

export interface RuleGroup {
  id: string;
  name: string;
  operator: RuleOperator;
  rule_ids: string[]; // IDs of rules in this group
  negate: boolean; // Apply NOT to the whole group result
  enabled: boolean;
  created_at: Date;
}

export interface EvaluateGroupResult {
  matched: boolean;
  operator: RuleOperator;
  negate: boolean;
  sub_results: Array<{
    rule: GuardRule;
    result: DSLResult;
  }>;
  group_name: string;
}

/**
 * Get a rule group by ID.
 */
export async function getRuleGroup(
  sql: Sql,
  id: string,
): Promise<RuleGroup | null> {
  const [row] = await sql<any[]>`
    SELECT * FROM guardrails.rule_groups WHERE id = ${id}
  `;
  return row ? formatGroup(row) : null;
}

/**
 * List all rule groups, optionally filtered by enabled status.
 */
export async function listRuleGroups(
  sql: Sql,
  opts?: { enabled?: boolean },
): Promise<RuleGroup[]> {
  if (opts?.enabled !== undefined) {
    const rows = await sql<any[]>`
      SELECT * FROM guardrails.rule_groups
      WHERE enabled = ${opts.enabled}
      ORDER BY name ASC
    `;
    return rows.map(formatGroup);
  }
  const rows = await sql<any[]>`
    SELECT * FROM guardrails.rule_groups ORDER BY name ASC
  `;
  return rows.map(formatGroup);
}

/**
 * Create a new rule group with AND/OR/NOT composition.
 */
export async function createRuleGroup(
  sql: Sql,
  input: {
    name: string;
    operator: RuleOperator;
    rule_ids: string[];
    negate?: boolean;
    enabled?: boolean;
  },
): Promise<RuleGroup> {
  const {
    name,
    operator,
    rule_ids,
    negate = false,
    enabled = true,
  } = input;

  const [row] = await sql<any[]>`
    INSERT INTO guardrails.rule_groups (name, operator, rule_ids, negate, enabled)
    VALUES (${name}, ${operator}, ${sql.json(rule_ids)}, ${negate}, ${enabled})
    RETURNING *
  `;
  return formatGroup(row);
}

/**
 * Update a rule group's composition or settings.
 */
export async function updateRuleGroup(
  sql: Sql,
  id: string,
  updates: Partial<{
    name: string;
    operator: RuleOperator;
    rule_ids: string[];
    negate: boolean;
    enabled: boolean;
  }>,
): Promise<RuleGroup | null> {
  const sets: string[] = [];
  const vals: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) {
    sets.push(`name = $${idx++}`);
    vals.push(updates.name);
  }
  if (updates.operator !== undefined) {
    sets.push(`operator = $${idx++}`);
    vals.push(updates.operator);
  }
  if (updates.rule_ids !== undefined) {
    sets.push(`rule_ids = $${idx++}`);
    vals.push(sql.json(updates.rule_ids));
  }
  if (updates.negate !== undefined) {
    sets.push(`negate = $${idx++}`);
    vals.push(updates.negate);
  }
  if (updates.enabled !== undefined) {
    sets.push(`enabled = $${idx++}`);
    vals.push(updates.enabled);
  }
  if (sets.length === 0) return getRuleGroup(sql, id);

  vals.push(id);
  const [row] = await sql.unsafe(
    `UPDATE guardrails.rule_groups SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    vals,
  ) as any[];
  return row ? formatGroup(row) : null;
}

/**
 * Delete a rule group.
 */
export async function deleteRuleGroup(
  sql: Sql,
  id: string,
): Promise<boolean> {
  const result = await sql`DELETE FROM guardrails.rule_groups WHERE id = ${id}`;
  return result.count > 0;
}

/**
 * Evaluate a rule group against text.
 * - AND: all sub-rules must match
 * - OR: at least one sub-rule must match
 * - NOT: sub-rule must NOT match
 * negate flag applies NOT to the whole result.
 */
export async function evaluateRuleGroup(
  sql: Sql,
  groupId: string,
  text: string,
): Promise<EvaluateGroupResult | null> {
  const group = await getRuleGroup(sql, groupId);
  if (!group || !group.enabled) return null;

  const rules = await listGuardRules(sql);
  const groupRules = rules.filter((r) => group.rule_ids.includes(r.id));

  const sub_results = groupRules.map((rule) => ({
    rule,
    result: evaluateDSLRule(rule, text),
  }));

  let matched: boolean;
  switch (group.operator) {
    case "AND":
      matched = sub_results.length > 0 && sub_results.every((sr) => sr.result.matched);
      break;
    case "OR":
      matched = sub_results.some((sr) => sr.result.matched);
      break;
    case "NOT":
      matched = sub_results.length === 0
        ? false
        : !sub_results.every((sr) => sr.result.matched);
      // NOT is a bit unusual: if multiple rules, treat as AND-then-negate
      if (sub_results.length > 0) {
        const allMatched = sub_results.every((sr) => sr.result.matched);
        matched = !allMatched;
      }
      break;
  }

  if (group.negate) matched = !matched;

  return {
    matched,
    operator: group.operator,
    negate: group.negate,
    sub_results,
    group_name: group.name,
  };
}

/**
 * Evaluate all enabled rule groups, returning results for any that match.
 */
export async function evaluateAllRuleGroups(
  sql: Sql,
  text: string,
): Promise<EvaluateGroupResult[]> {
  const groups = await listRuleGroups({ enabled: true });
  const results: EvaluateGroupResult[] = [];

  for (const group of groups) {
    const result = await evaluateRuleGroup(sql, group.id, text);
    if (result && result.matched) {
      results.push(result);
    }
  }

  return results;
}

// ---- Helpers ----------------------------------------------------------------

function formatGroup(row: any): RuleGroup {
  return {
    id: row.id,
    name: row.name,
    operator: row.operator as RuleOperator,
    rule_ids: row.rule_ids ?? [],
    negate: row.negate ?? false,
    enabled: row.enabled ?? true,
    created_at: row.created_at,
  };
}
