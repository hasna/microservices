/**
 * IP-level brute force detection — tracks failed login attempts
 * by IP address to detect distributed brute force attacks that may
 * bypass per-user throttling.
 *
 * Works alongside per-user login throttling but at the IP/network layer.
 */

import type { Sql } from "postgres";

export interface IpAttemptRecord {
  ip_address: string;
  failed_attempts: number;
  locked_until: string | null;
  last_attempted_at: string;
  last_attempted_user_id: string | null;
}

export interface IpBlockStatus {
  blocked: boolean;
  reason: "hard_lockout" | "soft_lockout" | "none";
  locked_until: string | null;
  failed_attempts: number;
  retry_after_seconds: number | null;
}

/**
 * Record a failed login attempt from an IP address.
 * Returns the updated block status after this attempt.
 */
export async function recordIpFailedAttempt(
  sql: Sql,
  ipAddress: string,
  userId?: string,
): Promise<IpBlockStatus> {
  // Get current state
  const [existing] = await sql<IpAttemptRecord[]>`
    SELECT * FROM auth.ip_login_attempts WHERE ip_address = ${ipAddress}
  `;

  const now = new Date();
  const ATTEMPT_WINDOW_MINUTES = 15;
  const SOFT_LOCKOUT_ATTEMPTS = 20;
  const SOFT_LOCKOUT_MINUTES = 5;
  const HARD_LOCKOUT_ATTEMPTS = 100;
  const HARD_LOCKOUT_HOURS = 24;

  if (!existing) {
    await sql`
      INSERT INTO auth.ip_login_attempts (ip_address, failed_attempts, last_attempted_at, last_attempted_user_id)
      VALUES (${ipAddress}, 1, ${now}, ${userId ?? null})
    `;
    return { blocked: false, reason: "none", locked_until: null, failed_attempts: 1, retry_after_seconds: null };
  }

  const attempts = Number(existing.failed_attempts);
  const lockedUntil = existing.locked_until ? new Date(existing.locked_until) : null;

  // Check if currently locked
  if (lockedUntil && lockedUntil > now) {
    const retryAfter = Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000);
    return {
      blocked: true,
      reason: attempts >= HARD_LOCKOUT_ATTEMPTS ? "hard_lockout" : "soft_lockout",
      locked_until: existing.locked_until,
      failed_attempts: attempts,
      retry_after_seconds: retryAfter,
    };
  }

  const newAttempts = attempts + 1;
  let newLockedUntil: Date | null = null;
  let reason: IpBlockStatus["reason"] = "none";
  let retryAfter: number | null = null;

  if (newAttempts >= HARD_LOCKOUT_ATTEMPTS) {
    newLockedUntil = new Date(now.getTime() + HARD_LOCKOUT_HOURS * 60 * 60 * 1000);
    reason = "hard_lockout";
    retryAfter = HARD_LOCKOUT_HOURS * 60 * 60;
  } else if (newAttempts >= SOFT_LOCKOUT_ATTEMPTS) {
    newLockedUntil = new Date(now.getTime() + SOFT_LOCKOUT_MINUTES * 60 * 1000);
    reason = "soft_lockout";
    retryAfter = SOFT_LOCKOUT_MINUTES * 60;
  }

  await sql`
    UPDATE auth.ip_login_attempts
    SET
      failed_attempts = ${newAttempts},
      last_attempted_at = ${now},
      last_attempted_user_id = ${userId ?? null},
      locked_until = ${newLockedUntil?.toISOString() ?? null}
    WHERE ip_address = ${ipAddress}
  `;

  return {
    blocked: newLockedUntil !== null,
    reason,
    locked_until: newLockedUntil?.toISOString() ?? null,
    failed_attempts: newAttempts,
    retry_after_seconds: retryAfter,
  };
}

/**
 * Record a successful login from an IP — resets the attempt counter.
 */
export async function recordIpSuccessfulLogin(
  sql: Sql,
  ipAddress: string,
): Promise<void> {
  await sql`
    UPDATE auth.ip_login_attempts
    SET failed_attempts = 0, locked_until = NULL, last_attempted_at = NOW()
    WHERE ip_address = ${ipAddress}
  `;
}

/**
 * Get the current block status for an IP address.
 */
export async function getIpBlockStatus(
  sql: Sql,
  ipAddress: string,
): Promise<IpBlockStatus> {
  const [existing] = await sql<IpAttemptRecord[]>`
    SELECT * FROM auth.ip_login_attempts WHERE ip_address = ${ipAddress}
  `;

  if (!existing) {
    return { blocked: false, reason: "none", locked_until: null, failed_attempts: 0, retry_after_seconds: null };
  }

  const now = new Date();
  const lockedUntil = existing.locked_until ? new Date(existing.locked_until) : null;

  if (lockedUntil && lockedUntil > now) {
    return {
      blocked: true,
      reason: Number(existing.failed_attempts) >= 100 ? "hard_lockout" : "soft_lockout",
      locked_until: existing.locked_until,
      failed_attempts: Number(existing.failed_attempts),
      retry_after_seconds: Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000),
    };
  }

  return {
    blocked: false,
    reason: "none",
    locked_until: null,
    failed_attempts: Number(existing.failed_attempts),
    retry_after_seconds: null,
  };
}

/**
 * Check if login from an IP should be allowed.
 */
export async function isIpLoginAllowed(
  sql: Sql,
  ipAddress: string,
): Promise<IpBlockStatus> {
  return getIpBlockStatus(sql, ipAddress);
}
