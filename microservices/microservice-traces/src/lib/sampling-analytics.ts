/**
 * Sampling analytics — per-policy sampling rates, trace-level evaluation,
 * and bulk sampling decisions for batch operations.
 */

import type { Sql } from "postgres";
import type { SamplingPolicy } from "./sampling.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SamplingDecision {
  trace_id: string | null;
  workspace_id: string;
  policy_id: string | null;
  policy_name: string | null;
  policy_type: string;
  decision: "sampled" | "dropped";
  reason: string;
  evaluated_at: Date;
}

export interface SamplingPolicyStats {
  policy_id: string;
  policy_name: string;
  policy_type: string;
  total_traces: number;
  sampled_traces: number;
  dropped_traces: number;
  sample_rate: number;
  avg_duration_ms: number;
  avg_cost: number;
  errors_sampled: number;
}

export interface BulkSamplingResult {
  trace_id: string;
  decision: "sampled" | "dropped";
  reason: string;
  policy_id: string | null;
}

// ─── Record a sampling decision ────────────────────────────────────────────

/**
 * Record that a trace was evaluated against sampling policies.
 * Call this after starting a trace to log the head-based sampling decision.
 */
export async function recordSamplingDecision(
  sql: Sql,
  opts: {
    traceId?: string;
    workspaceId: string;
    policyId?: string;
    policyName?: string;
    policyType: string;
    decision: "sampled" | "dropped";
    reason: string;
  },
): Promise<void> {
  await sql`
    INSERT INTO traces.sampling_decisions
      (trace_id, workspace_id, policy_id, policy_name, policy_type, decision, reason)
    VALUES (
      ${opts.traceId ?? null},
      ${opts.workspaceId},
      ${opts.policyId ?? null},
      ${opts.policyName ?? null},
      ${opts.policyType},
      ${opts.decision},
      ${opts.reason}
    )
  `;
}

/**
 * Get the count of traces sampled vs dropped within a time window.
 */
export async function getSamplingStats(
  sql: Sql,
  workspaceId: string,
  since?: Date,
): Promise<SamplingPolicyStats[]> {
  const sinceDate = since ?? new Date(Date.now() - 24 * 3600000);

  const rows = await sql<{
    policy_id: string;
    policy_name: string;
    policy_type: string;
    total_traces: string;
    sampled_traces: string;
    dropped_traces: string;
    avg_duration: string;
    avg_cost: string;
    errors_sampled: string;
  }[]>`
    SELECT
      COALESCE(sd.policy_id, 'none') AS policy_id,
      COALESCE(sd.policy_name, 'default-keep') AS policy_name,
      COALESCE(sd.policy_type, 'default') AS policy_type,
      COUNT(*)::int AS total_traces,
      COUNT(*) FILTER (WHERE sd.decision = 'sampled')::int AS sampled_traces,
      COUNT(*) FILTER (WHERE sd.decision = 'dropped')::int AS dropped_traces,
      COALESCE(AVG(t.total_duration_ms), 0) AS avg_duration,
      COALESCE(AVG(t.total_cost_usd), 0)::numeric AS avg_cost,
      COUNT(*) FILTER (WHERE t.status = 'error' AND sd.decision = 'sampled')::int AS errors_sampled
    FROM traces.sampling_decisions sd
    LEFT JOIN traces.traces t ON t.id = sd.trace_id
    WHERE sd.workspace_id = ${workspaceId}
      AND sd.evaluated_at >= ${sinceDate}
    GROUP BY 1, 2, 3
    ORDER BY total_traces DESC
  `;

  return rows.map((r) => ({
    policy_id: r.policy_id,
    policy_name: r.policy_name,
    policy_type: r.policy_type,
    total_traces: parseInt(r.total_traces, 10),
    sampled_traces: parseInt(r.sampled_traces, 10),
    dropped_traces: parseInt(r.dropped_traces, 10),
    sample_rate: parseInt(r.total_traces, 10) > 0
      ? parseFloat((parseInt(r.sampled_traces, 10) / parseInt(r.total_traces, 10)).toFixed(4))
      : 1.0,
    avg_duration_ms: Math.round(parseFloat(r.avg_duration)),
    avg_cost: parseFloat(r.avg_cost),
    errors_sampled: parseInt(r.errors_sampled, 10),
  }));
}

/**
 * List all sampling decisions for a workspace (paginated).
 */
export async function listSamplingDecisions(
  sql: Sql,
  workspaceId: string,
  opts: { limit?: number; offset?: number; decision?: "sampled" | "dropped"; since?: Date } = {},
): Promise<{ decisions: SamplingDecision[]; total: number }> {
  const sinceDate = opts.since ?? new Date(Date.now() - 7 * 86400000);
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  const [countRow] = await sql<[{ count: string }]>`
    SELECT COUNT(*)::int AS count FROM traces.sampling_decisions
    WHERE workspace_id = ${workspaceId}
      AND evaluated_at >= ${sinceDate}
      ${opts.decision ? sql`AND decision = ${opts.decision}` : sql``}
  `;

  const rows = await sql<any[]>`
    SELECT * FROM traces.sampling_decisions
    WHERE workspace_id = ${workspaceId}
      AND evaluated_at >= ${sinceDate}
      ${opts.decision ? sql`AND decision = ${opts.decision}` : sql``}
    ORDER BY evaluated_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return {
    decisions: rows.map((r) => ({
      trace_id: r.trace_id,
      workspace_id: r.workspace_id,
      policy_id: r.policy_id,
      policy_name: r.policy_name,
      policy_type: r.policy_type,
      decision: r.decision,
      reason: r.reason,
      evaluated_at: r.evaluated_at,
    })),
    total: parseInt(countRow.count, 10),
  };
}

/**
 * Evaluate which sampling policy would apply to a hypothetical trace
 * (head-based only — does not record a decision).
 * Returns the decision and which policy matched.
 */
export async function evaluateSampling(
  sql: Sql,
  workspaceId: string,
  opts: { spanType?: string } = {},
): Promise<{ decision: "sampled" | "dropped"; reason: string; policy_id: string | null; policy_name: string | null }> {
  const { listSamplingPolicies } = await import("./sampling.js");
  const policies = await listSamplingPolicies(sql, workspaceId);
  const activePolicies = policies.filter((p: SamplingPolicy) => p.enabled);

  // Head-based: highest priority matching policy
  for (const policy of activePolicies) {
    if (policy.type === "head_rate") {
      const [count] = await sql<{ count: string }[]>`
        SELECT COUNT(*)::int AS count FROM traces.traces
        WHERE workspace_id = ${workspaceId}
          AND started_at > NOW() - INTERVAL '1 hour'
      `;
      const hourlyTraces = parseInt(count[0]?.count ?? "0", 10);
      if (hourlyTraces >= policy.rate) {
        return {
          decision: "dropped",
          reason: `head_rate limit reached: ${hourlyTraces} >= ${policy.rate} traces/hour`,
          policy_id: policy.id,
          policy_name: policy.name,
        };
      }
      return {
        decision: "sampled",
        reason: `head_rate: under limit (${hourlyTraces} < ${policy.rate})`,
        policy_id: policy.id,
        policy_name: policy.name,
      };
    }

    if (policy.type === "head_probabilistic") {
      const sampled = Math.random() < policy.rate;
      return {
        decision: sampled ? "sampled" : "dropped",
        reason: `head_probabilistic: random < ${policy.rate} → ${sampled ? "sampled" : "dropped"}`,
        policy_id: policy.id,
        policy_name: policy.name,
      };
    }
  }

  // No matching head policy → default keep
  return {
    decision: "sampled",
    reason: "no matching head policy — default keep",
    policy_id: null,
    policy_name: null,
  };
}

/**
 * Make bulk sampling decisions for a list of trace IDs (tail-based evaluation).
 * Uses the completed trace data to evaluate tail-based policies.
 */
export async function bulkEvaluateSampling(
  sql: Sql,
  traceIds: string[],
): Promise<BulkSamplingResult[]> {
  if (traceIds.length === 0) return [];

  const results: BulkSamplingResult[] = [];

  const traces = await sql<any[]>`
    SELECT t.id as trace_id, t.workspace_id, t.status, t.total_duration_ms,
      COALESCE(SUM(s.cost_usd), 0)::numeric as total_cost
    FROM traces.traces t
    LEFT JOIN traces.spans s ON s.trace_id = t.id
    WHERE t.id IN (${sql.join(traceIds.map((id) => sql`${id}`), sql`, `)})
    GROUP BY t.id
  `;

  const { shouldKeepTrace } = await import("./sampling.js");
  const { evaluateSampling } = await import("./sampling.js");

  for (const trace of traces) {
    // For running traces, use head-based evaluation
    if (trace.status === "running") {
      const { decision, reason, policy_id, policy_name } = await evaluateSampling(sql, trace.workspace_id);
      results.push({
        trace_id: trace.trace_id,
        decision,
        reason,
        policy_id,
      });
    } else {
      // For completed/error traces, use tail-based evaluation
      const { keep, reason } = await shouldKeepTrace(sql, trace.trace_id);
      results.push({
        trace_id: trace.trace_id,
        decision: keep ? "sampled" : "dropped",
        reason,
        policy_id: null,
      });
    }
  }

  return results;
}

/**
 * Get the overall sampling rate for a workspace as a single percentage.
 */
export async function getOverallSamplingRate(
  sql: Sql,
  workspaceId: string,
  since?: Date,
): Promise<{ sampled: number; dropped: number; rate: number }> {
  const sinceDate = since ?? new Date(Date.now() - 24 * 3600000);

  const [row] = await sql<{ sampled: string; dropped: string }[]>`
    SELECT
      COUNT(*) FILTER (WHERE decision = 'sampled')::int AS sampled,
      COUNT(*) FILTER (WHERE decision = 'dropped')::int AS dropped
    FROM traces.sampling_decisions
    WHERE workspace_id = ${workspaceId}
      AND evaluated_at >= ${sinceDate}
  `;

  const sampled = parseInt(row.sampled ?? "0", 10);
  const dropped = parseInt(row.dropped ?? "0", 10);
  const total = sampled + dropped;

  return {
    sampled,
    dropped,
    rate: total > 0 ? parseFloat((sampled / total).toFixed(4)) : 1.0,
  };
}
