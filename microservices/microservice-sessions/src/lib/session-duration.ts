/**
 * Session duration analysis — track, bucket, and analyze session length patterns.
 */

import type { Sql } from "postgres";

export interface DurationBucket {
  range_label: string;
  min_seconds: number;
  max_seconds: number | null;
  session_count: number;
  message_count: number;
}

export interface SessionDuration {
  session_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  is_active: boolean;
}

export interface DurationInsight {
  avg_duration_seconds: number;
  median_duration_seconds: number;
  p95_duration_seconds: number;
  total_duration_seconds: number;
  active_sessions: number;
  completed_sessions: number;
}

/**
 * Record session end time and calculate duration.
 */
export async function recordSessionEnd(
  sql: Sql,
  sessionId: string,
): Promise<SessionDuration | null> {
  const [session] = await sql<{ id: string; created_at: string }[]>`
    SELECT id, created_at FROM sessions.conversations WHERE id = ${sessionId}
  `;

  if (!session) return null;

  const endedAt = new Date().toISOString();
  const durationSeconds = Math.floor(
    (new Date(endedAt).getTime() - new Date(session.created_at).getTime()) / 1000
  );

  await sql`
    UPDATE sessions.conversations
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'),
      '{ended_at}',
      ${endedAt}::text::jsonb
    )
    WHERE id = ${sessionId}
  `;

  return {
    session_id: sessionId,
    started_at: session.created_at,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    is_active: false,
  };
}

/**
 * Get duration for a session (active or completed).
 */
export async function getSessionDuration(
  sql: Sql,
  sessionId: string,
): Promise<SessionDuration | null> {
  const [session] = await sql<{
    id: string;
    created_at: string;
    metadata: any;
  }[]>`
    SELECT id, created_at, metadata FROM sessions.conversations WHERE id = ${sessionId}
  `;

  if (!session) return null;

  const endedAt = session.metadata?.ended_at ?? null;
  const isActive = endedAt === null;

  let durationSeconds: number | null = null;
  if (endedAt) {
    durationSeconds = Math.floor(
      (new Date(endedAt).getTime() - new Date(session.created_at).getTime()) / 1000
    );
  }

  return {
    session_id: sessionId,
    started_at: session.created_at,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    is_active: isActive,
  };
}

/**
 * Get duration statistics for a workspace.
 */
export async function getDurationInsights(
  sql: Sql,
  workspaceId: string,
  since?: string,
): Promise<DurationInsight> {
  const sinceClause = since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [stats] = await sql<{
    avg_dur: number;
    median_dur: number | null;
    p95_dur: number | null;
    total_dur: string;
    active_count: number;
    completed_count: number;
  }[]>`
    SELECT
      AVG(duration_seconds)::float as avg_dur,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_seconds) as median_dur,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_seconds) as p95_dur,
      SUM(duration_seconds)::text as total_dur,
      COUNT(*) FILTER (WHERE ended_at IS NULL)::int as active_count,
      COUNT(*) FILTER (WHERE ended_at IS NOT NULL)::int as completed_count
    FROM (
      SELECT
        c.id,
        c.created_at,
        c.metadata->>'ended_at' as ended_at,
        EXTRACT(EPOCH FROM (
          COALESCE(
            (c.metadata->>'ended_at')::timestamptz,
            NOW()
          ) - c.created_at
        ))::int as duration_seconds
      FROM sessions.conversations c
      WHERE c.workspace_id = ${workspaceId}
        AND c.created_at >= ${sinceClause}
    ) sessions_with_duration
  `;

  return {
    avg_duration_seconds: Math.round(stats.avg_dur),
    median_duration_seconds: Math.round(stats.median_dur ?? 0),
    p95_duration_seconds: Math.round(stats.p95_dur ?? 0),
    total_duration_seconds: parseInt(stats.total_dur, 10) || 0,
    active_sessions: stats.active_count,
    completed_sessions: stats.completed_count,
  };
}

/**
 * Get session durations bucketed by length ranges.
 */
export async function getDurationBuckets(
  sql: Sql,
  workspaceId: string,
  buckets?: number[],
  since?: string,
): Promise<DurationBucket[]> {
  const bucketBoundaries = buckets ?? [60, 300, 600, 1800, 3600, 7200, 14400];
  const sinceClause = since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Build SQL CASE expression for bucketing
  const bucketLabels: string[] = [];
  for (let i = 0; i < bucketBoundaries.length; i++) {
    if (i === 0) {
      bucketLabels.push(`WHEN duration_seconds <= ${bucketBoundaries[i]} THEN '${bucketBoundaries[i]}s'`);
    } else {
      bucketLabels.push(`WHEN duration_seconds > ${bucketBoundaries[i-1]} AND duration_seconds <= ${bucketBoundaries[i]} THEN '${bucketBoundaries[i-1]+1}-${bucketBoundaries[i]}s'`);
    }
  }
  bucketLabels.push(`WHEN duration_seconds > ${bucketBoundaries[bucketBoundaries.length-1]} THEN '>${bucketBoundaries[bucketBoundaries.length-1]}s'`);

  const rows = await sql<{ bucket: string; session_count: number; message_count: number; min_s: number; max_s: number }[]>`
    WITH session_durations AS (
      SELECT
        c.id,
        EXTRACT(EPOCH FROM (
          COALESCE((c.metadata->>'ended_at')::timestamptz, NOW()) - c.created_at
        ))::int as duration_seconds
      FROM sessions.conversations c
      WHERE c.workspace_id = ${workspaceId}
        AND c.created_at >= ${sinceClause}
    ),
    bucketed AS (
      SELECT
        duration_seconds,
        CASE
          ${sql.unsafe(bucketLabels.join(" "))}
        END as bucket_label,
        (SELECT MIN(duration_seconds) FROM session_durations WHERE
          ${sql.unsafe(bucketLabels.map((_, i) => i === 0 ? `duration_seconds <= ${bucketBoundaries[i]}` : `duration_seconds > ${bucketBoundaries[i-1]} AND duration_seconds <= ${bucketBoundaries[i]}`).join(" OR "))}
        ) as min_sec
      FROM session_durations
    )
    SELECT
      bucket_label as bucket,
      COUNT(*)::int as session_count,
      0 as message_count,
      MIN(min_sec)::int as min_s,
      MAX(duration_seconds) as max_s
    FROM bucketed
    GROUP BY bucket_label
    ORDER BY MIN(min_sec)
  `;

  return rows.map(r => ({
    range_label: r.bucket,
    min_seconds: r.min_s,
    max_seconds: r.max_s,
    session_count: r.session_count,
    message_count: r.message_count,
  }));
}

/**
 * Detect sessions with unusually long or short durations.
 */
export async function detectDurationAnomalies(
  sql: Sql,
  workspaceId: string,
  thresholdSeconds = 3600,
): Promise<{ long_sessions: Array<{ session_id: string; duration_seconds: number; created_at: string }>; short_sessions: Array<{ session_id: string; duration_seconds: number; created_at: string }> }> {
  const [long] = await sql<{ session_id: string; duration_seconds: number; created_at: string }[]>`
    SELECT
      c.id as session_id,
      EXTRACT(EPOCH FROM (NOW() - c.created_at))::int as duration_seconds,
      c.created_at
    FROM sessions.conversations c
    WHERE c.workspace_id = ${workspaceId}
      AND c.metadata->>'ended_at' IS NULL
      AND EXTRACT(EPOCH FROM (NOW() - c.created_at)) > ${thresholdSeconds}
    ORDER BY duration_seconds DESC
    LIMIT 50
  `;

  const [short] = await sql<{ session_id: string; duration_seconds: number; created_at: string }[]>`
    SELECT
      c.id as session_id,
      EXTRACT(EPOCH FROM (
        COALESCE((c.metadata->>'ended_at')::timestamptz, NOW()) - c.created_at
      ))::int as duration_seconds,
      c.created_at
    FROM sessions.conversations c
    WHERE c.workspace_id = ${workspaceId}
      AND c.metadata->>'ended_at' IS NOT NULL
      AND EXTRACT(EPOCH FROM (
        (c.metadata->>'ended_at')::timestamptz - c.created_at
      )) < 30
    ORDER BY duration_seconds ASC
    LIMIT 50
  `;

  return { long_sessions: long, short_sessions: short };
}