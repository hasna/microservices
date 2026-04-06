/**
 * Auth risk scoring — combines multiple fraud signals into a single
 * risk score (0–100) and risk level (low/medium/high/critical) per
 * authentication event or session.
 *
 * Signals are weighted and combined to produce an actionable risk score
 * that can trigger step-up authentication (MFA, passkey challenge, etc.)
 * or block the request entirely.
 */

import type { Sql } from "postgres";
import type { FraudCheckResult } from "./fraud-detection.js";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RiskEventType = "login_risk" | "token_refresh_risk" | "api_auth_risk";

export interface AuthRiskEvent {
  id: string;
  user_id: string | null;
  session_id: string | null;
  event_type: RiskEventType;
  risk_score: number;
  risk_level: RiskLevel;
  signals: Record<string, unknown>;
  triggered_rules: string[];
  action_taken: string | null;
  ip_address: string | null;
  user_agent: string | null;
  device_id: string | null;
  created_at: string;
}

export interface RiskSignal {
  name: string;
  score: number;          // contribution to risk score (0–100)
  weight: number;         // multiplier (0.0–1.0) for how much this signal matters
  detail?: string;
  passed: boolean;
}

interface ComputeRiskOpts {
  impossibleTravel?: FraudCheckResult;
  newDevice?: FraudCheckResult;
  loginVelocity?: FraudCheckResult;
  credentialStuffing?: FraudCheckResult;
  deviceTrustScore?: number;
  ipBlockStatus?: { blocked: boolean; reason?: string };
  geoAnomaly?: boolean;
  userRiskHistory?: number; // average risk score from user's past events
}

/**
 * Weights for each fraud signal in the final risk score.
 */
const SIGNAL_WEIGHTS = {
  impossibleTravel: 0.30,
  newDevice: 0.15,
  loginVelocity: 0.15,
  credentialStuffing: 0.25,
  deviceTrust: 0.10,
  ipBlock: 0.05,
  geoAnomaly: 0.05,
  userRiskHistory: 0.05,
} as const;

function computeRiskScore(signals: RiskSignal[]): number {
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight === 0) return 0;

  const weightedSum = signals.reduce((sum, s) => sum + s.score * s.weight, 0);
  return Math.min(100, Math.max(0, Math.round(weightedSum / totalWeight)));
}

function scoreToRiskLevel(score: number): RiskLevel {
  if (score < 20) return "low";
  if (score < 50) return "medium";
  if (score < 80) return "high";
  return "critical";
}

/**
 * Compute a risk score from a set of fraud check results and contextual signals.
 */
export function computeAuthRiskScore(
  opts: ComputeRiskOpts,
): { score: number; riskLevel: RiskLevel; signals: RiskSignal[] } {
  const signals: RiskSignal[] = [];

  if (opts.impossibleTravel) {
    signals.push({
      name: "impossible_travel",
      score: opts.impossibleTravel.risk_score,
      weight: SIGNAL_WEIGHTS.impossibleTravel,
      detail: opts.impossibleTravel.reason,
      passed: opts.impossibleTravel.passed,
    });
  }

  if (opts.newDevice) {
    signals.push({
      name: "new_device",
      score: opts.newDevice.risk_score,
      weight: SIGNAL_WEIGHTS.newDevice,
      detail: opts.newDevice.reason,
      passed: opts.newDevice.passed,
    });
  }

  if (opts.loginVelocity) {
    signals.push({
      name: "login_velocity",
      score: opts.loginVelocity.risk_score,
      weight: SIGNAL_WEIGHTS.loginVelocity,
      detail: opts.loginVelocity.reason,
      passed: opts.loginVelocity.passed,
    });
  }

  if (opts.credentialStuffing) {
    signals.push({
      name: "credential_stuffing",
      score: opts.credentialStuffing.risk_score,
      weight: SIGNAL_WEIGHTS.credentialStuffing,
      detail: opts.credentialStuffing.reason,
      passed: opts.credentialStuffing.passed,
    });
  }

  if (opts.deviceTrustScore !== undefined) {
    // Low trust score = high risk
    const trustRiskScore = Math.max(0, 100 - opts.deviceTrustScore);
    signals.push({
      name: "device_trust",
      score: trustRiskScore,
      weight: SIGNAL_WEIGHTS.deviceTrust,
      detail: `device trust score: ${opts.deviceTrustScore}`,
      passed: opts.deviceTrustScore >= 50,
    });
  }

  if (opts.ipBlockStatus?.blocked) {
    signals.push({
      name: "ip_block",
      score: 100,
      weight: SIGNAL_WEIGHTS.ipBlock,
      detail: opts.ipBlockStatus.reason ?? "IP is blocked",
      passed: false,
    });
  }

  if (opts.geoAnomaly) {
    signals.push({
      name: "geo_anomaly",
      score: 70,
      weight: SIGNAL_WEIGHTS.geoAnomaly,
      detail: "login from unexpected geographic region",
      passed: false,
    });
  }

  if (opts.userRiskHistory !== undefined) {
    signals.push({
      name: "user_risk_history",
      score: opts.userRiskHistory,
      weight: SIGNAL_WEIGHTS.userRiskHistory,
      detail: `average historical risk score: ${opts.userRiskHistory}`,
      passed: opts.userRiskHistory < 50,
    });
  }

  // If no signals, return low risk
  if (signals.length === 0) {
    return { score: 0, riskLevel: "low", signals: [] };
  }

  const score = computeRiskScore(signals);
  const riskLevel = scoreToRiskLevel(score);

  return { score, riskLevel, signals };
}

/**
 * Record a risk event to the auth_risk_events table.
 */
export async function recordAuthRiskEvent(
  sql: Sql,
  opts: {
    userId?: string;
    sessionId?: string;
    eventType: RiskEventType;
    riskScore: number;
    riskLevel: RiskLevel;
    signals: Record<string, unknown>;
    triggeredRules: string[];
    actionTaken?: string;
    ipAddress?: string;
    userAgent?: string;
    deviceId?: string;
  },
): Promise<AuthRiskEvent> {
  const [row] = await sql<AuthRiskEvent[]>`
    INSERT INTO auth.auth_risk_events (
      user_id, session_id, event_type, risk_score, risk_level,
      signals, triggered_rules, action_taken,
      ip_address, user_agent, device_id
    )
    VALUES (
      ${opts.userId ?? null},
      ${opts.sessionId ?? null},
      ${opts.eventType},
      ${opts.riskScore},
      ${opts.riskLevel},
      ${JSON.stringify(opts.signals)},
      ${opts.triggeredRules},
      ${opts.actionTaken ?? null},
      ${opts.ipAddress ?? null},
      ${opts.userAgent ?? null},
      ${opts.deviceId ?? null}
    )
    RETURNING *
  `;
  return row;
}

/**
 * Get recent risk events for a user.
 */
export async function getRecentRiskEvents(
  sql: Sql,
  userId: string,
  limit = 10,
): Promise<AuthRiskEvent[]> {
  return sql<AuthRiskEvent[]>`
    SELECT * FROM auth.auth_risk_events
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

/**
 * Get the average historical risk score for a user.
 */
export async function getUserAverageRiskScore(
  sql: Sql,
  userId: string,
  daysBack = 30,
): Promise<number> {
  const [row] = await sql<{ avg: number }[]>`
    SELECT COALESCE(AVG(risk_score), 0)::real AS avg
    FROM auth.auth_risk_events
    WHERE user_id = ${userId}
      AND created_at > NOW() - INTERVAL '${sql.unsafe(String(daysBack))} days'
  `;
  return row?.avg ?? 0;
}

/**
 * Determine the recommended action based on risk level.
 */
export function getRecommendedAction(riskLevel: RiskLevel): {
  action: string;
  stepUpAuth: boolean;
  allowSession: boolean;
} {
  switch (riskLevel) {
    case "low":
      return { action: "allow", stepUpAuth: false, allowSession: true };
    case "medium":
      return { action: "step_up", stepUpAuth: true, allowSession: true };
    case "high":
      return { action: "step_up_required", stepUpAuth: true, allowSession: false };
    case "critical":
      return { action: "block", stepUpAuth: false, allowSession: false };
  }
}

/**
 * List all high/critical risk events in the last N hours.
 */
export async function listHighRiskEvents(
  sql: Sql,
  hours = 24,
): Promise<AuthRiskEvent[]> {
  return sql<AuthRiskEvent[]>`
    SELECT * FROM auth.auth_risk_events
    WHERE risk_level IN ('high', 'critical')
      AND created_at > NOW() - INTERVAL '${sql.unsafe(String(hours))} hours'
    ORDER BY created_at DESC
  `;
}
