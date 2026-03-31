/**
 * Policy CRUD and evaluation.
 */

import type { Sql } from "postgres";

export interface PolicyRule {
  type: "block_words" | "max_length" | "require_format" | "custom_regex";
  config: Record<string, unknown>;
  action: "block" | "warn" | "sanitize";
}

export interface Policy {
  id: string;
  workspace_id: string;
  name: string;
  rules: PolicyRule[];
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PolicyViolation {
  rule_name: string;
  rule_type: string;
  action: string;
  details: Record<string, unknown>;
}

export interface PolicyResult {
  passed: boolean;
  violations: PolicyViolation[];
  sanitized: string;
}

// ---- CRUD ------------------------------------------------------------------

export async function createPolicy(
  sql: Sql,
  workspaceId: string,
  name: string,
  rules: PolicyRule[],
  active = true
): Promise<Policy> {
  const [row] = await sql`
    INSERT INTO guardrails.policies (workspace_id, name, rules, active)
    VALUES (${workspaceId}, ${name}, ${JSON.stringify(rules)}, ${active})
    RETURNING *
  `;
  return row as unknown as Policy;
}

export async function listPolicies(
  sql: Sql,
  workspaceId: string
): Promise<Policy[]> {
  const rows = await sql`
    SELECT * FROM guardrails.policies
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC
  `;
  return rows as unknown as Policy[];
}

export async function getPolicy(sql: Sql, id: string): Promise<Policy | null> {
  const [row] = await sql`SELECT * FROM guardrails.policies WHERE id = ${id}`;
  return (row as unknown as Policy) ?? null;
}

export async function updatePolicy(
  sql: Sql,
  id: string,
  updates: { name?: string; rules?: PolicyRule[]; active?: boolean }
): Promise<Policy | null> {
  const current = await getPolicy(sql, id);
  if (!current) return null;

  const name = updates.name ?? current.name;
  const rules = updates.rules ?? current.rules;
  const active = updates.active ?? current.active;

  const [row] = await sql`
    UPDATE guardrails.policies
    SET name = ${name},
        rules = ${JSON.stringify(rules)},
        active = ${active},
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return (row as unknown as Policy) ?? null;
}

export async function deletePolicy(sql: Sql, id: string): Promise<boolean> {
  const result = await sql`DELETE FROM guardrails.policies WHERE id = ${id}`;
  return result.count > 0;
}

// ---- Evaluation ------------------------------------------------------------

/**
 * Evaluate all active policies for a workspace against the given text.
 */
export async function evaluatePolicy(
  sql: Sql,
  workspaceId: string,
  text: string,
  _direction: "input" | "output"
): Promise<PolicyResult> {
  const policies = await sql`
    SELECT * FROM guardrails.policies
    WHERE workspace_id = ${workspaceId} AND active = true
    ORDER BY created_at ASC
  `;

  const violations: PolicyViolation[] = [];
  let sanitized = text;
  let blocked = false;

  for (const policy of policies) {
    const rules = (typeof policy.rules === "string" ? JSON.parse(policy.rules) : policy.rules) as PolicyRule[];

    for (const rule of rules) {
      const result = evaluateRule(rule, sanitized);
      if (result.violated) {
        violations.push({
          rule_name: policy.name as string,
          rule_type: rule.type,
          action: rule.action,
          details: result.details,
        });
        if (rule.action === "block") blocked = true;
        if (rule.action === "sanitize" && result.sanitized) {
          sanitized = result.sanitized;
        }
      }
    }
  }

  return {
    passed: !blocked && violations.filter((v) => v.action === "block").length === 0,
    violations,
    sanitized,
  };
}

function evaluateRule(
  rule: PolicyRule,
  text: string
): { violated: boolean; details: Record<string, unknown>; sanitized?: string } {
  switch (rule.type) {
    case "block_words": {
      const words = (rule.config.words as string[]) ?? [];
      const found = words.filter((w) => {
        const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        return re.test(text);
      });
      if (found.length === 0) return { violated: false, details: {} };
      let sanitized = text;
      if (rule.action === "sanitize") {
        for (const w of found) {
          const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
          sanitized = sanitized.replace(re, "[BLOCKED]");
        }
      }
      return { violated: true, details: { blocked_words: found }, sanitized };
    }

    case "max_length": {
      const maxLen = (rule.config.max_length as number) ?? 10000;
      if (text.length <= maxLen) return { violated: false, details: {} };
      const sanitized = rule.action === "sanitize" ? text.slice(0, maxLen) : undefined;
      return { violated: true, details: { length: text.length, max_length: maxLen }, sanitized };
    }

    case "require_format": {
      const format = rule.config.format as string | undefined;
      if (!format) return { violated: false, details: {} };
      try {
        const re = new RegExp(format);
        if (re.test(text)) return { violated: false, details: {} };
        return { violated: true, details: { expected_format: format } };
      } catch {
        return { violated: false, details: { error: "invalid regex in format" } };
      }
    }

    case "custom_regex": {
      const pattern = rule.config.pattern as string | undefined;
      if (!pattern) return { violated: false, details: {} };
      try {
        const re = new RegExp(pattern, "gi");
        const matches = text.match(re);
        if (!matches) return { violated: false, details: {} };
        let sanitized = text;
        if (rule.action === "sanitize") {
          sanitized = text.replace(re, "[REDACTED]");
        }
        return { violated: true, details: { pattern, matches_count: matches.length }, sanitized };
      } catch {
        return { violated: false, details: { error: "invalid regex" } };
      }
    }

    default:
      return { violated: false, details: { error: `unknown rule type: ${rule.type}` } };
  }
}
