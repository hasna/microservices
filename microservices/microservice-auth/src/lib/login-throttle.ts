/**
 * Login throttling — rate-limit authentication attempts per email.
 *
 * Tracks failed login attempts and enforces lockouts after repeated failures.
 * Lockout durations double with each successive failure (exponential backoff).
 */

import type { Sql } from "postgres";

export interface LoginThrottleStatus {
  allowed: boolean;
  locked_until: string | null;
  attempts_remaining: number;
}

const MAX_ATTEMPTS = 5;
const BASE_LOCKOUT_MINUTES = 5;
const MAX_LOCKOUT_HOURS = 24;

/**
 * Check whether a login attempt is currently allowed for an email.
 */
export async function checkLoginAllowed(
  sql: Sql,
  email: string,
): Promise<LoginThrottleStatus> {
  await cleanExpiredAttempts(email);

  const [row] = await sql<[{
    attempt_count: string;
    first_attempt_at: string | null;
    last_attempt_at: string | null;
  }]>`
    SELECT attempt_count, first_attempt_at, last_attempt_at
    FROM auth.login_attempts
    WHERE email = ${email.toLowerCase()}
  `;

  if (!row) {
    return { allowed: true, locked_until: null, attempts_remaining: MAX_ATTEMPTS };
  }

  const count = parseInt(row.attempt_count, 10);

  if (count <= 0) {
    return { allowed: true, locked_until: null, attempts_remaining: MAX_ATTEMPTS };
  }

  if (count >= MAX_ATTEMPTS) {
    // Compute lockout expiry based on exponential backoff
    const lockMinutes = Math.min(
      BASE_LOCKOUT_MINUTES * Math.pow(2, count - MAX_ATTEMPTS),
      MAX_LOCKOUT_HOURS * 60,
    );
    const locked_until = new Date(
      new Date(row.first_attempt_at!).getTime() + lockMinutes * 60 * 1000,
    ).toISOString();

    if (new Date() < locked_until) {
      return {
        allowed: false,
        locked_until,
        attempts_remaining: 0,
      };
    }
    // Lockout expired — allow but will reset count on next failed attempt
    return { allowed: true, locked_until: null, attempts_remaining: 0 };
  }

  return {
    allowed: true,
    locked_until: null,
    attempts_remaining: MAX_ATTEMPTS - count,
  };
}

/**
 * Record a failed login attempt for an email.
 */
export async function recordFailedLogin(
  sql: Sql,
  email: string,
): Promise<void> {
  await sql`
    INSERT INTO auth.login_attempts (email, attempt_count, first_attempt_at, last_attempt_at)
    VALUES (${email.toLowerCase()}, 1, NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET
      attempt_count = auth.login_attempts.attempt_count + 1,
      last_attempt_at = NOW()
  `;
}

/**
 * Clear all login attempts for an email (call after successful login).
 */
export async function clearLoginAttempts(
  sql: Sql,
  email: string,
): Promise<void> {
  await sql`
    DELETE FROM auth.login_attempts WHERE email = ${email.toLowerCase()}
  `;
}

/**
 * Get the number of failed attempts for an email.
 */
export async function getFailedAttemptCount(
  sql: Sql,
  email: string,
): Promise<number> {
  const [row] = await sql<[{ attempt_count: string }]>`
    SELECT attempt_count FROM auth.login_attempts WHERE email = ${email.toLowerCase()}
  `;
  return row ? parseInt(row.attempt_count, 10) : 0;
}

/**
 * Delete expired login attempt records for an email.
 */
async function cleanExpiredAttempts(email: string): Promise<void> {
  // Lockout expires when first_attempt_at + (2^(count-MAX) * BASE_LOCKOUT_MINUTES) < now
  // Records older than MAX_LOCKOUT_HOURS can always be cleaned
  await sql`
    DELETE FROM auth.login_attempts
    WHERE email = ${email.toLowerCase()}
      AND first_attempt_at < NOW() - ${MAX_LOCKOUT_HOURS} * INTERVAL '1 hour'
  `;
}
