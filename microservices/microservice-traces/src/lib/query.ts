/**
 * Query operations — fetch traces and spans.
 */

import type { Sql } from "postgres";
import type { Trace, Span } from "./tracing.js";

export interface TraceWithSpans extends Trace {
  spans: Span[];
}

export interface SpanWithChildren extends Span {
  children: SpanWithChildren[];
}

export interface TraceTree extends Trace {
  spans: SpanWithChildren[];
}

export interface ListTracesOpts {
  status?: string;
  name?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

export interface ListSpansOpts {
  type?: string;
  status?: string;
}

export async function getTrace(sql: Sql, id: string): Promise<TraceWithSpans | null> {
  const [trace] = await sql<Trace[]>`SELECT * FROM traces.traces WHERE id = ${id}`;
  if (!trace) return null;

  const spans = await sql<Span[]>`
    SELECT * FROM traces.spans WHERE trace_id = ${id} ORDER BY started_at
  `;

  return { ...trace, spans };
}

export async function getTraceTree(sql: Sql, id: string): Promise<TraceTree | null> {
  const [trace] = await sql<Trace[]>`SELECT * FROM traces.traces WHERE id = ${id}`;
  if (!trace) return null;

  const spans = await sql<Span[]>`
    SELECT * FROM traces.spans WHERE trace_id = ${id} ORDER BY started_at
  `;

  const tree = buildSpanTree(spans);
  return { ...trace, spans: tree };
}

export function buildSpanTree(spans: Span[]): SpanWithChildren[] {
  const map = new Map<string, SpanWithChildren>();
  const roots: SpanWithChildren[] = [];

  for (const span of spans) {
    map.set(span.id, { ...span, children: [] });
  }

  for (const span of spans) {
    const node = map.get(span.id)!;
    if (span.parent_span_id && map.has(span.parent_span_id)) {
      map.get(span.parent_span_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export async function listTraces(
  sql: Sql,
  workspaceId: string,
  opts: ListTracesOpts = {}
): Promise<Trace[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const conditions: string[] = [];
  const values: unknown[] = [];

  // Build dynamic query with postgres tagged template
  let query = sql`
    SELECT * FROM traces.traces
    WHERE workspace_id = ${workspaceId}
  `;

  if (opts.status) {
    query = sql`${query} AND status = ${opts.status}`;
  }
  if (opts.name) {
    query = sql`${query} AND name ILIKE ${"%" + opts.name + "%"}`;
  }
  if (opts.since) {
    query = sql`${query} AND started_at >= ${opts.since}`;
  }
  if (opts.until) {
    query = sql`${query} AND started_at <= ${opts.until}`;
  }

  query = sql`${query} ORDER BY started_at DESC LIMIT ${limit} OFFSET ${offset}`;

  return query as unknown as Promise<Trace[]>;
}

export async function getSpan(sql: Sql, id: string): Promise<Span | null> {
  const [span] = await sql<Span[]>`SELECT * FROM traces.spans WHERE id = ${id}`;
  return span ?? null;
}

export async function listSpans(
  sql: Sql,
  traceId: string,
  opts: ListSpansOpts = {}
): Promise<Span[]> {
  let query = sql`
    SELECT * FROM traces.spans
    WHERE trace_id = ${traceId}
  `;

  if (opts.type) {
    query = sql`${query} AND type = ${opts.type}`;
  }
  if (opts.status) {
    query = sql`${query} AND status = ${opts.status}`;
  }

  query = sql`${query} ORDER BY started_at`;

  return query as unknown as Promise<Span[]>;
}
