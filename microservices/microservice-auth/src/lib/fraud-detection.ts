/**
 * Login fraud detection — detect suspicious login patterns.
 * Checks for: impossible travel, new device/IP, unusual timing, velocity anomalies.
 */

import type { Sql } from "postgres";

export interface LoginFraudSignal {
  signal: string;
  severity: "low" | "medium" | "high";
  detail: string;
  score_delta: number;
}

export interface FraudCheckResult {
  safe: boolean;
  total_score: number;
  signals: LoginFraudSignal[];
}

/**
 * Calculate approximate distance between two IP-based geo points (km).
 * Uses a simple integer-based lat/lon estimation for speed.
 */
function ipDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = lat1 - lat2;
  const dLon = lon1 - lon2;
  // Rough conversion: 1 degree ~ 111 km
  return Math.sqrt(dLat * dLat + dLon * dLon) * 111;
}

/**
 * Impossible travel: detect if a user logged in from two distant locations
 * within a time window that makes travel impossible.
 */
export async function checkImpossibleTravel(
  sql: Sql,
  userId: string,
  currentIpLat: number,
  currentIpLon: number,
  currentTimestamp: Date,
  windowHours = 6,
): Promise<LoginFraudSignal | null> {
  const [lastLogin] = await sql<any[]>`
    SELECT le.ip_lat, le.ip_lon, le.created_at, le.ip_address
    FROM auth.login_events le
    WHERE le.user_id = ${userId}
      AND le.event_type = 'login_success'
      AND le.ip_lat IS NOT NULL
      AND le.created_at > NOW() - INTERVAL '${String(windowHours)} hours'
    ORDER BY le.created_at DESC
    LIMIT 1
  `;

  if (!lastLogin || lastLogin.ip_lat == null) return null;

  const distance = ipDistanceKm(
    currentIpLat, currentIpLon,
    lastLogin.ip_lat, lastLogin.ip_lon,
  );

  const timeDiffHours = (currentTimestamp.getTime() - new Date(lastLogin.created_at).getTime()) / 3600000;
  const maxTravelKm = timeDiffHours * 900; // Assume max 900 km/h (fast plane)

  if (distance > maxTravelKm) {
    return {
      signal: "impossible_travel",
      severity: "high",
      detail: `Login from ${Math.round(distance)}km away within ${Math.round(timeDiffHours)}h (max possible: ${Math.round(maxTravelKm)}km)`,
      score_delta: 40,
    };
  }

  if (distance > maxTravelKm * 0.7) {
    return {
      signal: "unlikely_travel",
      severity: "medium",
      detail: `Login from a distant location (${Math.round(distance)}km)`,
      score_delta: 20,
    };
  }

  return null;
}

/**
 * Check if this is a new device for the user.
 */
export async function checkNewDevice(
  sql: Sql,
  userId: string,
  deviceFingerprint: string,
): Promise<LoginFraudSignal | null> {
  if (!deviceFingerprint) return null;

  const [existing] = await sql<any[]>`
    SELECT COUNT(*) as count FROM auth.login_events
    WHERE user_id = ${userId}
      AND event_type = 'login_success'
      AND device_fingerprint = ${deviceFingerprint}
  `;

  if (parseInt(existing?.count ?? "0") === 0) {
    return {
      signal: "new_device",
      severity: "low",
      detail: "First login from this device",
      score_delta: 10,
    };
  }

  return null;
}

/**
 * Check login velocity — too many logins in a short window.
 */
export async function checkLoginVelocity(
  sql: Sql,
  userId: string,
  windowMinutes = 60,
  maxAttempts = 5,
): Promise<LoginFraudSignal | null> {
  const [row] = await sql<any[]>`
    SELECT COUNT(*) as count FROM auth.login_events
    WHERE user_id = ${userId}
      AND event_type IN ('login_success', 'login_failed')
      AND created_at > NOW() - INTERVAL '${String(windowMinutes)} minutes'
  `;

  const count = parseInt(row?.count ?? "0");
  if (count > maxAttempts) {
    return {
      signal: "high_velocity",
      severity: count > maxAttempts * 2 ? "high" : "medium",
      detail: `${count} login attempts in the last ${windowMinutes} minutes`,
      score_delta: Math.min(count * 5, 30),
    };
  }

  return null;
}

/**
 * Check for credentials stuffing — many failed attempts across different users from same IP.
 */
export async function checkCredentialStuffing(
  sql: Sql,
  ipAddress: string,
  windowMinutes = 30,
  maxUniqueUsers = 3,
): Promise<LoginFraudSignal | null> {
  const [row] = await sql<any[]>`
    SELECT COUNT(DISTINCT user_id) as unique_users FROM auth.login_events
    WHERE ip_address = ${ipAddress}
      AND event_type = 'login_failed'
      AND created_at > NOW() - INTERVAL '${String(windowMinutes)} minutes'
  `;

  const uniqueUsers = parseInt(row?.unique_users ?? "0");
  if (uniqueUsers >= maxUniqueUsers) {
    return {
      signal: "credential_stuffing",
      severity: "high",
      detail: `${uniqueUsers} different accounts attempted from this IP in ${windowMinutes}min`,
      score_delta: 50,
    };
  }

  return null;
}

/**
 * Run all fraud checks and return a combined result.
 */
export async function checkLoginFraud(
  sql: Sql,
  opts: {
    userId?: string;
    ipAddress: string;
    deviceFingerprint?: string;
    ipLat?: number;
    ipLon?: number;
    timestamp?: Date;
  },
): Promise<FraudCheckResult> {
  const signals: LoginFraudSignal[] = [];
  let totalScore = 0;

  if (opts.userId) {
    const [impossibleTravel, newDevice, velocity] = await Promise.all([
      opts.ipLat != null ? checkImpossibleTravel(sql, opts.userId, opts.ipLat, opts.ipLon ?? 0, opts.timestamp ?? new Date()) : null,
      opts.deviceFingerprint ? checkNewDevice(sql, opts.userId, opts.deviceFingerprint) : null,
      checkLoginVelocity(sql, opts.userId),
    ]);

    for (const s of [impossibleTravel, newDevice, velocity]) {
      if (s) { signals.push(s); totalScore += s.score_delta; }
    }
  }

  const stuffing = await checkCredentialStuffing(sql, opts.ipAddress);
  if (stuffing) { signals.push(stuffing); totalScore += stuffing.score_delta; }

  return {
    safe: totalScore < 50,
    total_score: totalScore,
    signals,
  };
}
