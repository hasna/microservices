/**
 * Account lockout — lock accounts after repeated failed authentication attempts.
 * Supports per-user and per-IP lockout with escalating unlock times.
 */

import type { Sql } from "postgres";

export interface AccountLockout {
  id: string;
  user_id: string | null;
  ip_address: string | null;
  reason: string;
  failed_attempts: number;
  locked_at: Date;
  unlock_at: Date | null;
  locked_by_system: boolean;
}

export interface LockoutConfig {
  max_attempts: number;
  lockout_duration_seconds: number;
  escalating: boolean;
  escalation_factor: number;
  max_lockout_seconds: number;
}

/**
 * Default lockout configuration.
 */
export const DEFAULT_LOCKOUT_CONFIG: LockoutConfig = {
  max_attempts: 5,
  lockout_duration_seconds: 300,       // 5 minutes
  escalating: true,
  escalation_factor: 2,
  max_lockout_seconds: 86400,         // 1 day max
};

/**
 * Record a failed authentication attempt. Returns whether the account is now locked.
 */
export async function recordFailedAttempt(
  sql: Sql,
  opts: {
    userId?: string;
    ipAddress?: string;
    reason?: string;
    config?: Partial<LockoutConfig>;
  },
): Promise<{ locked: boolean; failed_attempts: number; unlock_at: Date | null; lockout_id: string | null }> {
  const config = { ...DEFAULT_LOCKOUT_CONFIG, ...opts.config };
  const userId = opts.userId ?? null;
  const ipAddress = opts.ipAddress ?? null;
  const reason = opts.reason ?? "Too many failed login attempts";

  // Find or create lockout record
  const existing = userId
    ? await sql<any[]>`
        SELECT * FROM auth.account_lockouts
        WHERE user_id = ${userId} AND locked_by_system = true AND unlock_at IS NULL OR unlock_at > NOW()
        ORDER BY locked_at DESC LIMIT 1`
    : await sql<any[]>`
        SELECT * FROM auth.account_lockouts
        WHERE ip_address = ${ipAddress} AND user_id IS NULL AND locked_by_system = true AND (unlock_at IS NULL OR unlock_at > NOW())
        ORDER BY locked_at DESC LIMIT 1`;

  if (existing.length > 0) {
    // Already locked
    return {
      locked: true,
      failed_attempts: existing[0].failed_attempts,
      unlock_at: existing[0].unlock_at,
      lockout_id: existing[0].id,
    };
  }

  const attemptsKey = userId ?? `ip:${ipAddress}`;
  const [attemptRow] = await sql<any[]>`
    SELECT count(*) as attempts FROM auth.login_events
    WHERE (user_id = ${userId} OR ip_address = ${ipAddress})
      AND event_type = 'login_failed'
      AND created_at > NOW() - INTERVAL '1 hour'
  `;

  const failedAttempts = parseInt(attemptRow?.attempts ?? "0") + 1;

  if (failedAttempts >= config.max_attempts) {
    const lockoutSeconds = config.escalating
      ? Math.min(
          config.lockout_duration_seconds * Math.pow(config.escalation_factor, Math.floor(failedAttempts / config.max_attempts) - 1),
          config.max_lockout_seconds,
        )
      : config.lockout_duration_seconds;

    const [lockout] = await sql<any[]>`
      INSERT INTO auth.account_lockouts
        (user_id, ip_address, reason, failed_attempts, locked_at, unlock_at, locked_by_system)
      VALUES (${userId}, ${ipAddress}, ${reason}, ${failedAttempts}, NOW(), NOW() + INTERVAL '${String(lockoutSeconds)} seconds', true)
      RETURNING *
    `;

    return {
      locked: true,
      failed_attempts: failedAttempts,
      unlock_at: lockout.unlock_at,
      lockout_id: lockout.id,
    };
  }

  return { locked: false, failed_attempts: failedAttempts, unlock_at: null, lockout_id: null };
}

/**
 * Check if a user or IP is currently locked out.
 */
export async function isLockedOut(
  sql: Sql,
  opts: { userId?: string; ipAddress?: string },
): Promise<AccountLockout | null> {
  const [row] = await sql<any[]>`
    SELECT * FROM auth.account_lockouts
    WHERE locked_by_system = true
      AND (unlock_at IS NULL OR unlock_at > NOW())
      AND (
        (${opts.userId ? `user_id = ${opts.userId}` : "FALSE"}
          OR ${opts.ipAddress ? `ip_address = ${opts.ipAddress}` : "FALSE"})
      )
    ORDER BY locked_at DESC
    LIMIT 1
  `;
  return row ?? null;
}

/**
 * Manually unlock an account (admin action).
 */
export async function unlockAccount(
  sql: Sql,
  opts: { userId?: string; ipAddress?: string },
): Promise<boolean> {
  const [{ count }] = await sql<{ count: string }[]>`
    UPDATE auth.account_lockouts
    SET unlock_at = NOW()
    WHERE locked_by_system = true
      AND (unlock_at IS NULL OR unlock_at > NOW())
      AND (
        ${opts.userId ? `user_id = ${opts.userId}` : "FALSE"}
        OR ${opts.ipAddress ? `ip_address = ${opts.ipAddress}` : "FALSE"}
      )
    RETURNING count(*) as count
  `;
  return parseInt(count) > 0;
}

/**
 * Get all active lockouts for a workspace.
 */
export async function listActiveLockouts(
  sql: Sql,
  workspaceId?: string,
): Promise<AccountLockout[]> {
  const rows = await sql<any[]>`
    SELECT * FROM auth.account_lockouts
    WHERE locked_by_system = true
      AND (unlock_at IS NULL OR unlock_at > NOW())
    ORDER BY locked_at DESC
  `;
  return rows as AccountLockout[];
}

/**
 * Clear a successful login (reset failed attempt counter).
 */
export async function clearFailedAttempts(
  sql: Sql,
  opts: { userId?: string; ipAddress?: string },
): Promise<void> {
  await sql`
    DELETE FROM auth.login_events
    WHERE event_type = 'login_failed'
      AND ${opts.userId ? `user_id = ${opts.userId}` : "FALSE"}
      OR ${opts.ipAddress ? `ip_address = ${opts.ipAddress}` : "FALSE"}
  `;
}
