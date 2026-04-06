/**
 * Concurrent session detection and limits — detect and enforce
 * maximum simultaneous active sessions per user.
 */

import type { Sql } from "postgres";

export interface ConcurrentSessionInfo {
  user_id: string;
  active_sessions: number;
  max_allowed: number;
  oldest_session_at: string | null;
  newest_session_at: string | null;
  is_over_limit: boolean;
}

export interface ConcurrentSessionViolation {
  user_id: string;
  session_id: string;
  detected_at: Date;
  active_count: number;
  max_allowed: number;
  oldest_session_id: string;
}

/**
 * Get concurrent session information for a user.
 */
export async function getConcurrentSessionInfo(
  sql: Sql,
  userId: string,
  maxAllowed?: number,
): Promise<ConcurrentSessionInfo> {
  const limit = maxAllowed ?? 5;

  const sessions = await sql<{ id: string; created_at: string }[]>`
    SELECT id, created_at FROM auth.sessions
    WHERE user_id = ${userId} AND expires_at > NOW()
    ORDER BY created_at ASC
  `;

  const now = new Date();
  const oldest = sessions.length > 0 ? sessions[0].created_at : null;
  const newest = sessions.length > 0 ? sessions[sessions.length - 1].created_at : null;

  return {
    user_id: userId,
    active_sessions: sessions.length,
    max_allowed: limit,
    oldest_session_at: oldest,
    newest_session_at: newest,
    is_over_limit: sessions.length > limit,
  };
}

/**
 * Enforce concurrent session limit — returns sessions that should be revoked.
 * Revokes oldest sessions until under the limit.
 */
export async function enforceConcurrentSessionLimit(
  sql: Sql,
  userId: string,
  maxAllowed?: number,
): Promise<string[]> {
  const limit = maxAllowed ?? 5;

  const sessions = await sql<{ id: string }[]>`
    SELECT id FROM auth.sessions
    WHERE user_id = ${userId} AND expires_at > NOW()
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;

  if (sessions.length <= limit) {
    return [];
  }

  const toRevoke = sessions.slice(0, sessions.length - limit);
  const idsToRevoke = toRevoke.map(s => s.id);

  await sql`
    DELETE FROM auth.sessions
    WHERE id IN ${sql(idsToRevoke)}
  `;

  return idsToRevoke;
}

/**
 * Set a user's concurrent session limit.
 */
export async function setUserSessionLimit(
  sql: Sql,
  userId: string,
  maxSessions: number,
): Promise<void> {
  await sql`
    INSERT INTO auth.user_session_limits (user_id, max_sessions, updated_at)
    VALUES (${userId}, ${maxSessions}, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET max_sessions = EXCLUDED.max_sessions,
          updated_at = NOW()
  `;
}

/**
 * Get a user's concurrent session limit.
 */
export async function getUserSessionLimit(
  sql: Sql,
  userId: string,
): Promise<number> {
  const [row] = await sql<{ max_sessions: number }[]>`
    SELECT max_sessions FROM auth.user_session_limits
    WHERE user_id = ${userId}
  `;
  return row?.max_sessions ?? 5; // Default 5
}

/**
 * Detect concurrent session anomalies — log when user has suspicious
 * number of simultaneous sessions from different locations.
 */
export async function detectConcurrentSessionAnomaly(
  sql: Sql,
  userId: string,
): Promise<ConcurrentSessionViolation[]> {
  const sessions = await sql<{
    id: string;
    ip: string | null;
    created_at: string;
  }[]>`
    SELECT id, ip, created_at FROM auth.sessions
    WHERE user_id = ${userId} AND expires_at > NOW()
    ORDER BY created_at ASC
  `;

  if (sessions.length < 3) return [];

  // Group by IP to detect geographic spread
  const ipGroups = new Map<string, string[]>();
  for (const s of sessions) {
    if (s.ip) {
      if (!ipGroups.has(s.ip)) ipGroups.set(s.ip, []);
      ipGroups.get(s.ip)!.push(s.id);
    }
  }

  // If sessions from 3+ different IPs simultaneously, flag as suspicious
  const violations: ConcurrentSessionViolation[] = [];
  if (ipGroups.size >= 3) {
    for (const session of sessions) {
      violations.push({
        user_id: userId,
        session_id: session.id,
        detected_at: new Date(),
        active_count: sessions.length,
        max_allowed: await getUserSessionLimit(sql, userId),
        oldest_session_id: sessions[0].id,
      });
    }
  }

  return violations;
}