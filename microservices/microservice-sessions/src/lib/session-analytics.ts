/**
 * Session activity and analytics.
 *
 * get_session_stats    — aggregate stats for a workspace (message count,
 *                        avg session length, most active hours, top models,
 *                        token usage estimate).
 * list_active_sessions — sessions with messages in the last hour, ordered
 *                        by latest message time.
 */

import type { Sql } from "postgres";
import type { Conversation } from "./conversations.js";

export interface SessionStats {
  workspace_id: string;
  total_messages: number;
  total_sessions: number;
  avg_session_length: number;
  most_active_hours: { hour: number; count: number }[];
  top_models: { model: string; count: number }[];
  estimated_total_tokens: number;
  period_start: string | null;
  period_end: string | null;
}

export interface ActiveSession {
  conversation: Conversation;
  last_message_at: string;
  minutes_since_activity: number;
}

/**
 * Return aggregate usage statistics for a workspace.
 *
 * @param sql        - database handle
 * @param workspaceId - workspace to analyze
 * @param since       - optional ISO timestamp lower bound (default: 30 days ago)
 */
export async function getSessionStats(
  sql: Sql,
  workspaceId: string,
  since?: string,
): Promise<SessionStats> {
  const periodStart = since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Total messages in period
  const [msgStats] = await sql<[{ total_messages: number; estimated_tokens: number }]>`
    SELECT
      COUNT(*)::int         AS total_messages,
      COALESCE(SUM(m.tokens), 0)::int AS estimated_tokens
    FROM sessions.messages m
    JOIN sessions.conversations c ON c.id = m.conversation_id
    WHERE c.workspace_id = ${workspaceId}
      AND m.created_at >= ${periodStart}
  `;

  // Total sessions created in period
  const [convStats] = await sql<[{ total_sessions: number; avg_length: number }]>`
    SELECT
      COUNT(*)::int                     AS total_sessions,
      COALESCE(AVG(m.total_messages), 0)::float AS avg_length
    FROM sessions.conversations m
    WHERE m.workspace_id = ${workspaceId}
      AND m.created_at >= ${periodStart}
  `;

  // Most active hours (0-23)
  const hourCounts = await sql<{ hour: number; count: number }[]>`
    SELECT EXTRACT(HOUR FROM m.created_at)::int AS hour, COUNT(*)::int AS count
    FROM sessions.messages m
    JOIN sessions.conversations c ON c.id = m.conversation_id
    WHERE c.workspace_id = ${workspaceId}
      AND m.created_at >= ${periodStart}
    GROUP BY hour
    ORDER BY count DESC
    LIMIT 10
  `;

  // Top models by message count
  const topModels = await sql<{ model: string; count: number }[]>`
    SELECT COALESCE(m.model, 'unknown') AS model, COUNT(*)::int AS count
    FROM sessions.messages m
    JOIN sessions.conversations c ON c.id = m.conversation_id
    WHERE c.workspace_id = ${workspaceId}
      AND m.created_at >= ${periodStart}
      AND m.model IS NOT NULL
    GROUP BY model
    ORDER BY count DESC
    LIMIT 10
  `;

  return {
    workspace_id: workspaceId,
    total_messages: msgStats.total_messages,
    total_sessions: convStats.total_sessions,
    avg_session_length: Math.round(convStats.avg_length * 10) / 10,
    most_active_hours: hourCounts,
    top_models: topModels,
    estimated_total_tokens: msgStats.estimated_tokens,
    period_start: periodStart,
    period_end: new Date().toISOString(),
  };
}

/**
 * List sessions that have received a message in the last 60 minutes,
 * ordered by most recent activity.
 *
 * @param sql         - database handle
 * @param workspaceId - workspace to query
 * @param limit       - max results (default 20)
 */
export async function listActiveSessions(
  sql: Sql,
  workspaceId: string,
  limit = 20,
): Promise<ActiveSession[]> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const rows = await sql<{
    id: string;
    workspace_id: string;
    user_id: string;
    title: string | null;
    model: string | null;
    system_prompt: string | null;
    metadata: any;
    is_archived: boolean;
    is_pinned: boolean;
    total_tokens: number;
    message_count: number;
    created_at: string;
    updated_at: string;
    parent_id: string | null;
    fork_depth: number;
    summary: string | null;
    summary_tokens: number | null;
    is_fork_pinned: boolean;
    root_id: string | null;
    last_message_at: string;
  }[]>`
    SELECT
      c.*,
      MAX(m.created_at) AS last_message_at
    FROM sessions.conversations c
    JOIN sessions.messages m ON m.conversation_id = c.id
    WHERE c.workspace_id = ${workspaceId}
      AND m.created_at >= ${oneHourAgo}
    GROUP BY c.id
    ORDER BY last_message_at DESC
    LIMIT ${limit}
  `;

  const now = Date.now();
  return rows.map((r) => ({
    conversation: r,
    last_message_at: r.last_message_at,
    minutes_since_activity: Math.round((now - new Date(r.last_message_at).getTime()) / 60000),
  }));
}
