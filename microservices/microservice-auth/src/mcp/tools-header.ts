#!/usr/bin/env bun
/**
 * MCP server for microservice-auth.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createApiKey, listApiKeys, revokeApiKey, validateApiKey } from "../lib/api-keys.js";
import { login, refreshTokens, register } from "../lib/auth.js";
import {
  signJwt,
  verifyJwt,
  generateAccessToken,
  generateRefreshToken,
} from "../lib/jwt.js";
import {
  listUserSessions,
  revokeAllUserSessions,
  revokeSession,
  createSession,
  getSessionByToken,
  cleanExpiredSessions,
  trustDevice,
  isDeviceTrusted,
  listTrustedDevices,
  revokeAllDevices,
} from "../lib/sessions.js";
import {
  countUsers,
  createUser,
  deleteUser,
  getUserByEmail,
  getUserById,
  listUsers,
  updateUser,
} from "../lib/users.js";
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  createPasskey,
  deleteAllPasskeys,
  deletePasskey,
  getPasskeyByCredentialId,
  getPasskeyStats,
  listPasskeys,
  updatePasskeyCounter,
  userHasPasskeys,
} from "../lib/passkeys.js";
import {
  getActiveSessions,
  getRecentAuthEvents,
  recordLoginEvent,
} from "../lib/session-forensics.js";
import {
  detectSessionAnomalies,
  getSessionSecurityAudit,
  getUserSessionPattern,
  recordSessionAnomalies,
  getRecentSessionAnomalies,
} from "../lib/session-anomaly.js";
import {
  checkLoginAllowed,
  clearLoginAttempts,
  getFailedAttemptCount,
  recordFailedLogin,
} from "../lib/login-throttle.js";
import {
  computeDeviceTrustScore,
  applyTrustPolicy,
  upsertTrustPolicy,
  getTrustPolicy,
} from "../lib/device-risk.js";
import {
  createMagicLinkToken,
  verifyMagicLinkToken,
  createEmailVerifyToken,
  verifyEmailToken,
  createPasswordResetToken,
  verifyPasswordResetToken,
} from "../lib/magic-links.js";
import {
  getDevice,
  listUserDevices,
  registerDevice,
  revokeUserDevice,
  revokeAllUserDevices,
} from "../lib/devices.js";
import {
  authenticatePasskey,
  createPasskeyCredential,
  deleteAllPasskeyCredentials,
  deletePasskeyCredential,
  listPasskeyCredentials,
  verifyPasskey,
} from "../lib/passkey-simple.js";
import {
  acceptWorkspaceInvite,
  addWorkspaceMember,
  inviteToWorkspace,
  listWorkspaceInvites,
  listWorkspaceMembers,
  removeWorkspaceMember,
  revokeWorkspaceInvite,
  updateMemberRole,
} from "../lib/workspaces.js";
import {
  canAccessResource,
  getApiKeyUsageStats,
  getDetailedKeyInfo,
  getKeysDueForRotation,
  getRotationSchedule,
  hasScopePermission,
  logApiKeyUsage,
  scheduleRotation,
  type Scope,
} from "../lib/api-key-scopes.js";
import {
  createOAuthTokenSet,
  listUserOAuthTokens,
  refreshOAuthToken,
  registerOAuthClient,
  revokeAllUserClientTokens,
  revokeOAuthToken,
  validateClientCredentials,
  validateOAuthToken,
} from "../lib/oauth-tokens.js";
import {
  exportAuditLog,
  getRecentFailedLogins,
  getUserAuthSummary,
  queryAuditLog,
  recordAuditEvent,
  type AuditEventType,
} from "../lib/audit-log.js";
import {
  generateTOTPSecret,
  generateBackupCodes,
  computeTOTP,
  verifyTOTP,
  generateTOTPURI,
  consumeBackupCode,
} from "../lib/two-factor.js";
import {
  enrollTotp,
  verifyTotpEnrollment,
  disableTotpEnrollment,
  verifyTotpCode,
  consumeTotpBackupCode,
  getBackupCodeCount,
  getMfaStatus,
  isMfaEnabledForUser,
  listMfaEnabledUsers,
} from "../lib/mfa-enrollments.js";
import {
  toPrometheusTextFormat,
  exportAuthMetrics,
  exportAuthMetricsJSON,
} from "../lib/auth-prometheus-metrics.js";
import {
  recordFailedAttempt,
  isLockedOut,
  unlockAccount,
  listActiveLockouts,
  clearFailedAttempts,
} from "../lib/lockout.js";
import {
  checkImpossibleTravel,
  checkNewDevice,
  checkLoginVelocity,
  checkCredentialStuffing,
  checkLoginFraud,
} from "../lib/fraud-detection.js";
import {
  addPasswordToHistory,
  isPasswordInHistory,
  checkPasswordAgainstHistory,
  prunePasswordHistory,
  getPasswordHistoryCount,
} from "../lib/password-history.js";
import {
  grantDeviceMfaBypass,
  getDeviceMfaBypassStatus,
  recordMfaBypassUse,
  revokeDeviceMfaBypass,
  revokeAllMfaBypasses,
  listTrustedMfaDevices,
} from "../lib/trusted-device-mfa.js";
import {
  recordIpFailedAttempt,
  recordIpSuccessfulLogin,
  getIpBlockStatus,
  isIpLoginAllowed,
} from "../lib/ip-brute-force.js";
import {
  getDeviceTrust,
  getDeviceTrustScore,
  refreshDeviceTrust,
  markDeviceVerified,
  listUserDevicesByTrust,
  listHighRiskDevices,
  recordDeviceLoginAndScore,
} from "../lib/device-trust.js";
import {
  createMfaChallenge,
  getActiveMfaChallenge,
  completeMfaChallenge,
  verifyMfaAssertion,
  listPendingMfaChallenges,
} from "../lib/passkey-mfa.js";
import {
  computeAuthRiskScore,
  recordAuthRiskEvent,
  getRecentRiskEvents,
  getUserAverageRiskScore,
  getRecommendedAction,
  listHighRiskEvents,
} from "../lib/auth-risk.js";
import {
  getBruteForceStats,
  detectBruteForceCampaigns,
  getIpBruteForceStats,
  getMostTargetedAccounts,
} from "../lib/brute-force-analytics.js";
import { getMemberRole } from "../lib/workspaces.js";
import { countUsers, getUserByEmail } from "../lib/users.js";
import { touchDevice } from "../lib/devices.js";
import { pruneExpiredMfaChallenges } from "../lib/passkey-mfa.js";
import { hashPassword, verifyPassword } from "../lib/passwords.js";
import { getOAuthAccount, listUserOAuthAccounts, unlinkOAuthAccount } from "../lib/oauth.js";
import {
  createDelegation,
  revokeDelegation,
  getActiveDelegationsForGrantee,
  getActiveDelegationsForGrantor,
  checkDelegatedScope,
  getDelegationSummary,
} from "../lib/permission-delegation.js";
import {
  upsertTimeoutPolicy,
  getEffectiveTimeout,
  isSessionIdleExpired,
  listWorkspaceTimeoutPolicies,
  deleteTimeoutPolicy,
} from "../lib/auth-timeout-policies.js";
import {
  recordSuspiciousActivity,
  detectBurstLogins,
  detectPasswordSpray,
  getUnresolvedActivities,
  resolveSuspiciousActivity,
  getUserActivitySummary,
} from "../lib/suspicious-activity.js";
import {
  recordTokenIssuance,
  recordTokenUsage,
  getFreshTokenAlerts,
  resolveFreshTokenAlert,
  getFreshTokenStats,
} from "../lib/fresh-token-detect.js";
import {
  getAuthHealth,
  getAuthReadiness,
  getAuthLiveness,
} from "../lib/auth-health.js";

const server = new McpServer({
  name: "microservice-auth",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

