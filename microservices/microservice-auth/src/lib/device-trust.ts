/**
 * Device trust scoring — computes a trust score (0–100) per device
 * based on login history, age, verification status, and failed attempts.
 *
 * Higher score = more trusted = less likely to need step-up auth.
 * Scores are updated after each login event and can trigger risk-based
 * step-up authentication (MFA, passkey challenge, etc.).
 */

import type { Sql } from "postgres";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface DeviceTrust {
  device_id: string;
  user_id: string;
  trust_score: number;
  login_count: number;
  successful_logins: number;
  failed_logins: number;
  last_successful_at: string | null;
  last_failed_at: string | null;
  first_seen_at: string;
  is_verified: boolean;
  risk_level: RiskLevel;
  metadata: Record<string, unknown>;
  updated_at: string;
}

interface TrustFactors {
  loginCount: number;
  successfulLogins: number;
  failedLogins: number;
  deviceAgeDays: number;
  isVerified: boolean;
  lastSuccessfulAt: Date | null;
  lastFailedAt: Date | null;
}

const TRUST_SCORE_WEIGHTS = {
  successfulLogin: 3,    // +3 per successful login (capped contribution)
  failedLogin: -5,       // -5 per failed login
  verifiedDevice: 20,    // +20 if verified (e.g. passkey enrolled)
  baseScore: 50,         // starting score
  maxScore: 100,
  minScore: 0,
} as const;

function computeScore(factors: TrustFactors): number {
  let score = TRUST_SCORE_WEIGHTS.baseScore;

  // Successful logins: +3 each, max +30
  const successfulContribution = Math.min(factors.successfulLogins * TRUST_SCORE_WEIGHTS.successfulLogin, 30);
  score += successfulContribution;

  // Failed logins: -5 each, uncapped (but floor at 0)
  const failedContribution = factors.failedLogins * TRUST_SCORE_WEIGHTS.failedLogin;
  score += failedContribution;

  // Verified device: +20
  if (factors.isVerified) {
    score += TRUST_SCORE_WEIGHTS.verifiedDevice;
  }

  // Device age bonus: +1 per 30 days of age, max +10
  const ageBonus = Math.min(Math.floor(factors.deviceAgeDays / 30), 10);
  score += ageBonus;

  return Math.max(TRUST_SCORE_WEIGHTS.minScore, Math.min(TRUST_SCORE_WEIGHTS.maxScore, Math.round(score)));
}

function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 70) return "low";
  if (score >= 40) return "medium";
  if (score >= 20) return "high";
  return "critical";
}

/**
 * Get or create a device trust record for a device.
 */
export async function getDeviceTrust(
  sql: Sql,
  deviceId: string,
): Promise<DeviceTrust | null> {
  const [row] = await sql<DeviceTrust[]>`
    SELECT * FROM auth.device_trust WHERE device_id = ${deviceId}
  `;
  return row ?? null;
}

/**
 * Initialize or refresh a device trust record after a login attempt.
 */
export async function refreshDeviceTrust(
  sql: Sql,
  deviceId: string,
  userId: string,
  opts: {
    successful?: boolean;
    isVerified?: boolean;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<DeviceTrust> {
  const existing = await getDeviceTrust(sql, deviceId);

  if (existing) {
    const updated = await sql<DeviceTrust[]>`
      UPDATE auth.device_trust SET
        login_count = login_count + 1,
        successful_logins = successful_logins + ${opts.successful ? 1 : 0},
        failed_logins = failed_logins + ${opts.successful ? 0 : 1},
        last_successful_at = CASE WHEN ${opts.successful} THEN NOW() ELSE last_successful_at END,
        last_failed_at = CASE WHEN ${!opts.successful} THEN NOW() ELSE last_failed_at END,
        is_verified = COALESCE(${opts.isVerified}, is_verified),
        metadata = ${JSON.stringify(opts.metadata ?? existing.metadata)},
        updated_at = NOW()
      WHERE device_id = ${deviceId}
      RETURNING *
    `;
    return updated[0];
  }

  // Create new record
  const [created] = await sql<DeviceTrust[]>`
    INSERT INTO auth.device_trust (
      device_id, user_id,
      login_count, successful_logins, failed_logins,
      last_successful_at, last_failed_at,
      is_verified, metadata
    )
    VALUES (
      ${deviceId}, ${userId},
      1, ${opts.successful ? 1 : 0}, ${opts.successful ? 0 : 1},
      ${opts.successful ? sql`NOW()` : sql`NULL`},
      ${!opts.successful ? sql`NOW()` : sql`NULL`},
      ${opts.isVerified ?? false},
      ${JSON.stringify(opts.metadata ?? {})}
    )
    RETURNING *
  `;
  return created;
}

/**
 * Get the computed trust score and risk level for a device.
 * Recomputes on-the-fly from the stored record.
 */
export async function getDeviceTrustScore(
  sql: Sql,
  deviceId: string,
): Promise<{ score: number; riskLevel: RiskLevel } | null> {
  const trust = await getDeviceTrust(sql, deviceId);
  if (!trust) return null;

  const now = new Date();
  const firstSeen = new Date(trust.first_seen_at);
  const deviceAgeDays = (now.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24);

  const score = computeScore({
    loginCount: trust.login_count,
    successfulLogins: trust.successful_logins,
    failedLogins: trust.failed_logins,
    deviceAgeDays,
    isVerified: trust.is_verified,
    lastSuccessfulAt: trust.last_successful_at ? new Date(trust.last_successful_at) : null,
    lastFailedAt: trust.last_failed_at ? new Date(trust.last_failed_at) : null,
  });

  return { score, riskLevel: scoreToRiskLevel(score) };
}

/**
 * Mark a device as verified (e.g. after successful passkey enrollment).
 */
export async function markDeviceVerified(
  sql: Sql,
  deviceId: string,
): Promise<DeviceTrust | null> {
  const [updated] = await sql<DeviceTrust[]>`
    UPDATE auth.device_trust SET
      is_verified = TRUE,
      updated_at = NOW()
    WHERE device_id = ${deviceId}
    RETURNING *
  `;
  return updated ?? null;
}

/**
 * List all devices for a user sorted by trust score (highest first).
 */
export async function listUserDevicesByTrust(
  sql: Sql,
  userId: string,
): Promise<DeviceTrust[]> {
  return sql<DeviceTrust[]>`
    SELECT dt.* FROM auth.device_trust dt
    JOIN auth.devices d ON d.device_id = dt.device_id
    WHERE d.user_id = ${userId}
    ORDER BY dt.trust_score DESC
  `;
}

/**
 * Get all high-risk devices for a user (score < 40).
 */
export async function listHighRiskDevices(
  sql: Sql,
  userId: string,
): Promise<DeviceTrust[]> {
  return sql<DeviceTrust[]>`
    SELECT dt.* FROM auth.device_trust dt
    JOIN auth.devices d ON d.device_id = dt.device_id
    WHERE d.user_id = ${userId}
      AND dt.trust_score < 40
    ORDER BY dt.trust_score ASC
  `;
}

/**
 * Record a device's verification status at login time and recompute score.
 */
export async function recordDeviceLoginAndScore(
  sql: Sql,
  deviceId: string,
  userId: string,
  opts: {
    successful: boolean;
    isVerified?: boolean;
    metadata?: Record<string, unknown>;
  },
): Promise<DeviceTrust> {
  const refreshed = await refreshDeviceTrust(sql, deviceId, userId, opts);
  const now = new Date();
  const firstSeen = new Date(refreshed.first_seen_at);
  const deviceAgeDays = (now.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24);

  const score = computeScore({
    loginCount: refreshed.login_count,
    successfulLogins: refreshed.successful_logins,
    failedLogins: refreshed.failed_logins,
    deviceAgeDays,
    isVerified: refreshed.is_verified,
    lastSuccessfulAt: refreshed.last_successful_at ? new Date(refreshed.last_successful_at) : null,
    lastFailedAt: refreshed.last_failed_at ? new Date(refreshed.last_failed_at) : null,
  });

  const riskLevel = scoreToRiskLevel(score);

  const [updated] = await sql<DeviceTrust[]>`
    UPDATE auth.device_trust SET
      trust_score = ${score},
      risk_level = ${riskLevel},
      updated_at = NOW()
    WHERE device_id = ${deviceId}
    RETURNING *
  `;
  return updated;
}
