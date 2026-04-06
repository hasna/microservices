/**
 * Trace sampling policies — head-based and tail-based sampling.
 *
 * Head-based: applies before spans are recorded (rate, probabilistic, span-type filters)
 * Tail-based: applies after trace completes (error-only, slow-trace, high-cost)
 */

import type { Sql } from "postgres";

export type SamplingType = "head_rate" | "head_probabilistic" | "tail_error_only" | "tail_slow_trace" | "tail_high_cost";

export interface SamplingPolicy {
  id: string;
  workspace_id: string | null;
  name: string;
  type: SamplingType;
  rate: number;
  span_types?: string[];
  threshold_ms?: number;
  threshold_usd?: number;
  enabled: boolean;
  priority: number;
  created_at: Date;
}

/**
 * Upsert a sampling policy for a workspace.
 */
export async function upsertSamplingPolicy(
  sql: Sql,
  opts: {
    id?: string;
    workspace_id?: string;
    name: string;
    type: SamplingType;
    rate: number;
    span_types?: string[];
    threshold_ms?: number;
    threshold_usd?: number;
    enabled?: boolean;
    priority?: number;
  },
): Promise<SamplingPolicy> {
  const {
    id,
    workspace_id = null,
    name,
    type,
    rate,
    span_types,
    threshold_ms,
    threshold_usd,
    enabled = true,
    priority = 100,
  } = opts;

  const [row] = await sql<any[]>`
    INSERT INTO traces.trace_sampling_policies
      (id, workspace_id, name, type, rate, span_types, threshold_ms, threshold_usd, enabled, priority)
    VALUES (
      ${id ?? null},
      ${workspace_id},
      ${name},
      ${type},
      ${rate},
      ${span_types ?? null},
      ${threshold_ms ?? null},
      ${threshold_usd ?? null},
      ${enabled},
      ${priority}
    )
    ON CONFLICT (id) DO UPDATE SET
      name        = EXCLUDED.name,
      type        = EXCLUDED.type,
      rate        = EXCLUDED.rate,
      span_types  = EXCLUDED.span_types,
      threshold_ms = EXCLUDED.threshold_ms,
      threshold_usd = EXCLUDED.threshold_usd,
      enabled     = EXCLUDED.enabled,
      priority    = EXCLUDED.priority
    RETURNING *
  `;

  return row as SamplingPolicy;
}

/**
 * List sampling policies, optionally filtered by workspace.
 */
export async function listSamplingPolicies(
  sql: Sql,
  workspaceId?: string,
): Promise<SamplingPolicy[]> {
  if (workspaceId) {
    return sql<any[]>`
      SELECT * FROM traces.trace_sampling_policies
      WHERE workspace_id = ${workspaceId} OR workspace_id IS NULL
      ORDER BY priority ASC, created_at ASC
    `;
  }
  return sql<any[]>`
    SELECT * FROM traces.trace_sampling_policies
    ORDER BY priority ASC, created_at ASC
  `;
}

/**
 * Delete a sampling policy by ID.
 */
export async function deleteSamplingPolicy(sql: Sql, id: string): Promise<boolean> {
  const [{ count }] = await sql<{ count: string }[]>`
    DELETE FROM traces.trace_sampling_policies WHERE id = ${id}
    RETURNING count(*) as count
  `;
  return parseInt(count) > 0;
}

/**
 * Should a trace be sampled? Returns true if the trace should be recorded.
 * Applies the highest-priority matching head policy.
 */
export async function shouldSample(
  sql: Sql,
  workspaceId: string,
  spanType?: string,
): Promise<{ sampled: boolean; policy_id: string | null }> {
  const policies = await listSamplingPolicies(sql, workspaceId);
  const activePolicies = policies.filter((p) => p.enabled);

  // Head-based policies
  for (const policy of activePolicies) {
    if (policy.type === "head_rate") {
      const count = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM traces.traces
        WHERE workspace_id = ${workspaceId}
          AND started_at > NOW() - INTERVAL '1 hour'
      `;
      const hourlyTraces = parseInt(count[0]?.count ?? "0");
      if (hourlyTraces >= policy.rate) {
        return { sampled: false, policy_id: policy.id };
      }
    } else if (policy.type === "head_probabilistic") {
      const sampled = Math.random() < policy.rate;
      return { sampled, policy_id: policy.id };
    }
  }

  return { sampled: true, policy_id: null };
}

/**
 * Evaluate tail-based sampling policies against a completed trace.
 * Returns true if the trace should be kept (not sampled out).
 */
export async function shouldKeepTrace(
  sql: Sql,
  traceId: string,
): Promise<{ keep: boolean; reason: string }> {
  const [trace] = await sql<any[]>`
    SELECT t.*,
      COALESCE(SUM(s.cost_usd), 0)::numeric as total_cost,
      COALESCE(MAX(s.duration_ms), 0) as max_duration
    FROM traces.traces t
    LEFT JOIN traces.spans s ON s.trace_id = t.id
    WHERE t.id = ${traceId}
    GROUP BY t.id
  `;

  if (!trace) return { keep: true, reason: "unknown" };

  const policies = await listSamplingPolicies(sql, trace.workspace_id);
  const tailPolicies = policies.filter(
    (p) => p.enabled && p.type.startsWith("tail_"),
  );

  for (const policy of tailPolicies) {
    if (policy.type === "tail_error_only" && trace.status === "error") {
      return { keep: true, reason: `policy=${policy.name} (error trace kept)` };
    }
    if (policy.type === "tail_slow_trace" && policy.threshold_ms != null) {
      if (trace.max_duration > policy.threshold_ms) {
        return { keep: true, reason: `policy=${policy.name} (slow trace, ${trace.max_duration}ms > ${policy.threshold_ms}ms threshold)` };
      }
    }
    if (policy.type === "tail_high_cost" && policy.threshold_usd != null) {
      if (parseFloat(trace.total_cost) > policy.threshold_usd) {
        return { keep: true, reason: `policy=${policy.name} (high cost, $${trace.total_cost} > $${policy.threshold_usd} threshold)` };
      }
    }
  }

  return { keep: false, reason: "no matching tail policy" };
}