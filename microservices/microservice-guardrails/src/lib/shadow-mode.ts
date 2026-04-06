/**
 * Guardrail shadow mode — evaluate content against guardrail policies
 * without actually blocking or enforcing, just for observability.
 */

import type { Sql } from "postgres";

export interface ShadowEvaluation {
  id: string;
  workspace_id: string;
  policy_id: string | null;
  content: string;
  violations_found: ShadowViolation[];
  would_block: boolean;
  evaluation_time_ms: number;
  evaluated_at: string;
}

export interface ShadowViolation {
  rule_id: string;
  rule_name: string;
  severity: "critical" | "high" | "medium" | "low";
  matched_content: string;
  explanation: string;
}

export interface ShadowModeStats {
  workspace_id: string;
  total_evaluations: number;
  evaluations_with_violations: number;
  block_rate_pct: number;
  top_violated_rules: { rule_id: string; rule_name: string; count: number }[];
  avg_evaluation_time_ms: number;
}

/**
 * Evaluate content in shadow mode — returns what WOULD happen if enforced.
 */
export async function evaluateShadowMode(
  sql: Sql,
  workspaceId: string,
  content: string,
  policyId?: string,
): Promise<ShadowEvaluation> {
  const startTime = Date.now();

  const violations: ShadowViolation[] = [];

  // Get applicable policies
  const policies = policyId
    ? await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM guardrails.policies
        WHERE id = ${policyId} AND workspace_id = ${workspaceId} AND is_active = true`
    : await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM guardrails.policies
        WHERE workspace_id = ${workspaceId} AND is_active = true
        ORDER BY priority DESC LIMIT 5`;

  for (const policy of policies) {
    // Get rules for this policy
    const rules = await sql<{
      id: string;
      name: string;
      rule_type: string;
      config: Record<string, unknown>;
      severity: string;
    }[]>`
      SELECT id, name, rule_type, config, severity
      FROM guardrails.rules
      WHERE policy_id = ${policy.id} AND is_active = true`;

    for (const rule of rules) {
      const violation = await evaluateRule(sql, rule, content);
      if (violation) {
        violations.push(violation);
      }
    }
  }

  const evaluationTimeMs = Date.now() - startTime;
  const wouldBlock = violations.some(v => v.severity === "critical" || v.severity === "high");

  const [result] = await sql<ShadowEvaluation[]>`
    INSERT INTO guardrails.shadow_evaluations (
      workspace_id, policy_id, content, violations_found,
      would_block, evaluation_time_ms
    )
    VALUES (
      ${workspaceId},
      ${policyId ?? null},
      ${content},
      ${JSON.stringify(violations)},
      ${wouldBlock},
      ${evaluationTimeMs}
    )
    RETURNING id, workspace_id, policy_id, content, violations_found,
              would_block, evaluation_time_ms, evaluated_at::text
  `;

  return result;
}

async function evaluateRule(
  sql: Sql,
  rule: { id: string; name: string; rule_type: string; config: Record<string, unknown>; severity: string },
  content: string,
): Promise<ShadowViolation | null> {
  const lowerContent = content.toLowerCase();

  switch (rule.rule_type) {
    case "denylist": {
      const blocked = (rule.config.blocked_terms as string[]) ?? [];
      for (const term of blocked) {
        if (lowerContent.includes(term.toLowerCase())) {
          return {
            rule_id: rule.id,
            rule_name: rule.name,
            severity: rule.severity as "critical" | "high" | "medium" | "low",
            matched_content: term,
            explanation: `Content contains blocked term: "${term}"`,
          };
        }
      }
      break;
    }

    case "pii": {
      const piiTypes = (rule.config.pii_types as string[]) ?? ["email", "phone", "ssn"];
      const piiPatterns: Record<string, RegExp> = {
        email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
        phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
        ssn: /\b\d{3}-\d{2}-\d{4}\b/,
      };

      for (const piiType of piiTypes) {
        const pattern = piiPatterns[piiType];
        if (pattern && pattern.test(content)) {
          return {
            rule_id: rule.id,
            rule_name: rule.name,
            severity: rule.severity as "critical" | "high" | "medium" | "low",
            matched_content: `[${piiType} detected]`,
            explanation: `Content contains ${piiType} personal information`,
          };
        }
      }
      break;
    }

    case "toxicity": {
      // Simple keyword-based toxicity detection
      const toxicityKeywords = (rule.config.keywords as string[]) ?? [
        "hate", "violent", "explicit", "harassment",
      ];
      for (const keyword of toxicityKeywords) {
        if (lowerContent.includes(keyword)) {
          return {
            rule_id: rule.id,
            rule_name: rule.name,
            severity: rule.severity as "critical" | "high" | "medium" | "low",
            matched_content: keyword,
            explanation: `Content flagged for: "${keyword}"`,
          };
        }
      }
      break;
    }

    case "injection": {
      const injectionPatterns = (rule.config.patterns as string[]) ?? [
        "ignore previous instructions",
        "disregard your system",
        "you are now",
      ];
      for (const pattern of injectionPatterns) {
        if (lowerContent.includes(pattern.toLowerCase())) {
          return {
            rule_id: rule.id,
            rule_name: rule.name,
            severity: rule.severity as "critical" | "high" | "medium" | "low",
            matched_content: pattern,
            explanation: "Potential prompt injection detected",
          };
        }
      }
      break;
    }
  }

  return null;
}

/**
 * Get shadow mode statistics for a workspace.
 */
export async function getShadowModeStats(
  sql: Sql,
  workspaceId: string,
  days = 7,
): Promise<ShadowModeStats> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [stats] = await sql<[
    { total: string; with_violations: string; total_time: string },
  ]>`
    SELECT
      COUNT(*)::text as total,
      COUNT(*) FILTER (WHERE would_block = true)::text as with_violations,
      COALESCE(SUM(evaluation_time_ms), 0)::text as total_time
    FROM guardrails.shadow_evaluations
    WHERE workspace_id = ${workspaceId}
      AND evaluated_at >= ${cutoff.toISOString()}
  `;

  const topRules = await sql<{ rule_id: string; rule_name: string; count: string }[]>`
    SELECT
      violation->>'rule_id' as rule_id,
      violation->>'rule_name' as rule_name,
      COUNT(*)::text as count
    FROM guardrails.shadow_evaluations,
         jsonb_array_elements(violations_found) as violation
    WHERE workspace_id = ${workspaceId}
      AND evaluated_at >= ${cutoff.toISOString()}
    GROUP BY violation->>'rule_id', violation->>'rule_name'
    ORDER BY COUNT(*) DESC
    LIMIT 10
  `;

  const total = Number(stats.total);
  const withViolations = Number(stats.with_violations);
  const totalTime = Number(stats.total_time);

  return {
    workspace_id: workspaceId,
    total_evaluations: total,
    evaluations_with_violations: withViolations,
    block_rate_pct: total > 0 ? Math.round((withViolations / total) * 10000) / 100 : 0,
    top_violated_rules: topRules.map(r => ({
      rule_id: r.rule_id,
      rule_name: r.rule_name,
      count: Number(r.count),
    })),
    avg_evaluation_time_ms: total > 0 ? Math.round(totalTime / total) : 0,
  };
}

/**
 * List recent shadow evaluations.
 */
export async function listShadowEvaluations(
  sql: Sql,
  workspaceId: string,
  limit = 50,
): Promise<ShadowEvaluation[]> {
  return sql<ShadowEvaluation[]>`
    SELECT id, workspace_id, policy_id, content,
           violations_found, would_block, evaluation_time_ms, evaluated_at::text
    FROM guardrails.shadow_evaluations
    WHERE workspace_id = ${workspaceId}
    ORDER BY evaluated_at DESC
    LIMIT ${limit}
  `;
}