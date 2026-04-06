/**
 * Trace comparison and timeline utilities.
 */

import type { Sql } from "postgres";
import type { Span, Trace } from "./tracing.js";
import type { TraceWithSpans } from "./query.js";
import { getTrace } from "./query.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TraceTimelineSpan {
  span_id: string;
  parent_span_id: string | null;
  name: string;
  type: string;
  status: string;
  start_offset_ms: number;
  duration_ms: number | null;
  error: string | null;
}

export interface TraceTimeline {
  trace_id: string;
  trace_started_at: string;
  total_spans: number;
  spans: TraceTimelineSpan[];
}

export interface TraceDiffSpan {
  span_id: string;
  name: string;
  type: string;
  in_a: boolean;
  in_b: boolean;
  duration_ms_a: number | null;
  duration_ms_b: number | null;
}

export interface TraceDiff {
  trace_id_a: string;
  trace_id_b: string;
  workspace_id_a: string;
  workspace_id_b: string;
  spans_added: number;
  spans_removed: number;
  spans: TraceDiffSpan[];
  duration_diff_ms: number | null;
  attribute_diffs: {
    span_id: string;
    span_name: string;
    key: string;
    value_a: unknown;
    value_b: unknown;
  }[];
}

// ---------------------------------------------------------------------------
// get_trace_timeline
// ---------------------------------------------------------------------------

export async function get_trace_timeline(
  sql: Sql,
  traceId: string,
): Promise<TraceTimeline | null> {
  const trace = await getTrace(sql, traceId);
  if (!trace) return null;

  const traceStartMs = new Date(trace.started_at).getTime();

  const spans = await sql<Span[]>`
    SELECT * FROM traces.spans
    WHERE trace_id = ${traceId}
    ORDER BY started_at ASC
  `;

  return {
    trace_id: traceId,
    trace_started_at: trace.started_at.toISOString(),
    total_spans: spans.length,
    spans: spans.map((s) => ({
      span_id: s.id,
      parent_span_id: s.parent_span_id,
      name: s.name,
      type: s.type,
      status: s.status,
      start_offset_ms: Math.max(
        0,
        new Date(s.started_at).getTime() - traceStartMs,
      ),
      duration_ms: s.duration_ms,
      error: s.error,
    })),
  };
}

// ---------------------------------------------------------------------------
// compare_traces
// ---------------------------------------------------------------------------

export async function compare_traces(
  sql: Sql,
  traceIdA: string,
  traceIdB: string,
): Promise<TraceDiff | null> {
  const [traceA, traceB] = await Promise.all([
    getTrace(sql, traceIdA),
    getTrace(sql, traceIdB),
  ]);

  if (!traceA || !traceB) return null;

  const spansA = new Map(traceA.spans.map((s) => [s.id, s]));
  const spansB = new Map(traceB.spans.map((s) => [s.id, s]));

  const allIds = new Set([...spansA.keys(), ...spansB.keys()]);

  const diffSpans: TraceDiffSpan[] = [];
  let added = 0;
  let removed = 0;

  for (const id of allIds) {
    const a = spansA.get(id);
    const b = spansB.get(id);

    if (a && !b) {
      removed++;
      diffSpans.push({
        span_id: a.id,
        name: a.name,
        type: a.type,
        in_a: true,
        in_b: false,
        duration_ms_a: a.duration_ms,
        duration_ms_b: null,
      });
    } else if (!a && b) {
      added++;
      diffSpans.push({
        span_id: b.id,
        name: b.name,
        type: b.type,
        in_a: false,
        in_b: true,
        duration_ms_a: null,
        duration_ms_b: b.duration_ms,
      });
    } else if (a && b) {
      // Compare durations
      diffSpans.push({
        span_id: a.id,
        name: a.name,
        type: a.type,
        in_a: true,
        in_b: true,
        duration_ms_a: a.duration_ms,
        duration_ms_b: b.duration_ms,
      });
    }
  }

  // Attribute diffs — check for mismatched attributes across matching spans
  const attributeDiffs: TraceDiff["attribute_diffs"] = [];
  for (const id of allIds) {
    const a = spansA.get(id);
    const b = spansB.get(id);
    if (!a || !b) continue;

    const keysToCompare: (keyof Span)[] = [
      "status",
      "type",
      "error",
      "model",
      "tokens_in",
      "tokens_out",
      "cost_usd",
    ];

    for (const key of keysToCompare) {
      if (a[key] !== b[key]) {
        attributeDiffs.push({
          span_id: id,
          span_name: a.name,
          key,
          value_a: a[key],
          value_b: b[key],
        });
      }
    }
  }

  const durationDiff =
    traceA.total_duration_ms !== null && traceB.total_duration_ms !== null
      ? traceB.total_duration_ms - traceA.total_duration_ms
      : null;

  return {
    trace_id_a: traceIdA,
    trace_id_b: traceIdB,
    workspace_id_a: traceA.workspace_id,
    workspace_id_b: traceB.workspace_id,
    spans_added: added,
    spans_removed: removed,
    spans: diffSpans,
    duration_diff_ms: durationDiff,
    attribute_diffs: attributeDiffs,
  };
}

// ---------------------------------------------------------------------------
// Human-readable trace diff summary
// ---------------------------------------------------------------------------

export interface TraceDiffSummary {
  trace_a_id: string;
  trace_b_id: string;
  summary: string;
  duration: {
    a_ms: number | null;
    b_ms: number | null;
    diff_ms: number | null;
    diff_pct: number | null;
  };
  spans: {
    total_a: number;
    total_b: number;
    added: number;
    removed: number;
    changed_duration: number;
  };
  top_slowest_deltas: {
    name: string;
    duration_a_ms: number | null;
    duration_b_ms: number | null;
    delta_ms: number | null;
  }[];
  attribute_changes: {
    span_name: string;
    attribute: string;
    value_a: unknown;
    value_b: unknown;
  }[];
}

/**
 * Get a human-readable summary of the differences between two traces.
 */
export async function getTraceDiffSummary(
  sql: Sql,
  traceIdA: string,
  traceIdB: string,
): Promise<TraceDiffSummary | null> {
  const diff = await compare_traces(sql, traceIdA, traceIdB);
  if (!diff) return null;

  const [traceA, traceB] = await Promise.all([
    getTrace(sql, traceIdA),
    getTrace(sql, traceIdB),
  ]);

  const durationA = traceA?.total_duration_ms ?? null;
  const durationB = traceB?.total_duration_ms ?? null;
  const durationDiffPct =
    durationA && durationA > 0 && durationB
      ? ((durationB - durationA) / durationA) * 100
      : null;

  // Find spans with biggest duration changes
  const changedSpans = diff.spans
    .filter((s) => s.in_a && s.in_b && s.duration_ms_a !== null && s.duration_ms_b !== null)
    .map((s) => ({
      name: s.name,
      duration_a_ms: s.duration_ms_a,
      duration_b_ms: s.duration_ms_b,
      delta_ms: s.duration_ms_b! - s.duration_ms_a!,
    }))
    .sort((a, b) => Math.abs(b.delta_ms!) - Math.abs(a.delta_ms!))
    .slice(0, 5);

  const summaryParts: string[] = [];
  if (diff.spans_added > 0) summaryParts.push(`+${diff.spans_added} span(s) added`);
  if (diff.spans_removed > 0) summaryParts.push(`-${diff.spans_removed} span(s) removed`);
  if (diff.duration_diff_ms !== null) {
    const sign = diff.duration_diff_ms >= 0 ? "+" : "";
    summaryParts.push(`duration ${sign}${diff.duration_diff_ms}ms (${sign}${durationDiffPct?.toFixed(1)}%)`);
  }
  if (diff.attribute_diffs.length > 0) {
    summaryParts.push(`${diff.attribute_diffs.length} attribute change(s)`);
  }

  const spansA = traceA?.spans.length ?? 0;
  const spansB = traceB?.spans.length ?? 0;

  return {
    trace_a_id: traceIdA,
    trace_b_id: traceIdB,
    summary: summaryParts.length > 0 ? summaryParts.join(", ") : "No significant differences",
    duration: {
      a_ms: durationA,
      b_ms: durationB,
      diff_ms: diff.duration_diff_ms,
      diff_pct: durationDiffPct,
    },
    spans: {
      total_a: spansA,
      total_b: spansB,
      added: diff.spans_added,
      removed: diff.spans_removed,
      changed_duration: changedSpans.length,
    },
    top_slowest_deltas: changedSpans,
    attribute_changes: diff.attribute_diffs.map((d) => ({
      span_name: d.span_name,
      attribute: d.key,
      value_a: d.value_a,
      value_b: d.value_b,
    })),
  };
}
