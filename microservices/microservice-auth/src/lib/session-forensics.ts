/**
 * Session forensics — detailed session metadata for security auditing.
 *
 * Provides session history with rich metadata (IP, device, origin, timestamps)
 * without exposing tokens.
 */

import type { Sql } from "postgres";

export interface SessionMetadata {
  id: string;
  user_id: string;
  ip: string | null;
  device_id: string | null;
  device_name: string | null;
  user_agent: string | null;
  origin: string | null;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
}

/**
 * Get all active sessions for a user with full metadata (no tokens exposed).
 */
export async function getActiveSessions(
  sql: Sql,
  userId: string,
): Promise<SessionMetadata[]> {
  return sql<SessionMetadata[]>`
    SELECT
      id,
      user_id,
      ip,
      device_id,
      device_name,
      user_agent,
      NULL AS origin,
      created_at,
      last_seen_at,
      expires_at
    FROM auth.sessions
    WHERE user_id = ${userId} AND expires_at > NOW()
    ORDER BY last_seen_at DESC NULLS LAST, created_at DESC
  `;
}

/**
 * Record a login event for audit / forensics.
 */
export async function recordLoginEvent(
  sql: Sql,
  userId: string,
  opts: {
    event_type: "login_success" | "login_failure" | "logout" | "token_refresh" | "passkey_success";
    ip?: string;
    user_agent?: string;
    device_id?: string;
    metadata?: Record<string, any>;
  },
): Promise<void> {
  await sql`
    INSERT INTO auth.login_events (user_id, event_type, ip, user_agent, device_id, metadata)
    VALUES (
      ${userId},
      ${opts.event_type},
      ${opts.ip ?? null},
      ${opts.user_agent ?? null},
      ${opts.device_id ?? null},
      ${opts.metadata ? JSON.stringify(opts.metadata) : null}
    )
  `;
}

/**
 * Get recent authentication events for a user.
 */
export async function getRecentAuthEvents(
  sql: Sql,
  userId: string,
  opts: { limit?: number; event_type?: string } = {},
): Promise<{
  id: string;
  event_type: string;
  ip: string | null;
  user_agent: string | null;
  device_id: string | null;
  metadata: any;
  created_at: string;
}[]> {
  const limit = opts.limit ?? 20;
  const rows = await sql<[{
    id: string;
    event_type: string;
    ip: string | null;
    user_agent: string | null;
    device_id: string | null;
    metadata: any;
    created_at: string;
  }]>`
    SELECT id, event_type, ip, user_agent, device_id, metadata, created_at
    FROM auth.login_events
    WHERE user_id = ${userId}
      ${opts.event_type ? sql`AND event_type = ${opts.event_type}` : sql``}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows;
}
