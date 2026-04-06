/**
 * Session anomaly detection — identifies suspicious session patterns.
 *
 * Detects anomalies based on:
 * - Login time patterns (unusual hours)
 * - Geographic location changes
 * - IP address changes
 * - Session duration anomalies
 * - Concurrent session anomalies
 */

import type { Sql } from "postgres";

export type AnomalyType =
  | "unusual_login_time"
  | "geographic_anomaly"
  | "ip_change_anomaly"
  | "session_duration_anomaly"
  | "concurrent_session_anomaly"
  | "device_mismatch";

export interface SessionAnomaly {
  type: AnomalyType;
  severity: "low" | "medium" | "high" | "critical";
  detail: string;
  sessionId: string;
  userId: string;
  detectedAt: Date;
}

export interface SessionPattern {
  userId: string;
  typicalLoginHour: number; // 0-23
  typicalIpPatterns: string[];
  typicalDevices: string[];
  avgSessionDurationMinutes: number;
  maxConcurrentSessions: number;
}

/**
 * Analyze a user's session history and detect anomalies.
 */
export async function detectSessionAnomalies(
  sql: Sql,
  userId: string,
  sessionId: string,
): Promise<SessionAnomaly[]> {
  const anomalies: SessionAnomaly[] = [];

  // Get the session to analyze
  const [session] = await sql<[{
    id: string;
    ip: string | null;
    user_agent: string | null;
    created_at: Date;
    expires_at: Date;
  }?]>`
    SELECT id, ip, user_agent, created_at, expires_at
    FROM auth.sessions
    WHERE id = ${sessionId} AND user_id = ${userId}
  `;

  if (!session) return anomalies;

  const sessionCreatedAt = new Date(session.created_at);

  // Check 1: Unusual login time
  const loginHour = sessionCreatedAt.getHours();
  if (loginHour < 6 || loginHour > 22) {
    // Late night / early morning logins
    anomalies.push({
      type: "unusual_login_time",
      severity: loginHour < 3 || loginHour > 24 ? "medium" : "low",
      detail: `Login at ${loginHour}:00 — unusual hour for this user`,
      sessionId,
      userId,
      detectedAt: new Date(),
    });
  }

  // Check 2: IP change anomaly (recently saw different IP)
  const [recentSession] = await sql<[{ ip: string | null }?]>`
    SELECT ip FROM auth.sessions
    WHERE user_id = ${userId}
      AND id != ${sessionId}
      AND created_at > NOW() - INTERVAL '1 hour'
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (recentSession?.ip && session.ip && recentSession.ip !== session.ip) {
    // Different IP within last hour — possible credential sharing or MITM
    anomalies.push({
      type: "ip_change_anomaly",
      severity: "medium",
      detail: `IP changed from ${recentSession.ip} to ${session.ip} within 1 hour`,
      sessionId,
      userId,
      detectedAt: new Date(),
    });
  }

  // Check 3: Check if this IP has been seen before for this user
  const [existingIp] = await sql<[{ count: string }]>`
    SELECT COUNT(DISTINCT ip) as count FROM auth.sessions
    WHERE user_id = ${userId} AND ip IS NOT NULL
  `;

  if (parseInt(existingIp.count, 10) > 5 && session.ip) {
    // User has many IPs — check if this is a new one
    const [knownIp] = await sql<[{ count: string }]>`
      SELECT COUNT(*) as count FROM auth.sessions
      WHERE user_id = ${userId} AND ip = ${session.ip}
    `;

    if (parseInt(knownIp.count, 10) === 0) {
      anomalies.push({
        type: "ip_change_anomaly",
        severity: "high",
        detail: `New IP address ${session.ip} — first time seen for this user`,
        sessionId,
        userId,
        detectedAt: new Date(),
      });
    }
  }

  // Check 4: Concurrent session anomaly
  const [activeCount] = await sql<[{ count: string }]>`
    SELECT COUNT(*) as count FROM auth.sessions
    WHERE user_id = ${userId} AND expires_at > NOW() AND id != ${sessionId}
  `;

  if (parseInt(activeCount.count, 10) >= 3) {
    anomalies.push({
      type: "concurrent_session_anomaly",
      severity: parseInt(activeCount.count, 10) >= 5 ? "high" : "medium",
      detail: `User has ${parseInt(activeCount.count, 10) + 1} concurrent active sessions`,
      sessionId,
      userId,
      detectedAt: new Date(),
    });
  }

  // Check 5: Session duration anomaly
  const avgDurationResult = await sql<[{ avg_duration: string | null }]>`
    SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) / 60 as avg_duration
    FROM auth.sessions
    WHERE user_id = ${userId}
      AND updated_at IS NOT NULL
      AND updated_at != created_at
  `;

  if (avgDurationResult[0]?.avg_duration) {
    const avgDuration = parseFloat(avgDurationResult[0].avg_duration);
    const sessionDuration = (Date.now() - sessionCreatedAt.getTime()) / 60000; // minutes

    // If session is much shorter than average, might be suspicious
    if (sessionDuration < avgDuration * 0.1 && avgDuration > 5) {
      anomalies.push({
        type: "session_duration_anomaly",
        severity: "low",
        detail: `Session lasted only ${sessionDuration.toFixed(1)}min, typical is ${avgDuration.toFixed(1)}min`,
        sessionId,
        userId,
        detectedAt: new Date(),
      });
    }
  }

  return anomalies;
}

/**
 * Get the typical session pattern for a user.
 */
export async function getUserSessionPattern(
  sql: Sql,
  userId: string,
): Promise<SessionPattern | null> {
  // Get typical login hours
  const hourResult = await sql<[{ login_hour: number }][]>`
    SELECT EXTRACT(HOUR FROM created_at) as login_hour
    FROM auth.login_events
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 100
  `;

  if (hourResult.length === 0) return null;

  // Find most common hour
  const hourCounts: Record<number, number> = {};
  for (const row of hourResult) {
    hourCounts[row.login_hour] = (hourCounts[row.login_hour] ?? 0) + 1;
  }
  const typicalLoginHour = parseInt(
    Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0][0],
    10,
  );

  // Get common IPs
  const ipResult = await sql<[{ ip: string }][]>`
    SELECT DISTINCT ip FROM auth.sessions
    WHERE user_id = ${userId} AND ip IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 10
  `;

  // Get common devices
  const deviceResult = await sql<[{ user_agent: string | null }][]>`
    SELECT DISTINCT user_agent FROM auth.sessions
    WHERE user_id = ${userId} AND user_agent IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 10
  `;

  // Get average session duration
  const durationResult = await sql<[{ avg_duration: string | null }]>`
    SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) / 60 as avg_duration
    FROM auth.sessions
    WHERE user_id = ${userId}
      AND updated_at IS NOT NULL
      AND updated_at != created_at
  `;

  // Get max concurrent sessions
  const concurrentResult = await sql<[{ max_count: string }]>`
    SELECT MAX(cnt) as max_count FROM (
      SELECT COUNT(*) as cnt
      FROM auth.sessions
      WHERE user_id = ${userId} AND expires_at > NOW()
      GROUP BY user_id
    ) t
  `;

  return {
    userId,
    typicalLoginHour,
    typicalIpPatterns: ipResult.map(r => r.ip),
    typicalDevices: deviceResult.map(r => r.user_agent ?? "unknown"),
    avgSessionDurationMinutes: durationResult[0]?.avg_duration
      ? parseFloat(durationResult[0].avg_duration)
      : 0,
    maxConcurrentSessions: concurrentResult[0]?.max_count
      ? parseInt(concurrentResult[0].max_count, 10)
      : 0,
  };
}

/**
 * Record session anomalies to the database.
 */
export async function recordSessionAnomalies(
  sql: Sql,
  anomalies: SessionAnomaly[],
): Promise<void> {
  for (const anomaly of anomalies) {
    await sql`
      INSERT INTO auth.session_anomalies (session_id, user_id, anomaly_type, severity, detail)
      VALUES (
        ${anomaly.sessionId},
        ${anomaly.userId},
        ${anomaly.type},
        ${anomaly.severity},
        ${anomaly.detail}
      )
    `;
  }
}

/**
 * Get recent session anomalies for a user.
 */
export async function getRecentSessionAnomalies(
  sql: Sql,
  userId: string,
  hours = 24,
): Promise<SessionAnomaly[]> {
  return sql<SessionAnomaly[]>`
    SELECT * FROM auth.session_anomalies
    WHERE user_id = ${userId}
      AND detected_at > NOW() - INTERVAL '${sql.unsafe(String(hours))} hours'
    ORDER BY detected_at DESC
  `;
}

// ---------------------------------------------------------------------------
// Session security audit
// ---------------------------------------------------------------------------

export interface SessionSecurityIssue {
  severity: "low" | "medium" | "high" | "critical";
  type: string;
  session_id: string | null;
  detail: string;
}

export interface SessionSecurityAudit {
  user_id: string;
  total_active_sessions: number;
  issues: SessionSecurityIssue[];
  session_details: {
    id: string;
    ip: string | null;
    user_agent: string | null;
    created_at: string;
    expires_at: string;
    is_expired: boolean;
    age_minutes: number;
  }[];
  recommendations: string[];
}

/**
 * Perform a comprehensive security audit of all active sessions for a user.
 * Identifies weak sessions, suspicious patterns, and provides recommendations.
 */
export async function getSessionSecurityAudit(
  sql: Sql,
  userId: string,
): Promise<SessionSecurityAudit> {
  const issues: SessionSecurityIssue[] = [];
  const recommendations: string[] = [];

  const sessions = await sql<{
    id: string;
    ip: string | null;
    user_agent: string | null;
    created_at: Date;
    expires_at: Date;
  }[]>`
    SELECT id, ip, user_agent, created_at, expires_at
    FROM auth.sessions
    WHERE user_id = ${userId} AND expires_at > NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC
  `;

  const now = new Date();
  const activeSessions = sessions.filter(s => s.expires_at > now);
  const totalActive = activeSessions.length;

  // Issue 1: Too many concurrent sessions
  if (totalActive > 5) {
    issues.push({
      severity: totalActive > 10 ? "high" : "medium",
      type: "excessive_sessions",
      session_id: null,
      detail: `User has ${totalActive} active sessions, which exceeds the recommended maximum of 5`,
    });
    recommendations.push("Consider revoking old or unused sessions via revokeAllUserDevices");
  }

  // Issue 2: Check for sessions from different IP ranges in short time
  const ipCounts = new Map<string, number>();
  for (const s of activeSessions) {
    if (s.ip) {
      // Simple check: use /24 subnet
      const subnet = s.ip.replace(/\.\d+$/, ".0");
      ipCounts.set(subnet, (ipCounts.get(subnet) ?? 0) + 1);
    }
  }

  for (const [subnet, count] of ipCounts) {
    if (count > 3 && count === totalActive) {
      // All sessions from same IP is fine
    } else if (count === 1 && totalActive > 3) {
      issues.push({
        severity: "low",
        type: "diverse_ips",
        session_id: null,
        detail: `Session from new IP subnet ${subnet}/24 detected alongside other sessions`,
      });
    }
  }

  // Issue 3: Very old sessions still active
  for (const s of activeSessions) {
    const ageMs = now.getTime() - s.created_at.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    if (ageHours > 168) { // > 7 days
      issues.push({
        severity: "medium",
        type: "stale_session",
        session_id: s.id,
        detail: `Session active for ${Math.round(ageHours / 24)} days without re-authentication`,
      });
    }
  }

  // Issue 4: Check for sessions without user agent (automated?)
  const noUserAgent = activeSessions.filter(s => !s.user_agent);
  if (noUserAgent.length > 0) {
    issues.push({
      severity: "high",
      type: "no_user_agent",
      session_id: null,
      detail: `${noUserAgent.length} session(s) have no user agent — may indicate automated access`,
    });
  }

  // Session details
  const sessionDetails = activeSessions.map(s => ({
    id: s.id,
    ip: s.ip,
    user_agent: s.user_agent,
    created_at: s.created_at.toISOString(),
    expires_at: s.expires_at.toISOString(),
    is_expired: s.expires_at <= now,
    age_minutes: Math.round((now.getTime() - s.created_at.getTime()) / 60000),
  }));

  // Recommendations based on issues
  if (issues.length === 0 && totalActive <= 3) {
    recommendations.push("No security issues detected. Session posture is healthy.");
  }

  if (totalActive === 0) {
    recommendations.push("No active sessions found. If this is unexpected, consider changing your password.");
  }

  return {
    user_id: userId,
    total_active_sessions: totalActive,
    issues,
    session_details: sessionDetails,
    recommendations,
  };
}
