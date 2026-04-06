/**
 * Auth timeout policies — per-workspace and per-user session timeout configuration.
 */

import type { Sql } from "postgres";

export interface AuthTimeoutPolicy {
  id: string;
  workspace_id: string | null; // null = global default
  user_id: string | null;     // null = workspace default
  session_max_age_seconds: number;
  session_idle_timeout_seconds: number;
  require_reauth_on_inactive_seconds: number | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface EffectiveTimeout {
  max_age_seconds: number;
  idle_timeout_seconds: number;
  require_reauth_seconds: number | null;
  source: "user" | "workspace" | "global";
}

/**
 * Upsert a timeout policy at workspace or user level.
 * User-level policies override workspace-level; workspace overrides global.
 */
export async function upsertTimeoutPolicy(
  sql: Sql,
  opts: {
    workspaceId?: string;
    userId?: string;
    sessionMaxAgeSeconds?: number;
    sessionIdleTimeoutSeconds?: number;
    requireReauthOnInactiveSeconds?: number | null;
    enabled?: boolean;
  },
): Promise<AuthTimeoutPolicy> {
  const [row] = await sql<AuthTimeoutPolicy[]>`
    INSERT INTO auth.auth_timeout_policies
      (workspace_id, user_id, session_max_age_seconds, session_idle_timeout_seconds,
       require_reauth_on_inactive_seconds, enabled)
    VALUES (
      ${opts.workspaceId ?? null},
      ${opts.userId ?? null},
      ${opts.sessionMaxAgeSeconds ?? 86400},
      ${opts.sessionIdleTimeoutSeconds ?? 3600},
      ${opts.requireReauthOnInactiveSeconds ?? null},
      ${opts.enabled ?? true}
    )
    ON CONFLICT (workspace_id, user_id)
    DO UPDATE SET
      session_max_age_seconds = EXCLUDED.session_max_age_seconds,
      session_idle_timeout_seconds = EXCLUDED.session_idle_timeout_seconds,
      require_reauth_on_inactive_seconds = EXCLUDED.require_reauth_on_inactive_seconds,
      enabled = EXCLUDED.enabled,
      updated_at = NOW()
    RETURNING *
  `;
  return row;
}

/**
 * Get the effective timeout for a user — checks user, then workspace, then global.
 */
export async function getEffectiveTimeout(
  sql: Sql,
  userId: string,
  workspaceId?: string,
): Promise<EffectiveTimeout> {
  // Try user-level
  const [userPolicy] = await sql<AuthTimeoutPolicy[]>`
    SELECT * FROM auth.auth_timeout_policies
    WHERE user_id = ${userId} AND enabled = TRUE
    ORDER BY workspace_id NULLS FIRST
    LIMIT 1
  `;
  if (userPolicy) {
    return {
      max_age_seconds: userPolicy.session_max_age_seconds,
      idle_timeout_seconds: userPolicy.session_idle_timeout_seconds,
      require_reauth_seconds: userPolicy.require_reauth_on_inactive_seconds,
      source: "user",
    };
  }

  // Try workspace-level
  if (workspaceId) {
    const [wsPolicy] = await sql<AuthTimeoutPolicy[]>`
      SELECT * FROM auth.auth_timeout_policies
      WHERE workspace_id = ${workspaceId} AND user_id IS NULL AND enabled = TRUE
      LIMIT 1
    `;
    if (wsPolicy) {
      return {
        max_age_seconds: wsPolicy.session_max_age_seconds,
        idle_timeout_seconds: wsPolicy.session_idle_timeout_seconds,
        require_reauth_seconds: wsPolicy.require_reauth_on_inactive_seconds,
        source: "workspace",
      };
    }
  }

  // Global default: 30-day max age, 1-hour idle, no reauth enforcement
  return {
    max_age_seconds: 30 * 86400,
    idle_timeout_seconds: 3600,
    require_reauth_seconds: null,
    source: "global",
  };
}

/**
 * Check whether a session has exceeded its idle timeout based on the effective policy.
 */
export async function isSessionIdleExpired(
  sql: Sql,
  sessionId: string,
  userId: string,
  workspaceId?: string,
): Promise<{ expired: boolean; seconds_idle: number; timeout_seconds: number }> {
  const [session] = await sql<{ last_seen_at: string; created_at: string }[]>`
    SELECT last_seen_at, created_at FROM auth.sessions
    WHERE id = ${sessionId} AND user_id = ${userId}
  `;
  if (!session) return { expired: false, seconds_idle: 0, timeout_seconds: 0 };

  const lastSeen = session.last_seen_at
    ? new Date(session.last_seen_at)
    : new Date(session.created_at);
  const secondsIdle = Math.floor((Date.now() - lastSeen.getTime()) / 1000);

  const effective = await getEffectiveTimeout(sql, userId, workspaceId);
  const expired = secondsIdle > effective.idle_timeout_seconds;

  return { expired, seconds_idle: secondsIdle, timeout_seconds: effective.idle_timeout_seconds };
}

/**
 * List all timeout policies for a workspace (user-level overrides).
 */
export async function listWorkspaceTimeoutPolicies(
  sql: Sql,
  workspaceId: string,
): Promise<AuthTimeoutPolicy[]> {
  const [rows] = await sql<AuthTimeoutPolicy[]>`
    SELECT * FROM auth.auth_timeout_policies
    WHERE workspace_id = ${workspaceId} OR workspace_id IS NULL
    ORDER BY user_id NULLS LAST
  `;
  return rows;
}

/**
 * Delete a timeout policy (user or workspace level).
 */
export async function deleteTimeoutPolicy(
  sql: Sql,
  workspaceId?: string,
  userId?: string,
): Promise<boolean> {
  const [row] = await sql<[{ id: string }][]>`
    DELETE FROM auth.auth_timeout_policies
    WHERE workspace_id ${workspaceId ? sql`= ${workspaceId}` : sql`IS NULL`}
      AND user_id ${userId ? sql`= ${userId}` : sql`IS NULL`}
    RETURNING id
  `;
  return !!row;
}
