/**
 * Auth health checks — microservice-auth.
 *
 * Provides health and readiness monitoring for auth components:
 * - Database connectivity and query latency
 * - Session cleanup status
 * - Token validity and expiration rates
 * - Failed login attempt rates
 * - Overall system status
 */

import type { Sql } from "postgres";

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface AuthHealthCheck {
  component: string;
  status: HealthStatus;
  latency_ms: number | null;
  message: string | null;
  details: Record<string, unknown>;
}

export interface AuthHealthReport {
  overall_status: HealthStatus;
  timestamp: string;
  checks: AuthHealthCheck[];
  summary: {
    total_checks: number;
    healthy_count: number;
    degraded_count: number;
    unhealthy_count: number;
  };
}

/**
 * Run all auth health checks and return a combined report.
 */
export async function getAuthHealth(sql: Sql): Promise<AuthHealthReport> {
  const checks: AuthHealthCheck[] = [];

  // Run all checks in parallel
  const [dbCheck, sessionCheck, tokenCheck, loginAttemptCheck] = await Promise.all([
    checkDatabaseHealth(sql),
    checkSessionCleanupHealth(sql),
    checkTokenHealth(sql),
    checkLoginAttemptHealth(sql),
  ]);

  checks.push(dbCheck, sessionCheck, tokenCheck, loginAttemptCheck);

  const summary = {
    total_checks: checks.length,
    healthy_count: checks.filter((c) => c.status === "healthy").length,
    degraded_count: checks.filter((c) => c.status === "degraded").length,
    unhealthy_count: checks.filter((c) => c.status === "unhealthy").length,
  };

  // Overall status is the worst status among all checks
  let overallStatus: HealthStatus = "healthy";
  if (checks.some((c) => c.status === "unhealthy")) overallStatus = "unhealthy";
  else if (checks.some((c) => c.status === "degraded")) overallStatus = "degraded";

  return {
    overall_status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
    summary,
  };
}

/**
 * Check database connectivity and query latency.
 */
async function checkDatabaseHealth(sql: Sql): Promise<AuthHealthCheck> {
  const start = Date.now();
  try {
    const [result] = await sql`SELECT 1 as check`;
    const latency = Date.now() - start;
    if (latency > 5000) {
      return {
        component: "database",
        status: "degraded",
        latency_ms: latency,
        message: "Database latency is high",
        details: { latency_ms: latency },
      };
    }
    return {
      component: "database",
      status: "healthy",
      latency_ms: latency,
      message: "Database connectivity OK",
      details: { latency_ms: latency },
    };
  } catch (err) {
    return {
      component: "database",
      status: "unhealthy",
      latency_ms: Date.now() - start,
      message: `Database error: ${err instanceof Error ? err.message : "Unknown error"}`,
      details: { error: String(err) },
    };
  }
}

/**
 * Check session cleanup health — are expired sessions being cleaned up?
 */
async function checkSessionCleanupHealth(sql: Sql): Promise<AuthHealthCheck> {
  const start = Date.now();
  try {
    // Check if cleanup is running by looking at recent session deletions
    const [result] = await sql<{ count: number; oldest_expired: Date | null }[]>`
      SELECT
        COUNT(*)::int as count,
        MIN(expires_at) as oldest_expired
      FROM auth.sessions
      WHERE expires_at < NOW() - INTERVAL '1 hour'
    `;

    const expiredCount = result?.count ?? 0;
    const oldestExpired = result?.oldest_expired;

    // If there are more than 1000 expired sessions older than 1 hour, cleanup might be behind
    if (expiredCount > 1000) {
      return {
        component: "session_cleanup",
        status: "degraded",
        latency_ms: Date.now() - start,
        message: `${expiredCount} expired sessions not cleaned up`,
        details: { expired_count: expiredCount, oldest_expired: oldestExpired },
      };
    }

    return {
      component: "session_cleanup",
      status: "healthy",
      latency_ms: Date.now() - start,
      message: "Session cleanup is healthy",
      details: { expired_count: expiredCount },
    };
  } catch (err) {
    return {
      component: "session_cleanup",
      status: "unhealthy",
      latency_ms: Date.now() - start,
      message: `Session cleanup check failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      details: { error: String(err) },
    };
  }
}

/**
 * Check token health — expiration rates and validity.
 */
async function checkTokenHealth(sql: Sql): Promise<AuthHealthCheck> {
  const start = Date.now();
  try {
    // Check the ratio of expired to active tokens
    const [stats] = await sql<{ active: number; expiring_soon: number; expired_recently: number }[]>`
      SELECT
        COUNT(*) FILTER (WHERE expires_at > NOW())::int as active,
        COUNT(*) FILTER (WHERE expires_at > NOW() AND expires_at < NOW() + INTERVAL '1 hour')::int as expiring_soon,
        COUNT(*) FILTER (WHERE expires_at > NOW() - INTERVAL '1 hour' AND expires_at <= NOW())::int as expired_recently
      FROM auth.sessions
    `;

    const active = stats?.active ?? 0;
    const expiringSoon = stats?.expiring_soon ?? 0;
    const expiredRecently = stats?.expired_recently ?? 0;

    // If more than 50% of tokens expired recently, might indicate issues
    const expirationRate = active + expiredRecently > 0
      ? expiredRecently / (active + expiredRecently)
      : 0;

    if (expirationRate > 0.5) {
      return {
        component: "token_health",
        status: "degraded",
        latency_ms: Date.now() - start,
        message: "High token expiration rate detected",
        details: { active, expiring_soon, expired_recently, expiration_rate: expirationRate },
      };
    }

    return {
      component: "token_health",
      status: "healthy",
      latency_ms: Date.now() - start,
      message: "Token health is good",
      details: { active, expiring_soon, expired_recently },
    };
  } catch (err) {
    return {
      component: "token_health",
      status: "unhealthy",
      latency_ms: Date.now() - start,
      message: `Token health check failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      details: { error: String(err) },
    };
  }
}

/**
 * Check login attempt health — are there suspicious failed login patterns?
 */
async function checkLoginAttemptHealth(sql: Sql): Promise<AuthHealthCheck> {
  const start = Date.now();
  try {
    // Check failed login attempts in the last 5 minutes
    const [result] = await sql<{ failed_count: number; blocked_count: number }[]>`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'login_failed')::int as failed_count,
        COUNT(*) FILTER (WHERE event_type = 'login_blocked')::int as blocked_count
      FROM auth.login_events
      WHERE created_at > NOW() - INTERVAL '5 minutes'
    `;

    const failedCount = result?.failed_count ?? 0;
    const blockedCount = result?.blocked_count ?? 0;

    // More than 20 failed attempts in 5 minutes suggests potential attack
    if (failedCount > 20 || blockedCount > 10) {
      return {
        component: "login_attempts",
        status: "degraded",
        latency_ms: Date.now() - start,
        message: "Elevated failed login attempts detected",
        details: { failed_count: failedCount, blocked_count: blockedCount },
      };
    }

    return {
      component: "login_attempts",
      status: "healthy",
      latency_ms: Date.now() - start,
      message: "Login attempt patterns are normal",
      details: { failed_count: failedCount, blocked_count: blockedCount },
    };
  } catch (err) {
    return {
      component: "login_attempts",
      status: "unhealthy",
      latency_ms: Date.now() - start,
      message: `Login attempt check failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      details: { error: String(err) },
    };
  }
}

/**
 * Get a simple readiness check — is the auth service ready to accept traffic?
 */
export async function getAuthReadiness(sql: Sql): Promise<{ ready: boolean; reason: string | null }> {
  try {
    // Quick database check
    await sql`SELECT 1`;
    return { ready: true, reason: null };
  } catch {
    return { ready: false, reason: "Database not reachable" };
  }
}

/**
 * Get a simple liveness check — is the auth service alive?
 */
export async function getAuthLiveness(): Promise<{ alive: boolean; timestamp: string }> {
  return { alive: true, timestamp: new Date().toISOString() };
}
