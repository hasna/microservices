/**
 * @hasna/microservice-auth — embed-first auth library.
 *
 * Usage in your app:
 *   import { migrate, createUser, login, validateSession } from '@hasna/microservice-auth'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   const user = await createUser(sql, { email: 'user@example.com', password: 'secret' })
 */

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
// API keys
export {
  type ApiKey,
  type ApiKeyWithSecret,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  validateApiKey,
} from "./api-keys.js";
// High-level login flow
export { login, refreshTokens, register } from "./auth.js";
// JWT
export {
  generateAccessToken,
  generateRefreshToken,
  type JwtPayload,
  signJwt,
  verifyJwt,
} from "./jwt.js";
// Magic links & tokens
export {
  createEmailVerifyToken,
  createMagicLinkToken,
  createPasswordResetToken,
  verifyEmailToken,
  verifyMagicLinkToken,
  verifyPasswordResetToken,
} from "./magic-links.js";
// Middleware / request validation helper
export {
  type RequestIdentity,
  requireScope,
  validateRequest,
} from "./middleware.js";
// OAuth
export {
  getOAuthAccount,
  listUserOAuthAccounts,
  type OAuthAccount,
  unlinkOAuthAccount,
  upsertOAuthAccount,
} from "./oauth.js";
// Passwords
export { hashPassword, verifyPassword } from "./passwords.js";
// Sessions
export {
  cleanExpiredSessions,
  createSession,
  getSessionByToken,
  isDeviceTrusted,
  listUserSessions,
  listTrustedDevices,
  revokeAllDevices,
  revokeAllUserSessions,
  revokeDevice,
  revokeSession,
  trustDevice,
  type Session,
  type TrustedDevice,
  updateSessionLastSeen,
} from "./sessions.js";
// Passkeys / WebAuthn
export {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  createPasskey,
  deleteAllPasskeys,
  deletePasskey,
  getPasskeyByCredentialId,
  getPasskeyStats,
  listPasskeys,
  type CreatePasskeyData,
  type Passkey,
  type PasskeyAuthenticationOptions,
  type PasskeyRegistrationOptions,
  type PasskeyStats,
  updatePasskeyCounter,
  userHasPasskeys,
} from "./passkeys.js";
// Users
export {
  countUsers,
  createUser,
  deleteUser,
  getUserByEmail,
  getUserById,
  listUsers,
  type User,
  updateUser,
} from "./users.js";
// Devices
export {
  type Device,
  getDevice,
  listUserDevices,
  registerDevice,
  revokeUserDevice,
  revokeAllUserDevices,
  touchDevice,
} from "./devices.js";
// Passkey (simple byte-based)
export {
  type PasskeyChallenge,
  type PasskeyCredential,
  authenticatePasskey,
  createPasskeyCredential,
  deleteAllPasskeyCredentials,
  deletePasskeyCredential,
  getPasskeyByCredentialId as getSimplePasskeyByCredentialId,
  listPasskeyCredentials,
  verifyPasskey,
} from "./passkey-simple.js";
// Session forensics
export {
  getActiveSessions,
  getRecentAuthEvents,
  recordLoginEvent,
  type SessionMetadata,
} from "./session-forensics.js";
// Workspace auth
export {
  acceptWorkspaceInvite,
  addWorkspaceMember,
  getMemberRole,
  inviteToWorkspace,
  listWorkspaceInvites,
  listWorkspaceMembers,
  removeWorkspaceMember,
  revokeWorkspaceInvite,
  updateMemberRole,
  type InviteToken,
  type WorkspaceMember,
  type WorkspaceRole,
} from "./workspaces.js";
// Login throttling
export {
  checkLoginAllowed,
  clearLoginAttempts,
  getFailedAttemptCount,
  recordFailedLogin,
  type LoginThrottleStatus,
} from "./login-throttle.js";
// API key scoping and rotation
export {
  canAccessResource,
  getApiKeyUsageStats,
  getApiKeyWithExpandedScopes,
  getDetailedKeyInfo,
  getKeysDueForRotation,
  getRotationSchedule,
  hasScopePermission,
  logApiKeyUsage,
  scheduleRotation,
  type ApiKeyScopeDetail,
  type ApiKeyUsageLog,
  type RotationSchedule,
  type Scope,
  type ScopedPermission,
} from "./api-key-scopes.js";
// OAuth token management
export {
  createOAuthTokenSet,
  listUserOAuthTokens,
  refreshOAuthToken,
  registerOAuthClient,
  revokeAllUserClientTokens,
  revokeOAuthToken,
  validateClientCredentials,
  validateOAuthToken,
  type OAuthClient,
  type OAuthTokenSet,
  type StoredOAuthToken,
} from "./oauth-tokens.js";
// Auth audit log
export {
  exportAuditLog,
  getRecentFailedLogins,
  getUserAuthSummary,
  queryAuditLog,
  recordAuditEvent,
  recordAuditEvents,
  type AuditEventType,
  type AuditLogEntry,
  type AuditQueryOptions,
} from "./audit-log.js";
// TOTP two-factor authentication
export {
  generateTOTPSecret,
  generateBackupCodes,
  computeTOTP,
  verifyTOTP,
  generateTOTPURI,
  consumeBackupCode,
  type TOTPSecret,
  type TOTPEnrollment,
} from "./two-factor.js";
// MFA Enrollment management (TOTP + passkey)
export {
  type MfaMethod,
  type MfaEnrollmentStatus,
  type MfaEnrollmentRecord,
  type MfaStatus,
  enrollTotp,
  verifyTotpEnrollment,
  disableTotpEnrollment,
  verifyTotpCode,
  consumeTotpBackupCode,
  getBackupCodeCount,
  getMfaStatus,
  isMfaEnabledForUser,
  listMfaEnabledUsers,
} from "./mfa-enrollments.js";
// Account lockout
export {
  recordFailedAttempt,
  isLockedOut,
  unlockAccount,
  listActiveLockouts,
  clearFailedAttempts,
  DEFAULT_LOCKOUT_CONFIG,
  type AccountLockout,
  type LockoutConfig,
} from "./lockout.js";
// Login fraud detection
export {
  checkImpossibleTravel,
  checkNewDevice,
  checkLoginVelocity,
  checkCredentialStuffing,
  checkLoginFraud,
  type LoginFraudSignal,
  type FraudCheckResult,
} from "./fraud-detection.js";
// Password history (reuse prevention)
export {
  addPasswordToHistory,
  isPasswordInHistory,
  checkPasswordAgainstHistory,
  prunePasswordHistory,
  getPasswordHistoryCount,
} from "./password-history.js";
// Trusted device MFA bypass
export {
  grantDeviceMfaBypass,
  getDeviceMfaBypassStatus,
  recordMfaBypassUse,
  revokeDeviceMfaBypass,
  revokeAllMfaBypasses,
  listTrustedMfaDevices,
  type MfaBypassStatus,
  type TrustedDeviceMfa,
} from "./trusted-device-mfa.js";
// IP-level brute force detection
export {
  recordIpFailedAttempt,
  recordIpSuccessfulLogin,
  getIpBlockStatus,
  isIpLoginAllowed,
  type IpAttemptRecord,
  type IpBlockStatus,
} from "./ip-brute-force.js";
// Device trust scoring
export {
  type DeviceTrust,
  type RiskLevel as DeviceRiskLevel,
  getDeviceTrust,
  getDeviceTrustScore,
  refreshDeviceTrust,
  markDeviceVerified,
  listUserDevicesByTrust,
  listHighRiskDevices,
  recordDeviceLoginAndScore,
} from "./device-trust.js";
// Passkey MFA (WebAuthn assertion as second factor)
export {
  type PasskeyMfaChallenge,
  type VerifyMfaAssertionOpts,
  createMfaChallenge,
  getActiveMfaChallenge,
  completeMfaChallenge,
  verifyMfaAssertion,
  listPendingMfaChallenges,
  pruneExpiredMfaChallenges,
} from "./passkey-mfa.js";
// Auth risk scoring (aggregate fraud signals into risk score)
export {
  type AuthRiskEvent,
  type RiskLevel as AuthRiskLevel,
  type RiskSignal,
  type RiskEventType,
  computeAuthRiskScore,
  recordAuthRiskEvent,
  getRecentRiskEvents,
  getUserAverageRiskScore,
  getRecommendedAction,
  listHighRiskEvents,
} from "./auth-risk.js";
// Device trust policies — auto-trust/auto-revoke based on computed risk scores
export {
  type DeviceRiskProfile,
  type RiskFactor,
  type DeviceTrustPolicy,
  type TrustLevel,
  computeDeviceTrustScore,
  applyTrustPolicy,
  upsertTrustPolicy,
  getTrustPolicy,
} from "./device-risk.js";
// Auth Prometheus metrics
export {
  type AuthMetrics,
  type PrometheusTextOutput,
  toPrometheusTextFormat,
  exportAuthMetrics,
  exportAuthMetricsJSON,
} from "./auth-prometheus-metrics.js";
// Session anomaly detection
export {
  type AnomalyType,
  type SessionAnomaly,
  type SessionPattern,
  type SessionSecurityAudit,
  type SessionSecurityIssue,
  detectSessionAnomalies,
  getSessionSecurityAudit,
  getUserSessionPattern,
  recordSessionAnomalies,
  getRecentSessionAnomalies,
} from "./session-anomaly.js";
// Brute force analytics
export {
  type AttackCampaign,
  type BruteForceStats,
  getBruteForceStats,
  detectBruteForceCampaigns,
  getIpBruteForceStats,
  getMostTargetedAccounts,
} from "./brute-force-analytics.js";
// Permission delegation
export {
  type PermissionDelegation,
  type DelegationSummary,
  createDelegation,
  revokeDelegation,
  getActiveDelegationsForGrantee,
  getActiveDelegationsForGrantor,
  checkDelegatedScope,
  getDelegationSummary,
} from "./permission-delegation.js";
// Auth timeout policies
export {
  type AuthTimeoutPolicy,
  type EffectiveTimeout,
  upsertTimeoutPolicy,
  getEffectiveTimeout,
  isSessionIdleExpired,
  listWorkspaceTimeoutPolicies,
  deleteTimeoutPolicy,
} from "./auth-timeout-policies.js";
// Suspicious activity detection
export {
  type SuspiciousActivityType,
  type SuspiciousActivity,
  recordSuspiciousActivity,
  detectBurstLogins,
  detectPasswordSpray,
  getUnresolvedActivities,
  resolveSuspiciousActivity,
  getUserActivitySummary,
} from "./suspicious-activity.js";
// Session sharing links
export {
  type SessionShareLink,
  type SessionViewerContext,
  createSessionShareLink,
  validateSessionShareLink,
  listSessionShareLinks,
  revokeSessionShareLink,
  revokeAllSessionShareLinks,
} from "./session-sharing.js";
// Session key rotation
export {
  type SessionKeyVersion,
  type KeyRotationResult,
  createSessionKeyVersion,
  setPrimarySessionKey,
  getPrimarySessionKey,
  listSessionKeyVersions,
  rotateSessionKeys,
  reEncryptSession,
} from "./session-key-rotation.js";
// Concurrent session management
export {
  type ConcurrentSessionInfo,
  type ConcurrentSessionViolation,
  getConcurrentSessionInfo,
  enforceConcurrentSessionLimit,
  setUserSessionLimit,
  getUserSessionLimit,
  detectConcurrentSessionAnomaly,
} from "./concurrent-sessions.js";
// Fresh token reuse detection
export {
  type FreshTokenEvent,
  type FreshTokenAlert,
  recordTokenIssuance,
  recordTokenUsage,
  getFreshTokenAlerts,
  resolveFreshTokenAlert,
  getFreshTokenStats,
} from "./fresh-token-detect.js";
// Auth health checks
export {
  type HealthStatus,
  type AuthHealthCheck,
  type AuthHealthReport,
  getAuthHealth,
  getAuthReadiness,
  getAuthLiveness,
} from "./auth-health.js";
