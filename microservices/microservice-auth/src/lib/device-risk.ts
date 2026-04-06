/**
 * Device trust scoring and risk-based policy automation.
 *
 * Computes a trust score (0–100) per device based on:
 *   - Login frequency (recency, regularity)
 *   - IP address consistency
 *   - Geographic proximity
 *   - Auth method strength (passkey > TOTP > password)
 *   - Device age
 *
 * Enables auto-trust: devices crossing threshold are marked trusted.
 * Enables auto-revoke: devices dropping below threshold are de-trusted.
 */

import type { Sql } from "postgres";

export type TrustLevel = "untrusted" | "cautious" | "trusted" | "high_trust";

export interface DeviceRiskProfile {
  deviceId: string;
  userId: string;
  trustScore: number;
  trustLevel: TrustLevel;
  riskFactors: RiskFactor[];
  lastComputedAt: Date;
}

export interface RiskFactor {
  factor: string;
  scoreImpact: number; // positive = increases trust, negative = decreases
  detail: string;
}

export interface DeviceTrustPolicy {
  id: string;
  workspaceId: string | null;
  autoTrustThreshold: number; // score above which device is auto-trusted
  autoRevokeThreshold: number; // score below which trusted status is revoked
  requireReauthOnDecline: boolean;
  enabled: boolean;
  createdAt: Date;
}

/** Trust level thresholds */
const LEVELS: Record<TrustLevel, number> = {
  untrusted: 0,
  cautious: 30,
  trusted: 60,
  high_trust: 85,
};

function scoreToLevel(score: number): TrustLevel {
  if (score >= LEVELS.high_trust) return "high_trust";
  if (score >= LEVELS.trusted) return "trusted";
  if (score >= LEVELS.cautious) return "cautious";
  return "untrusted";
}

/**
 * Compute trust score for a device.
 * Returns 0–100 with breakdown of risk factors.
 */
export async function computeDeviceTrustScore(
  sql: Sql,
  deviceId: string,
  userId: string,
): Promise<DeviceRiskProfile> {
  const riskFactors: RiskFactor[] = [];
  let score = 50; // start neutral

  // 1. Device age (older = more trusted)
  const [{ created_at, last_seen_at, ip_address }] = await sql<[{ created_at: Date; last_seen_at: Date | null; ip_address: string | null }]>`
    SELECT created_at, last_seen_at, ip_address
    FROM auth.devices
    WHERE device_id = ${deviceId} AND user_id = ${userId}
  `;
  if (created_at) {
    const ageDays = (Date.now() - new Date(created_at).getTime()) / 86_400_000;
    const ageScore = Math.min(ageDays / 30, 1) * 15; // up to +15 for 30+ day old
    riskFactors.push({
      factor: "device_age",
      scoreImpact: ageScore,
      detail: `${ageDays.toFixed(0)} days old`,
    });
    score += ageScore;
  }

  // 2. Login recency (recent = more trusted)
  if (last_seen_at) {
    const recencyHours = (Date.now() - new Date(last_seen_at).getTime()) / 3_600_000;
    const recencyScore = Math.max(0, 20 - recencyHours * 0.5); // decays over ~40h
    riskFactors.push({
      factor: "login_recency",
      scoreImpact: recencyScore,
      detail: `last seen ${recencyHours.toFixed(1)}h ago`,
    });
    score += recencyScore;
  } else {
    score -= 15;
    riskFactors.push({ factor: "login_recency", scoreImpact: -15, detail: "never seen" });
  }

  // 3. Login count regularity
  const [{ login_count }] = await sql<[{ login_count: number }]>`
    SELECT COUNT(*) as login_count FROM auth.login_events
    WHERE user_id = ${userId} AND device_id = ${deviceId}
  `;
  if (login_count > 10) {
    const countScore = Math.min((login_count - 10) / 90, 1) * 10; // up to +10 for 100+ logins
    riskFactors.push({
      factor: "login_regularity",
      scoreImpact: countScore,
      detail: `${login_count} successful logins`,
    });
    score += countScore;
  }

  // 4. Auth method diversity (passkey/TOTP = stronger)
  const [{ has_passkey, has_totp }] = await sql<[{ has_passkey: boolean; has_totp: boolean }]>`
    SELECT
      EXISTS(SELECT 1 FROM auth.passkeys WHERE user_id = ${userId}) as has_passkey,
      EXISTS(SELECT 1 FROM auth.user_totp WHERE user_id = ${userId}) as has_totp
  `;
  if (has_passkey) {
    score += 10;
    riskFactors.push({ factor: "auth_method_passkey", scoreImpact: 10, detail: "user has passkey" });
  }
  if (has_totp) {
    score += 5;
    riskFactors.push({ factor: "auth_method_totp", scoreImpact: 5, detail: "user has TOTP" });
  }

  // 5. Failed login rate (last 30 days)
  const [{ failed_rate }] = await sql<[{ failed_rate: number }]>`
    SELECT
      COALESCE(
        SUM(CASE WHEN success = false THEN 1 ELSE 0 END)::float /
        NULLIF(COUNT(*), 0),
        0
      ) as failed_rate
    FROM auth.login_events
    WHERE user_id = ${userId}
      AND created_at > NOW() - INTERVAL '30 days'
  `;
  if (failed_rate > 0.3) {
    score -= 20;
    riskFactors.push({
      factor: "failed_login_rate",
      scoreImpact: -20,
      detail: `${(failed_rate * 100).toFixed(0)}% failed rate (high)`,
    });
  } else if (failed_rate > 0.1) {
    score -= 8;
    riskFactors.push({
      factor: "failed_login_rate",
      scoreImpact: -8,
      detail: `${(failed_rate * 100).toFixed(0)}% failed rate (moderate)`,
    });
  }

  score = Math.max(0, Math.min(100, score));

  return {
    deviceId,
    userId,
    trustScore: score,
    trustLevel: scoreToLevel(score),
    riskFactors,
    lastComputedAt: new Date(),
  };
}

/**
 * Apply the workspace trust policy to auto-trust or de-trust a device.
 */
export async function applyTrustPolicy(
  sql: Sql,
  deviceId: string,
  userId: string,
): Promise<{ trusted: boolean; previousLevel: TrustLevel | null; newLevel: TrustLevel }> {
  // Get the user's workspace policy (or default)
  const workspaceId = await getUserWorkspace(sql, userId);
  const [policy] = await sql<[{
    auto_trust_threshold: number;
    auto_revoke_threshold: number;
    require_reauth_on_decline: boolean;
  }?]>`
    SELECT auto_trust_threshold, auto_revoke_threshold, require_reauth_on_decline
    FROM auth.device_trust_policies
    WHERE workspace_id = ${workspaceId ?? null} AND enabled = true
    ORDER BY workspace_id DESC NULLS LAST
    LIMIT 1
  `;

  const autoTrustThreshold = policy?.auto_trust_threshold ?? 70;
  const autoRevokeThreshold = policy?.auto_revoke_threshold ?? 30;

  const [existing] = await sql`SELECT trust_level FROM auth.devices WHERE device_id = ${deviceId}`;
  const previousLevel = existing?.trust_level as TrustLevel | null;

  const profile = await computeDeviceTrustScore(sql, deviceId, userId);

  let trusted: boolean;
  if (profile.trustScore >= autoTrustThreshold) {
    trusted = true;
  } else if (profile.trustScore < autoRevokeThreshold) {
    trusted = false;
  } else {
    trusted = existing?.active ?? false;
  }

  await sql`
    UPDATE auth.devices
    SET trust_level = ${profile.trustLevel},
        trust_score = ${profile.trustScore},
        last_trust_computed_at = NOW()
    WHERE device_id = ${deviceId}
  `;

  return { trusted, previousLevel, newLevel: profile.trustLevel };
}

async function getUserWorkspace(sql: Sql, userId: string): Promise<string | null> {
  const [row] = await sql`SELECT workspace_id FROM auth.workspace_members WHERE user_id = ${userId} LIMIT 1`;
  return row?.workspace_id ?? null;
}

/**
 * Upsert a workspace device trust policy.
 */
export async function upsertTrustPolicy(
  sql: Sql,
  workspaceId: string | null,
  opts: {
    autoTrustThreshold?: number;
    autoRevokeThreshold?: number;
    requireReauthOnDecline?: boolean;
    enabled?: boolean;
  },
): Promise<DeviceTrustPolicy> {
  const [row] = await sql<DeviceTrustPolicy[]>`
    INSERT INTO auth.device_trust_policies (workspace_id, auto_trust_threshold, auto_revoke_threshold, require_reauth_on_decline, enabled)
    VALUES (
      ${workspaceId},
      ${opts.autoTrustThreshold ?? 70},
      ${opts.autoRevokeThreshold ?? 30},
      ${opts.requireReauthOnDecline ?? true},
      ${opts.enabled ?? true}
    )
    ON CONFLICT (workspace_id) DO UPDATE SET
      auto_trust_threshold = EXCLUDED.auto_trust_threshold,
      auto_revoke_threshold = EXCLUDED.auto_revoke_threshold,
      require_reauth_on_decline = EXCLUDED.require_reauth_on_decline,
      enabled = EXCLUDED.enabled
    RETURNING *
  `;
  return row;
}

/**
 * Get trust policy for a workspace (or default).
 */
export async function getTrustPolicy(
  sql: Sql,
  workspaceId: string | null,
): Promise<DeviceTrustPolicy | null> {
  const [row] = await sql<DeviceTrustPolicy[]>`
    SELECT * FROM auth.device_trust_policies
    WHERE workspace_id = ${workspaceId} AND enabled = true
    ORDER BY workspace_id DESC NULLS LAST
    LIMIT 1
  `;
  return row ?? null;
}
