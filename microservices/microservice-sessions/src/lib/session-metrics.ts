/**
 * Session usage metrics — aggregated per-session usage statistics.
 *
 * Tracks token counts, message counts, cost estimates, and other
 * billing-relevant metrics per session.
 */

import type { Sql } from "postgres";

export interface SessionMetrics {
  session_id: string;
  message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  estimated_cost_cents: number | null;
  avg_response_time_ms: number | null;
  last_message_at: string | null;
  updated_at: string;
}

/**
 * Upsert (increment) token usage for a session.
 * Called after each assistant response to accumulate metrics.
 */
export async function recordSessionTokens(
  sql: Sql,
  sessionId: string,
  promptTokens: number,
  completionTokens: number,
  costPerThousandTokensCents?: number,
): Promise<void> {
  const totalTokens = promptTokens + completionTokens;
  const estimatedCost = costPerThousandTokensCents != null
    ? (totalTokens / 1000) * costPerThousandTokensCents
    : null;

  // Upsert with increment
  await sql`
    INSERT INTO sessions.session_metrics (
      session_id, message_count, prompt_tokens, completion_tokens,
      total_tokens, estimated_cost_cents
    )
    VALUES (
      ${sessionId}, 1, ${promptTokens}, ${completionTokens},
      ${totalTokens}, ${estimatedCost}
    )
    ON CONFLICT (session_id) DO UPDATE SET
      message_count = sessions.session_metrics.message_count + 1,
      prompt_tokens = sessions.session_metrics.prompt_tokens + ${promptTokens},
      completion_tokens = sessions.session_metrics.completion_tokens + ${completionTokens},
      total_tokens = sessions.session_metrics.total_tokens + ${totalTokens},
      estimated_cost_cents = COALESCE(sessions.session_metrics.estimated_cost_cents, 0) + COALESCE(${estimatedCost}, 0),
      last_message_at = NOW(),
      updated_at = NOW()
  `;
}

/**
 * Record the response time for an assistant message.
 */
export async function recordResponseTime(
  sql: Sql,
  sessionId: string,
  responseTimeMs: number,
): Promise<void> {
  // Maintain a running average of response times
  await sql`
    INSERT INTO sessions.session_response_times (session_id, response_time_ms, created_at)
    VALUES (${sessionId}, ${responseTimeMs}, NOW())
  `;

  // Recalculate average
  const [avg] = await sql<[{ avg: number }]>`
    SELECT AVG(response_time_ms) as avg
    FROM sessions.session_response_times
    WHERE session_id = ${sessionId}
  `;

  await sql`
    UPDATE sessions.session_metrics
    SET avg_response_time_ms = ${avg.avg}, updated_at = NOW()
    WHERE session_id = ${sessionId}
  `;
}

/**
 * Get usage metrics for a session.
 */
export async function getSessionMetrics(
  sql: Sql,
  sessionId: string,
): Promise<SessionMetrics | null> {
  const [row] = await sql<SessionMetrics[]>`
    SELECT * FROM sessions.session_metrics WHERE session_id = ${sessionId}
  `;
  return row ?? null;
}

/**
 * Get the most token-heavy sessions in a workspace.
 */
export async function getTopTokenSessions(
  sql: Sql,
  workspaceId: string,
  limit = 20,
): Promise<Array<{ session_id: string; total_tokens: number; estimated_cost_cents: number }>> {
  return sql<Array<{ session_id: string; total_tokens: number; estimated_cost_cents: number }>>`
    SELECT sm.session_id, sm.total_tokens, sm.estimated_cost_cents
    FROM sessions.session_metrics sm
    JOIN sessions.conversations c ON c.id = sm.session_id
    WHERE c.workspace_id = ${workspaceId}
    ORDER BY sm.total_tokens DESC
    LIMIT ${limit}
  `;
}

/**
 * Get aggregate usage for a workspace.
 */
export async function getWorkspaceUsageTotals(
  sql: Sql,
  workspaceId: string,
): Promise<{
  total_sessions: number;
  total_messages: number;
  total_tokens: number;
  estimated_cost_cents: number;
}> {
  const [row] = await sql<[{
    total_sessions: number;
    total_messages: number;
    total_tokens: number;
    estimated_cost_cents: number;
  }]>`
    SELECT
      COUNT(DISTINCT sm.session_id) as total_sessions,
      COALESCE(SUM(sm.message_count), 0) as total_messages,
      COALESCE(SUM(sm.total_tokens), 0) as total_tokens,
      COALESCE(SUM(sm.estimated_cost_cents), 0) as estimated_cost_cents
    FROM sessions.session_metrics sm
    JOIN sessions.conversations c ON c.id = sm.session_id
    WHERE c.workspace_id = ${workspaceId}
  `;
  return {
    total_sessions: Number(row.total_sessions),
    total_messages: Number(row.total_messages),
    total_tokens: Number(row.total_tokens),
    estimated_cost_cents: Number(row.estimated_cost_cents),
  };
}

/**
 * Delete metrics for a session.
 */
export async function deleteSessionMetrics(
  sql: Sql,
  sessionId: string,
): Promise<void> {
  await sql`DELETE FROM sessions.session_metrics WHERE session_id = ${sessionId}`;
  await sql`DELETE FROM sessions.session_response_times WHERE session_id = ${sessionId}`;
}
