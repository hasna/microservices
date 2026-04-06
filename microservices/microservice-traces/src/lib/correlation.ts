/**
 * Trace correlation — link traces to sessions, users, and external request IDs.
 * Enables cross-referencing traces with auth systems, sessions, and upstream services.
 */

import type { Sql } from "postgres";

export interface TraceCorrelation {
  id: string;
  trace_id: string;
  session_id: string | null;
  user_id: string | null;
  external_request_id: string | null;
  external_trace_id: string | null;
  created_at: Date;
}

/**
 * Link a trace to a session, user, or external ID.
 */
export async function linkTrace(
  sql: Sql,
  opts: {
    trace_id: string;
    session_id?: string;
    user_id?: string;
    external_request_id?: string;
    external_trace_id?: string;
  },
): Promise<TraceCorrelation> {
  const { trace_id, session_id = null, user_id = null, external_request_id = null, external_trace_id = null } = opts;

  const [row] = await sql<any[]>`
    INSERT INTO traces.trace_correlations
      (trace_id, session_id, user_id, external_request_id, external_trace_id)
    VALUES (${trace_id}, ${session_id}, ${user_id}, ${external_request_id}, ${external_trace_id})
    ON CONFLICT (trace_id) DO UPDATE SET
      session_id           = COALESCE(EXCLUDED.session_id, trace_correlations.session_id),
      user_id              = COALESCE(EXCLUDED.user_id, trace_correlations.user_id),
      external_request_id  = COALESCE(EXCLUDED.external_request_id, trace_correlations.external_request_id),
      external_trace_id    = COALESCE(EXCLUDED.external_trace_id, trace_correlations.external_trace_id)
    RETURNING *
  `;

  return row as TraceCorrelation;
}

/**
 * Get all traces for a given session.
 */
export async function getTracesBySession(
  sql: Sql,
  sessionId: string,
  limit = 50,
): Promise<any[]> {
  const rows = await sql<any[]>`
    SELECT t.* FROM traces.traces t
    INNER JOIN traces.trace_correlations c ON c.trace_id = t.id
    WHERE c.session_id = ${sessionId}
    ORDER BY t.started_at DESC
    LIMIT ${limit}
  `;
  return rows;
}

/**
 * Get all traces for a given user.
 */
export async function getTracesByUser(
  sql: Sql,
  userId: string,
  limit = 50,
): Promise<any[]> {
  const rows = await sql<any[]>`
    SELECT t.* FROM traces.traces t
    INNER JOIN traces.trace_correlations c ON c.trace_id = t.id
    WHERE c.user_id = ${userId}
    ORDER BY t.started_at DESC
    LIMIT ${limit}
  `;
  return rows;
}

/**
 * Get traces by external request ID (e.g. from API gateway).
 */
export async function getTraceByExternalRequestId(
  sql: Sql,
  externalRequestId: string,
): Promise<any | null> {
  const [row] = await sql<any[]>`
    SELECT t.* FROM traces.traces t
    INNER JOIN traces.trace_correlations c ON c.trace_id = t.id
    WHERE c.external_request_id = ${externalRequestId}
    LIMIT 1
  `;
  return row ?? null;
}

/**
 * Get correlation data for a trace.
 */
export async function getCorrelation(
  sql: Sql,
  traceId: string,
): Promise<TraceCorrelation | null> {
  const [row] = await sql<any[]>`
    SELECT * FROM traces.trace_correlations WHERE trace_id = ${traceId}
  `;
  return row ?? null;
}

/**
 * List traces by external trace ID (e.g. cross-service trace IDs).
 */
export async function getTracesByExternalTraceId(
  sql: Sql,
  externalTraceId: string,
  limit = 50,
): Promise<any[]> {
  const rows = await sql<any[]>`
    SELECT t.* FROM traces.traces t
    INNER JOIN traces.trace_correlations c ON c.trace_id = t.id
    WHERE c.external_trace_id = ${externalTraceId}
    ORDER BY t.started_at DESC
    LIMIT ${limit}
  `;
  return rows;
}