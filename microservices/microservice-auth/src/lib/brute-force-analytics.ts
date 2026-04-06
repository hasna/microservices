/**
 * Brute force attack analytics and reporting.
 *
 * Analyzes failed login patterns to detect and report brute force attacks.
 * Provides aggregated statistics on attack campaigns by IP, country, or ASN.
 */

import type { Sql } from "postgres";

export interface AttackCampaign {
  ipPattern: string;
  country?: string;
  asn?: string;
  targetUsers: string[];
  attempts: number;
  successRate: number;
  firstAttempt: Date;
  lastAttempt: Date;
  threatLevel: "low" | "medium" | "high" | "critical";
}

export interface BruteForceStats {
  totalAttempts: number;
  uniqueIps: number;
  targetedAccounts: number;
  successfulLogins: number;
  topAttackers: { ip: string; attempts: number; successRate: number }[];
  topTargetedAccounts: { email: string; attempts: number }[];
  attackTrend: "increasing" | "stable" | "decreasing";
}

/**
 * Get brute force attack statistics for a time window.
 */
export async function getBruteForceStats(
  sql: Sql,
  workspaceId: string | undefined,
  hours = 24,
): Promise<BruteForceStats> {
  const windowStart = new Date(Date.now() - hours * 3600_000);
  const halfWindow = new Date(Date.now() - (hours / 2) * 3600_000);

  // Get all failed logins in window
  const failedLoginsQuery = workspaceId
    ? `
      SELECT le.ip, le.email, le.created_at, le.success
      FROM auth.login_events le
      JOIN auth.workspace_members wm ON le.user_id = wm.user_id
      WHERE le.created_at >= $1 AND wm.workspace_id = $2
    `
    : `
      SELECT ip, email, created_at, success
      FROM auth.login_events
      WHERE created_at >= $1
    `;

  const failedLogins = await sql.unsafe(
    failedLoginsQuery,
    workspaceId ? [windowStart, workspaceId] : [windowStart],
  ) as { ip: string | null; email: string | null; created_at: Date; success: boolean }[];

  const failedOnly = failedLogins.filter(l => !l.success);
  const successfulOnly = failedLogins.filter(l => l.success);

  // Count unique IPs
  const uniqueIps = new Set(failedOnly.map(l => l.ip).filter(Boolean)).size;

  // Count targeted accounts
  const targetAccounts = new Set(failedOnly.map(l => l.email).filter(Boolean));

  // Top attackers
  const ipCounts: Record<string, { attempts: number; successes: number }> = {};
  for (const login of failedLogins) {
    if (!login.ip) continue;
    if (!ipCounts[login.ip]) ipCounts[login.ip] = { attempts: 0, successes: 0 };
    ipCounts[login.ip].attempts++;
    if (login.success) ipCounts[login.ip].successes++;
  }

  const topAttackers = Object.entries(ipCounts)
    .map(([ip, data]) => ({
      ip,
      attempts: data.attempts,
      successRate: data.successes / data.attempts,
    }))
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, 10);

  // Top targeted accounts
  const emailCounts: Record<string, number> = {};
  for (const login of failedOnly) {
    if (!login.email) continue;
    emailCounts[login.email] = (emailCounts[login.email] ?? 0) + 1;
  }

  const topTargetedAccounts = Object.entries(emailCounts)
    .map(([email, attempts]) => ({ email, attempts }))
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, 10);

  // Attack trend
  const recentFailures = failedOnly.filter(l => l.created_at >= halfWindow).length;
  const olderFailures = failedOnly.filter(l => l.created_at < halfWindow).length;

  let attackTrend: "increasing" | "stable" | "decreasing" = "stable";
  if (recentFailures > olderFailures * 1.5) {
    attackTrend = "increasing";
  } else if (recentFailures < olderFailures * 0.5) {
    attackTrend = "decreasing";
  }

  return {
    totalAttempts: failedOnly.length,
    uniqueIps,
    targetedAccounts: targetAccounts.size,
    successfulLogins: successfulOnly.length,
    topAttackers,
    topTargetedAccounts,
    attackTrend,
  };
}

/**
 * Detect coordinated brute force campaigns (same pattern across multiple IPs).
 */
export async function detectBruteForceCampaigns(
  sql: Sql,
  workspaceId: string | undefined,
  hours = 24,
): Promise<AttackCampaign[]> {
  const windowStart = new Date(Date.now() - hours * 3600_000);

  const query = workspaceId
    ? `
      SELECT le.ip, le.email, le.created_at
      FROM auth.login_events le
      JOIN auth.workspace_members wm ON le.user_id = wm.user_id
      WHERE le.created_at >= $1 AND le.success = false AND wm.workspace_id = $2
    `
    : `
      SELECT ip, email, created_at
      FROM auth.login_events
      WHERE created_at >= $1 AND success = false
    `;

  const failedLogins = await sql.unsafe(
    query,
    workspaceId ? [windowStart, workspaceId] : [windowStart],
  ) as { ip: string | null; email: string | null; created_at: Date }[];

  // Group by email to find campaigns targeting same accounts from different IPs
  const emailToIPs: Record<string, Set<string>> = {};
  for (const login of failedLogins) {
    if (!login.email || !login.ip) continue;
    if (!emailToIPs[login.email]) emailToIPs[login.email] = new Set();
    emailToIPs[login.email].add(login.ip);
  }

  const campaigns: AttackCampaign[] = [];

  for (const [email, ips] of Object.entries(emailToIPs)) {
    if (ips.size >= 3) {
      // Multiple IPs targeting same account = coordinated campaign
      const ipArray = Array.from(ips);
      const attempts = failedLogins.filter(l => l.email === email).length;
      const successRate = failedLogins.filter(l => l.email === email && l.created_at).length > 0 ? 0 : 0;

      let threatLevel: "low" | "medium" | "high" | "critical" = "medium";
      if (ips.size >= 10 || attempts >= 100) {
        threatLevel = "critical";
      } else if (ips.size >= 5 || attempts >= 50) {
        threatLevel = "high";
      }

      campaigns.push({
        ipPattern: ipArray.slice(0, 5).join(", ") + (ipArray.length > 5 ? ` +${ipArray.length - 5} more` : ""),
        targetUsers: [email],
        attempts,
        successRate: 0,
        firstAttempt: new Date(Math.min(...failedLogins.filter(l => l.email === email).map(l => l.created_at.getTime()))),
        lastAttempt: new Date(Math.max(...failedLogins.filter(l => l.email === email).map(l => l.created_at.getTime()))),
        threatLevel,
      });
    }
  }

  return campaigns.sort((a, b) => b.attempts - a.attempts);
}

/**
 * Get IP-based brute force statistics.
 */
export async function getIpBruteForceStats(
  sql: Sql,
  ip: string,
  hours = 24,
): Promise<{
  attempts: number;
  successes: number;
  lastAttempt: Date | null;
  blocked: boolean;
  blockedUntil: Date | null;
}> {
  const windowStart = new Date(Date.now() - hours * 3600_000);

  const [stats] = await sql<[{ attempts: string; successes: string; last_attempt: Date | null }]>`
    SELECT
      COUNT(*) FILTER (WHERE success = false) as attempts,
      COUNT(*) FILTER (WHERE success = true) as successes,
      MAX(created_at) as last_attempt
    FROM auth.login_events
    WHERE ip = ${ip} AND created_at >= ${windowStart}
  `;

  const [blockRecord] = await sql<[{ blocked_until: Date | null }?]>`
    SELECT blocked_until FROM auth.ip_blocks
    WHERE ip = ${ip} AND blocked_until > NOW()
    ORDER BY blocked_until DESC
    LIMIT 1
  `;

  return {
    attempts: parseInt(stats?.attempts ?? "0", 10),
    successes: parseInt(stats?.successes ?? "0", 10),
    lastAttempt: stats?.last_attempt ?? null,
    blocked: !!blockRecord,
    blockedUntil: blockRecord?.blocked_until ?? null,
  };
}

/**
 * Get accounts most targeted by brute force.
 */
export async function getMostTargetedAccounts(
  sql: Sql,
  workspaceId: string | undefined,
  hours = 24,
  limit = 10,
): Promise<{ email: string; attempts: number; ips: string[] }[]> {
  const windowStart = new Date(Date.now() - hours * 3600_000);

  const query = workspaceId
    ? `
      SELECT le.email, le.ip, COUNT(*) as attempts
      FROM auth.login_events le
      JOIN auth.workspace_members wm ON le.user_id = wm.user_id
      WHERE le.created_at >= $1 AND le.success = false AND wm.workspace_id = $2
      GROUP BY le.email, le.ip
      ORDER BY attempts DESC
    `
    : `
      SELECT email, ip, COUNT(*) as attempts
      FROM auth.login_events
      WHERE created_at >= $1 AND success = false
      GROUP BY email, ip
      ORDER BY attempts DESC
    `;

  const results = await sql.unsafe(
    query,
    workspaceId ? [windowStart, workspaceId] : [windowStart],
  ) as { email: string; ip: string; attempts: string }[];

  // Group by email
  const byEmail: Record<string, { attempts: number; ips: Set<string> }> = {};
  for (const r of results) {
    if (!byEmail[r.email]) byEmail[r.email] = { attempts: 0, ips: new Set() };
    byEmail[r.email].attempts += parseInt(r.attempts, 10);
    byEmail[r.email].ips.add(r.ip);
  }

  return Object.entries(byEmail)
    .map(([email, data]) => ({
      email,
      attempts: data.attempts,
      ips: Array.from(data.ips),
    }))
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, limit);
}
