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

server.tool(
  "auth_list_users",
  "List all users",
  {
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ limit, offset }) => text(await listUsers(sql, { limit, offset })),
);

server.tool(
  "auth_get_user",
  "Get a user by ID",
  { id: z.string() },
  async ({ id }) => text(await getUserById(sql, id)),
);

server.tool(
  "auth_create_user",
  "Create a new user",
  {
    email: z.string(),
    password: z.string().optional(),
    name: z.string().optional(),
  },
  async ({ email, password, name }) =>
    text(await createUser(sql, { email, password, name })),
);

server.tool(
  "auth_delete_user",
  "Delete a user by ID",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deleteUser(sql, id) }),
);

server.tool(
  "auth_list_sessions",
  "List active sessions for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await listUserSessions(sql, user_id)),
);

server.tool(
  "auth_revoke_session",
  "Revoke a session token",
  { token: z.string() },
  async ({ token }) => text({ revoked: await revokeSession(sql, token) }),
);

server.tool(
  "auth_revoke_all_sessions",
  "Revoke all sessions for a user",
  { user_id: z.string() },
  async ({ user_id }) =>
    text({ revoked: await revokeAllUserSessions(sql, user_id) }),
);

server.tool(
  "auth_create_api_key",
  "Create an API key for a user",
  {
    user_id: z.string(),
    name: z.string(),
    scopes: z.array(z.string()).optional(),
  },
  async ({ user_id, name, scopes }) =>
    text(await createApiKey(sql, user_id, { name, scopes })),
);

server.tool(
  "auth_list_api_keys",
  "List API keys for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await listApiKeys(sql, user_id)),
);

server.tool(
  "auth_revoke_api_key",
  "Revoke an API key",
  { id: z.string(), user_id: z.string() },
  async ({ id, user_id }) => text({ revoked: await revokeApiKey(sql, id, user_id) }),
);

server.tool(
  "auth_update_user",
  "Update a user's profile (name, avatar_url, email_verified, metadata)",
  {
    id: z.string(),
    name: z.string().optional(),
    avatar_url: z.string().optional(),
    email_verified: z.boolean().optional(),
    metadata: z.record(z.any()).optional(),
  },
  async ({ id, ...updates }) => text(await updateUser(sql, id, updates as any)),
);

server.tool(
  "auth_search_users",
  "Search users by email prefix or name",
  {
    query: z.string(),
    limit: z.number().optional().default(20),
  },
  async ({ query, limit }) => {
    const q = query.toLowerCase();
    const all = await listUsers(sql, { limit });
    return text(
      all.filter(
        (u) => u.email.includes(q) || (u.name ?? "").toLowerCase().includes(q),
      ),
    );
  },
);

server.tool(
  "auth_list_passkeys",
  "List all passkeys registered for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await listPasskeys(sql, user_id)),
);

server.tool(
  "auth_delete_passkey",
  "Delete a specific passkey by credential ID",
  { user_id: z.string(), credential_id: z.string() },
  async ({ user_id, credential_id }) =>
    text({ deleted: await deletePasskey(sql, user_id, credential_id) }),
);

server.tool(
  "auth_delete_all_passkeys",
  "Delete all passkeys for a user",
  { user_id: z.string() },
  async ({ user_id }) =>
    text({ deleted_all: await deleteAllPasskeys(sql, user_id) }),
);

server.tool(
  "auth_has_passkeys",
  "Check whether a user has any passkeys registered",
  { user_id: z.string() },
  async ({ user_id }) => text({ has_passkeys: await userHasPasskeys(sql, user_id) }),
);

server.tool(
  "auth_build_passkey_registration_options",
  "Build WebAuthn registration options for a new passkey",
  {
    user_id: z.string(),
    rp_name: z.string().default("Hasna Services"),
    user_name: z.string(),
    user_email: z.string(),
  },
  async ({ user_id, rp_name, user_name, user_email }) => {
    const opts = await buildRegistrationOptions(sql, user_id, {
      rpName: rp_name,
      userName: user_name,
      userEmail: user_email,
    });
    return text(opts);
  },
);

server.tool(
  "auth_build_passkey_authentication_options",
  "Build WebAuthn authentication options for a user",
  { user_email: z.string() },
  async ({ user_email }) => {
    const opts = await buildAuthenticationOptions(sql, user_email);
    return text(opts);
  },
);

server.tool(
  "auth_store_passkey",
  "Store a newly registered passkey after successful WebAuthn registration",
  {
    user_id: z.string(),
    credential_id: z.string(),
    public_key: z.string(),
    counter: z.number(),
    device_type: z.string().optional(),
    backed_up: z.boolean().optional(),
    transport: z.array(z.string()).optional(),
    authenticator_label: z.string().optional(),
  },
  async ({
    user_id,
    credential_id,
    public_key,
    counter,
    device_type,
    backed_up,
    transport,
    authenticator_label,
  }) => {
    const passkey = await createPasskey(sql, user_id, {
      credential_id,
      public_key,
      counter,
      device_type,
      backed_up,
      transport,
      authenticator_label,
    });
    return text(passkey);
  },
);

server.tool(
  "auth_update_passkey_counter",
  "Update the sign counter for a passkey after authentication",
  { credential_id: z.string(), counter: z.number() },
  async ({ credential_id, counter }) =>
    text({ updated: await updatePasskeyCounter(sql, credential_id, counter) }),
);

// --- Device management ---

server.tool(
  "auth_list_devices",
  "List all devices for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await listUserDevices(sql, user_id)),
);

server.tool(
  "auth_register_device",
  "Register a new device for a user",
  {
    user_id: z.string(),
    name: z.string().optional(),
    type: z.string().optional(),
    ip_address: z.string().optional(),
    user_agent: z.string().optional(),
  },
  async ({ user_id, name, type, ip_address, user_agent }) =>
    text(await registerDevice(sql, user_id, { name, type, ip_address, user_agent })),
);

server.tool(
  "auth_revoke_device",
  "Revoke (deactivate) a specific device",
  { user_id: z.string(), device_id: z.string() },
  async ({ user_id, device_id }) =>
    text({ revoked: await revokeUserDevice(sql, user_id, device_id) }),
);

server.tool(
  "auth_revoke_other_sessions",
  "Revoke all devices for a user except the current one",
  { user_id: z.string(), keep_device_id: z.string().optional() },
  async ({ user_id, keep_device_id }) =>
    text({ revoked: await revokeAllUserDevices(sql, user_id, keep_device_id) }),
);

// --- Simple passkey (byte-based challenge/response) ---

server.tool(
  "auth_create_passkey",
  "Create a new passkey credential (simple registration flow)",
  {
    user_id: z.string(),
    credential_id: z.string(),
    public_key: z.string(),
    counter: z.number().optional(),
    device_type: z.string().optional(),
  },
  async ({ user_id, credential_id, public_key, counter, device_type }) =>
    text(await createPasskeyCredential(sql, user_id, {
      credentialId: credential_id,
      publicKey: public_key,
      counter,
      deviceType: device_type,
    })),
);

server.tool(
  "auth_verify_passkey",
  "Verify a passkey authentication response",
  {
    challenge_id: z.string(),
    credential_id: z.string(),
    counter: z.number(),
    signature: z.string(),
  },
  async ({ challenge_id, credential_id, counter, signature }) =>
    text(await verifyPasskey(sql, challenge_id, credential_id, counter, signature)),
);

server.tool(
  "auth_list_passkeys_simple",
  "List all passkey credentials for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await listPasskeyCredentials(sql, user_id)),
);

server.tool(
  "auth_delete_passkey_simple",
  "Delete a specific passkey credential by credential ID",
  { user_id: z.string(), credential_id: z.string() },
  async ({ user_id, credential_id }) =>
    text({ deleted: await deletePasskeyCredential(sql, user_id, credential_id) }),
);

server.tool(
  "auth_delete_all_passkeys_simple",
  "Delete all passkey credentials for a user",
  { user_id: z.string() },
  async ({ user_id }) =>
    text({ deleted_count: await deleteAllPasskeyCredentials(sql, user_id) }),
);

server.tool(
  "auth_authenticate_passkey",
  "Start passkey authentication — issue a challenge for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await authenticatePasskey(sql, user_id)),
);

// --- Session forensics ---

server.tool(
  "auth_session_history",
  "Get recent authentication events for a user",
  {
    user_id: z.string(),
    limit: z.number().optional().default(20),
    event_type: z.string().optional(),
  },
  async ({ user_id, limit, event_type }) =>
    text(await getRecentAuthEvents(sql, user_id, { limit, event_type })),
);

server.tool(
  "auth_get_active_sessions",
  "Get all active sessions with metadata (no tokens exposed)",
  { user_id: z.string() },
  async ({ user_id }) => text(await getActiveSessions(sql, user_id)),
);

server.tool(
  "auth_record_login_event",
  "Record an authentication event for forensics",
  {
    user_id: z.string(),
    event_type: z.enum(["login_success", "login_failure", "logout", "token_refresh", "passkey_success"]),
    ip: z.string().optional(),
    user_agent: z.string().optional(),
    device_id: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  },
  async ({ user_id, event_type, ip, user_agent, device_id, metadata }) => {
    await recordLoginEvent(sql, user_id, {
      event_type,
      ip,
      user_agent,
      device_id,
      metadata,
    });
    return text({ recorded: true });
  },
);

// --- Workspace auth ---

server.tool(
  "auth_invite_member",
  "Invite a user to a workspace (creates an invite token)",
  {
    workspace_id: z.string(),
    email: z.string(),
    role: z.enum(["owner", "admin", "member", "viewer"]),
    invited_by: z.string(),
    ttl_hours: z.number().optional().default(72),
  },
  async ({ workspace_id, email, role, invited_by, ttl_hours }) =>
    text(await inviteToWorkspace(sql, workspace_id, email, role, invited_by, ttl_hours)),
);

server.tool(
  "auth_remove_member",
  "Remove a user from a workspace",
  { workspace_id: z.string(), user_id: z.string() },
  async ({ workspace_id, user_id }) =>
    text({ removed: await removeWorkspaceMember(sql, workspace_id, user_id) }),
);

server.tool(
  "auth_list_members",
  "List all members of a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await listWorkspaceMembers(sql, workspace_id)),
);

server.tool(
  "auth_update_member_role",
  "Update a member's role in a workspace",
  {
    workspace_id: z.string(),
    user_id: z.string(),
    role: z.enum(["owner", "admin", "member", "viewer"]),
  },
  async ({ workspace_id, user_id, role }) =>
    text({ updated: await updateMemberRole(sql, workspace_id, user_id, role) }),
);

server.tool(
  "auth_accept_workspace_invite",
  "Accept a workspace invite token and join the workspace",
  { token: z.string(), user_id: z.string(), user_email: z.string() },
  async ({ token, user_id, user_email }) =>
    text(await acceptWorkspaceInvite(sql, token, user_id, user_email)),
);

server.tool(
  "auth_list_workspace_invites",
  "List pending invites for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await listWorkspaceInvites(sql, workspace_id)),
);

server.tool(
  "auth_revoke_workspace_invite",
  "Revoke a pending workspace invite by email",
  { workspace_id: z.string(), email: z.string() },
  async ({ workspace_id, email }) =>
    text({ revoked: await revokeWorkspaceInvite(sql, workspace_id, email) }),
);

// --- Login throttling ---

server.tool(
  "auth_check_login_allowed",
  "Check whether a login is currently allowed for an email (rate limit check)",
  { email: z.string() },
  async ({ email }) => text(await checkLoginAllowed(sql, email)),
);

server.tool(
  "auth_record_failed_login",
  "Record a failed login attempt for an email",
  { email: z.string() },
  async ({ email }) => {
    await recordFailedLogin(sql, email);
    return text({ recorded: true });
  },
);

server.tool(
  "auth_clear_login_attempts",
  "Clear all login attempts for an email (call after successful login)",
  { email: z.string() },
  async ({ email }) => {
    await clearLoginAttempts(sql, email);
    return text({ cleared: true });
  },
);

// --- API key scoping & rotation ---

server.tool(
  "auth_check_scope",
  "Check if an API key has a specific scope permission",
  {
    key_id: z.string().describe("API key UUID"),
    required_scope: z.string().describe("Scope to check (e.g. memory:read, llm:chat)"),
  },
  async ({ key_id, required_scope }) => {
    const result = await getDetailedKeyInfo(sql, key_id);
    if (!result) return text({ has_permission: false, error: "Key not found" });
    const has = hasScopePermission(result.scopes as Scope[], required_scope as Scope);
    return text({ has_permission: has, scopes: result.scopes });
  },
);

server.tool(
  "auth_schedule_key_rotation",
  "Schedule automatic rotation for an API key",
  {
    key_id: z.string().describe("API key UUID"),
    frequency_days: z.number().int().positive().describe("Rotation frequency in days"),
  },
  async ({ key_id, frequency_days }) =>
    text(await scheduleRotation(sql, key_id, frequency_days)),
);

server.tool(
  "auth_get_key_rotation_schedule",
  "Get rotation schedule for an API key",
  { key_id: z.string().describe("API key UUID") },
  async ({ key_id }) => {
    const schedule = await getRotationSchedule(sql, key_id);
    return schedule ? text(schedule) : text({ error: "No rotation schedule set" });
  },
);

server.tool(
  "auth_get_keys_due_rotation",
  "Get all API keys that are due for rotation",
  {},
  async () => text(await getKeysDueForRotation(sql)),
);

server.tool(
  "auth_get_key_usage_stats",
  "Get usage statistics for an API key",
  { key_id: z.string().describe("API key UUID") },
  async ({ key_id }) => text(await getApiKeyUsageStats(sql, key_id)),
);

// --- OAuth token management ---

server.tool(
  "auth_create_oauth_token",
  "Create OAuth access + refresh token set for a user+client",
  {
    user_id: z.string().describe("User UUID"),
    client_id: z.string().describe("OAuth client ID"),
    scopes: z.array(z.string()).describe("Permission scopes"),
  },
  async ({ user_id, client_id, scopes }) =>
    text(await createOAuthTokenSet(sql, user_id, client_id, scopes)),
);

server.tool(
  "auth_refresh_oauth_token",
  "Refresh an OAuth access token using a refresh token",
  { refresh_token: z.string().describe("OAuth refresh token") },
  async ({ refresh_token }) => {
    const result = await refreshOAuthToken(sql, refresh_token);
    return result ? text(result) : text({ error: "Invalid or expired refresh token" });
  },
);

server.tool(
  "auth_revoke_oauth_token",
  "Revoke an OAuth access token",
  { access_token: z.string().describe("OAuth access token") },
  async ({ access_token }) =>
    text({ revoked: await revokeOAuthToken(sql, access_token) }),
);

server.tool(
  "auth_list_oauth_tokens",
  "List active OAuth tokens for a user",
  { user_id: z.string().describe("User UUID") },
  async ({ user_id }) => text(await listUserOAuthTokens(sql, user_id)),
);

server.tool(
  "auth_register_oauth_client",
  "Register a new OAuth client application",
  {
    name: z.string().describe("Client application name"),
    redirect_uris: z.array(z.string()).describe("Allowed redirect URIs"),
    scopes: z.array(z.string()).describe("Allowed OAuth scopes"),
  },
  async ({ name, redirect_uris, scopes }) =>
    text(await registerOAuthClient(sql, name, redirect_uris, scopes)),
);

server.tool(
  "auth_list_user_oauth_accounts",
  "List all OAuth accounts linked to a user",
  { user_id: z.string().describe("User UUID") },
  async ({ user_id }) => text(await listUserOAuthAccounts(sql, user_id)),
);

server.tool(
  "auth_get_oauth_account",
  "Get a specific OAuth account by provider and provider ID",
  {
    provider: z.string().describe("OAuth provider name (e.g. google, github)"),
    provider_id: z.string().describe("User ID from the OAuth provider"),
  },
  async ({ provider, provider_id }) => text(await getOAuthAccount(sql, provider, provider_id)),
);

server.tool(
  "auth_unlink_oauth_account",
  "Unlink an OAuth account from a user",
  {
    user_id: z.string().describe("User UUID"),
    provider: z.string().describe("OAuth provider name to unlink"),
  },
  async ({ user_id, provider }) => text({ unlinked: await unlinkOAuthAccount(sql, user_id, provider) }),
);

// --- Auth audit log ---

server.tool(
  "auth_record_audit_event",
  "Record a single auth audit event",
  {
    event_type: z.string().describe("Event type string"),
    user_id: z.string().optional().describe("User UUID"),
    actor_id: z.string().optional().describe("Actor UUID (who performed the action)"),
    ip_address: z.string().optional().describe("IP address"),
    user_agent: z.string().optional().describe("User agent string"),
    resource_type: z.string().optional().describe("Resource type (e.g. api_key, session)"),
    resource_id: z.string().optional().describe("Resource ID"),
    metadata: z.record(z.any()).optional().describe("Additional event metadata"),
  },
  async (opts) => text(await recordAuditEvent(sql, {
    event_type: opts.event_type as AuditEventType,
    user_id: opts.user_id,
    actor_id: opts.actor_id,
    ip_address: opts.ip_address,
    user_agent: opts.user_agent,
    resource_type: opts.resource_type,
    resource_id: opts.resource_id,
    metadata: opts.metadata,
  })),
);

server.tool(
  "auth_query_audit_log",
  "Query audit log with filters",
  {
    user_id: z.string().optional().describe("Filter by user UUID"),
    event_type: z.string().optional().describe("Filter by event type"),
    resource_type: z.string().optional().describe("Filter by resource type"),
    resource_id: z.string().optional().describe("Filter by resource ID"),
    ip_address: z.string().optional().describe("Filter by IP address"),
    since: z.string().optional().describe("ISO date string"),
    until: z.string().optional().describe("ISO date string"),
    limit: z.number().int().positive().optional().default(100).describe("Max results"),
    offset: z.number().int().nonnegative().optional().default(0).describe("Offset"),
  },
  async (opts) => {
    const result = await queryAuditLog(sql, {
      user_id: opts.user_id,
      event_type: opts.event_type as AuditEventType | undefined,
      resource_type: opts.resource_type,
      resource_id: opts.resource_id,
      ip_address: opts.ip_address,
      since: opts.since ? new Date(opts.since) : undefined,
      until: opts.until ? new Date(opts.until) : undefined,
      limit: opts.limit,
      offset: opts.offset,
    });
    return text(result);
  },
);

server.tool(
  "auth_get_user_auth_summary",
  "Get authentication summary for a user",
  {
    user_id: z.string().describe("User UUID"),
    days: z.number().int().positive().optional().default(30).describe("Number of days to look back"),
  },
  async ({ user_id, days }) => text(await getUserAuthSummary(sql, user_id, days)),
);

server.tool(
  "auth_export_audit_log",
  "Export audit log as JSON or CSV",
  {
    user_id: z.string().optional().describe("Filter by user UUID"),
    event_type: z.string().optional().describe("Filter by event type"),
    since: z.string().optional().describe("ISO date string"),
    format: z.enum(["json", "csv"]).optional().default("json").describe("Export format"),
    limit: z.number().int().positive().optional().default(10000).describe("Max rows"),
  },
  async ({ user_id, event_type, since, format, limit }) =>
    text({ export: await exportAuditLog(sql, { user_id, event_type: event_type as AuditEventType | undefined, since: since ? new Date(since) : undefined, format, limit }) }),
);

// --- TOTP two-factor authentication ---

server.tool(
  "auth_generate_totp_secret",
  "Generate a new TOTP secret for enrolling a user in 2FA",
  {
    user_id: z.string().describe("User UUID"),
    algorithm: z.enum(["SHA1", "SHA256", "SHA512"]).optional().default("SHA1"),
    digits: z.number().int().min(6).max(8).optional().default(6),
    period: z.number().int().positive().optional().default(30),
  },
  async ({ user_id, algorithm, digits, period }) => {
    const secret = await generateTOTPSecret();
    const uri = generateTOTPURI(secret, user_id, { algorithm, digits, period });
    const backup_codes = generateBackupCodes();
    return text({ secret, uri, backup_codes });
  },
);

server.tool(
  "auth_verify_totp",
  "Verify a TOTP code and optionally mark enrollment as verified",
  {
    user_id: z.string().describe("User UUID"),
    code: z.string().describe("TOTP code from authenticator app"),
    verify_as_verified: z.boolean().optional().default(false),
    algorithm: z.enum(["SHA1", "SHA256", "SHA512"]).optional().default("SHA1"),
    digits: z.number().int().min(6).max(8).optional().default(6),
    period: z.number().int().positive().optional().default(30),
  },
  async ({ user_id, code, verify_as_verified, algorithm, digits, period }) => {
    const result = await verifyTOTP(sql, user_id, code, { algorithm, digits, period, verify_as_verified });
    return text(result);
  },
);

server.tool(
  "auth_consume_backup_code",
  "Consume a backup code for 2FA recovery",
  {
    user_id: z.string().describe("User UUID"),
    code: z.string().describe("One of the user's backup codes"),
  },
  async ({ user_id, code }) => {
    const result = await consumeBackupCode(sql, user_id, code);
    return text(result);
  },
);

// --- Account lockout ---

server.tool(
  "auth_record_failed_attempt",
  "Record a failed login attempt and trigger lockout if threshold exceeded",
  {
    email: z.string().describe("User email"),
    ip_address: z.string().optional().describe("IP address of the attempt"),
  },
  async ({ email, ip_address }) => {
    const result = await recordFailedAttempt(sql, email, ip_address);
    return text(result);
  },
);

server.tool(
  "auth_is_locked_out",
  "Check whether an email or IP is currently locked out",
  {
    email: z.string().optional().describe("User email"),
    ip_address: z.string().optional().describe("IP address"),
  },
  async ({ email, ip_address }) => {
    const result = await isLockedOut(sql, email, ip_address);
    return text(result);
  },
);

server.tool(
  "auth_unlock_account",
  "Manually unlock a user account or IP",
  {
    user_id: z.string().optional().describe("User UUID to unlock"),
    ip_address: z.string().optional().describe("IP address to unlock"),
  },
  async ({ user_id, ip_address }) => {
    const result = await unlockAccount(sql, user_id, ip_address);
    return text(result);
  },
);

server.tool(
  "auth_list_active_lockouts",
  "List all currently active account lockouts",
  {
    limit: z.number().int().positive().optional().default(50),
    offset: z.number().int().nonnegative().optional().default(0),
  },
  async ({ limit, offset }) => text(await listActiveLockouts(sql, { limit, offset })),
);

// --- Login fraud detection ---

server.tool(
  "auth_check_impossible_travel",
  "Detect impossible travel between two login events (geographically implausible speed)",
  {
    user_id: z.string().describe("User UUID"),
    ip: z.string().describe("Current IP address"),
    window_hours: z.number().int().positive().optional().default(24).describe("Hours to look back for prior login"),
    max_speed_kmh: z.number().int().positive().optional().default(900).describe("Max travel speed in km/h"),
  },
  async ({ user_id, ip, window_hours, max_speed_kmh }) => {
    const result = await checkImpossibleTravel(sql, user_id, ip, { window_hours, max_speed_kmh });
    return text(result);
  },
);

server.tool(
  "auth_check_new_device",
  "Check if a login is from a new/unrecognized device",
  {
    user_id: z.string().describe("User UUID"),
    device_fingerprint: z.string().describe("Device fingerprint hash"),
  },
  async ({ user_id, device_fingerprint }) => {
    const result = await checkNewDevice(sql, user_id, device_fingerprint);
    return text(result);
  },
);

server.tool(
  "auth_check_login_velocity",
  "Check if too many login attempts are occurring in a short window",
  {
    email: z.string().describe("User email"),
    window_minutes: z.number().int().positive().optional().default(5),
    max_attempts: z.number().int().positive().optional().default(5),
  },
  async ({ email, window_minutes, max_attempts }) => {
    const result = await checkLoginVelocity(sql, email, { window_minutes, max_attempts });
    return text(result);
  },
);

server.tool(
  "auth_check_credential_stuffing",
  "Detect multiple accounts being accessed from the same IP (potential credential stuffing)",
  {
    ip_address: z.string().describe("IP address to check"),
    window_hours: z.number().int().positive().optional().default(24),
    threshold: z.number().int().positive().optional().default(3),
  },
  async ({ ip_address, window_hours, threshold }) => {
    const result = await checkCredentialStuffing(sql, ip_address, { window_hours, threshold });
    return text(result);
  },
);

server.tool(
  "auth_check_login_fraud",
  "Run all fraud checks on a login and return an overall fraud score",
  {
    user_id: z.string().describe("User UUID"),
    email: z.string().describe("User email"),
    ip: z.string().describe("Current IP address"),
    device_fingerprint: z.string().optional().describe("Device fingerprint hash"),
  },
  async ({ user_id, email, ip, device_fingerprint }) => {
    const result = await checkLoginFraud(sql, user_id, email, ip, device_fingerprint);
    return text(result);
  },
);

// --- Password history tools ---

server.tool(
  "auth_check_password_history",
  "Check if a proposed password was previously used by the user",
  {
    user_id: z.string().describe("User UUID"),
    proposed_password_hash: z.string().describe("bcrypt hash of the proposed password"),
    history_limit: z.number().int().positive().optional().default(10),
  },
  async ({ user_id, proposed_password_hash, history_limit }) =>
    text(await checkPasswordAgainstHistory(sql, user_id, proposed_password_hash, history_limit)),
);

server.tool(
  "auth_add_password_history",
  "Add a password hash to the user's password history",
  {
    user_id: z.string().describe("User UUID"),
    password_hash: z.string().describe("bcrypt hash of the current password"),
  },
  async ({ user_id, password_hash }) => {
    await addPasswordToHistory(sql, user_id, password_hash);
    return text({ ok: true });
  },
);

server.tool(
  "auth_prune_password_history",
  "Prune old password history entries beyond the retention limit",
  {
    user_id: z.string().describe("User UUID"),
    retain_count: z.number().int().positive().optional().default(10),
  },
  async ({ user_id, retain_count }) =>
    text({ pruned: await prunePasswordHistory(sql, user_id, retain_count) }),
);

server.tool(
  "auth_get_password_history_count",
  "Get the number of passwords stored in a user's password history",
  { user_id: z.string().describe("User UUID") },
  async ({ user_id }) =>
    text({ count: await getPasswordHistoryCount(sql, user_id) }),
);

// --- Trusted device MFA bypass tools ---

server.tool(
  "auth_grant_device_mfa_bypass",
  "Grant MFA bypass to a trusted device for a time window",
  {
    user_id: z.string().describe("User UUID"),
    device_id: z.string().describe("Device ID"),
    device_name: z.string().optional().describe("Human-readable device name"),
    window_days: z.number().int().positive().optional().default(30),
  },
  async ({ user_id, device_id, device_name, window_days }) =>
    text(await grantDeviceMfaBypass(sql, user_id, device_id, device_name ?? null, window_days)),
);

server.tool(
  "auth_get_device_mfa_status",
  "Check if a device has an active MFA bypass",
  {
    user_id: z.string().describe("User UUID"),
    device_id: z.string().describe("Device ID"),
  },
  async ({ user_id, device_id }) =>
    text({ status: await getDeviceMfaBypassStatus(sql, user_id, device_id) }),
);

server.tool(
  "auth_revoke_device_mfa_bypass",
  "Revoke MFA bypass for a specific device",
  {
    user_id: z.string().describe("User UUID"),
    device_id: z.string().describe("Device ID"),
  },
  async ({ user_id, device_id }) =>
    text({ revoked: await revokeDeviceMfaBypass(sql, user_id, device_id) }),
);

server.tool(
  "auth_revoke_all_mfa_bypasses",
  "Revoke all MFA bypasses for a user (all trusted devices)",
  { user_id: z.string().describe("User UUID") },
  async ({ user_id }) =>
    text({ revoked_count: await revokeAllMfaBypasses(sql, user_id) }),
);

server.tool(
  "auth_record_mfa_bypass_use",
  "Record that a device was used to bypass MFA (updates last_bypassed_at timestamp)",
  {
    user_id: z.string().describe("User UUID"),
    device_id: z.string().describe("Device ID"),
  },
  async ({ user_id, device_id }) => {
    await recordMfaBypassUse(sql, user_id, device_id);
    return text({ recorded: true });
  },
);

server.tool(
  "auth_list_trusted_mfa_devices",
  "List all trusted MFA bypass devices for a user",
  { user_id: z.string().describe("User UUID") },
  async ({ user_id }) => text(await listTrustedMfaDevices(sql, user_id)),
);

// --- IP brute force detection tools ---

server.tool(
  "auth_record_ip_failed_attempt",
  "Record a failed login attempt from an IP address and get updated block status",
  {
    ip_address: z.string().describe("IP address"),
    user_id: z.string().optional().describe("User UUID if available"),
  },
  async ({ ip_address, user_id }) =>
    text(await recordIpFailedAttempt(sql, ip_address, user_id)),
);

server.tool(
  "auth_record_ip_success",
  "Record a successful login from an IP — resets attempt counter",
  { ip_address: z.string().describe("IP address") },
  async ({ ip_address }) => {
    await recordIpSuccessfulLogin(sql, ip_address);
    return text({ ok: true });
  },
);

server.tool(
  "auth_get_ip_block_status",
  "Get the current brute-force block status for an IP address",
  { ip_address: z.string().describe("IP address") },
  async ({ ip_address }) => text(await getIpBlockStatus(sql, ip_address)),
);

server.tool(
  "auth_is_ip_login_allowed",
  "Check if login attempts from an IP should be allowed",
  { ip_address: z.string().describe("IP address") },
  async ({ ip_address }) => text(await isIpLoginAllowed(sql, ip_address)),
);

// ── Device Trust ────────────────────────────────────────────────────────────

server.tool(
  "auth_get_device_trust",
  "Get the trust score and risk level for a device",
  { device_id: z.string() },
  async ({ device_id }) => text(await getDeviceTrust(sql, device_id)),
);

server.tool(
  "auth_get_device_trust_score",
  "Get the computed trust score (0-100) and risk level for a device",
  { device_id: z.string() },
  async ({ device_id }) => text(await getDeviceTrustScore(sql, device_id)),
);

server.tool(
  "auth_refresh_device_trust",
  "Record a login attempt and refresh the device trust score",
  {
    device_id: z.string(),
    user_id: z.string(),
    successful: z.boolean(),
    is_verified: z.boolean().optional(),
  },
  async (opts) => text(await recordDeviceLoginAndScore(sql, opts.device_id, opts.user_id, opts)),
);

server.tool(
  "auth_mark_device_verified",
  "Mark a device as verified (e.g. after passkey enrollment)",
  { device_id: z.string() },
  async ({ device_id }) => text(await markDeviceVerified(sql, device_id)),
);

server.tool(
  "auth_list_user_devices_by_trust",
  "List all devices for a user sorted by trust score (highest first)",
  { user_id: z.string() },
  async ({ user_id }) => text(await listUserDevicesByTrust(sql, user_id)),
);

server.tool(
  "auth_list_high_risk_devices",
  "List all high-risk devices for a user (trust score < 40)",
  { user_id: z.string() },
  async ({ user_id }) => text(await listHighRiskDevices(sql, user_id)),
);

// ── Passkey MFA ──────────────────────────────────────────────────────────────

server.tool(
  "auth_create_passkey_mfa_challenge",
  "Create a new passkey MFA challenge for a user and credential",
  { user_id: z.string(), credential_id: z.string() },
  async (opts) => text(await createMfaChallenge(sql, opts)),
);

server.tool(
  "auth_verify_passkey_mfa",
  "Verify a WebAuthn assertion response for MFA",
  {
    challenge_id: z.string(),
    credential_id: z.string(),
    authenticator_data: z.string(),
    client_data_json: z.string(),
    signature: z.string(),
    user_id: z.string(),
  },
  async (opts) => text(await verifyMfaAssertion(sql, opts)),
);

server.tool(
  "auth_list_pending_mfa_challenges",
  "List active pending MFA challenges for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await listPendingMfaChallenges(sql, user_id)),
);

// ── Auth Risk Scoring ────────────────────────────────────────────────────────

server.tool(
  "auth_compute_risk_score",
  "Compute a risk score from fraud signals (impossible travel, new device, velocity, etc.)",
  {
    impossible_travel_score: z.number().optional(),
    new_device_score: z.number().optional(),
    login_velocity_score: z.number().optional(),
    credential_stuffing_score: z.number().optional(),
    device_trust_score: z.number().optional(),
    ip_blocked: z.boolean().optional(),
    geo_anomaly: z.boolean().optional(),
    user_risk_history: z.number().optional(),
  },
  async (opts) => {
    const { score, riskLevel, signals } = computeAuthRiskScore({
      impossibleTravel: opts.impossible_travel_score !== undefined
        ? { risk_score: opts.impossible_travel_score, reason: "", passed: opts.impossible_travel_score < 50 }
        : undefined,
      newDevice: opts.new_device_score !== undefined
        ? { risk_score: opts.new_device_score, reason: "", passed: opts.new_device_score < 50 }
        : undefined,
      loginVelocity: opts.login_velocity_score !== undefined
        ? { risk_score: opts.login_velocity_score, reason: "", passed: opts.login_velocity_score < 50 }
        : undefined,
      credentialStuffing: opts.credential_stuffing_score !== undefined
        ? { risk_score: opts.credential_stuffing_score, reason: "", passed: opts.credential_stuffing_score < 50 }
        : undefined,
      deviceTrustScore: opts.device_trust_score,
      ipBlockStatus: opts.ip_blocked ? { blocked: true } : undefined,
      geoAnomaly: opts.geo_anomaly,
      userRiskHistory: opts.user_risk_history,
    });
    const action = getRecommendedAction(riskLevel);
    return text({ score, risk_level: riskLevel, signals, ...action });
  },
);

server.tool(
  "auth_record_risk_event",
  "Record a risk event with score, signals, and triggered rules",
  {
    user_id: z.string().optional(),
    session_id: z.string().optional(),
    event_type: z.enum(["login_risk", "token_refresh_risk", "api_auth_risk"]),
    risk_score: z.number(),
    risk_level: z.enum(["low", "medium", "high", "critical"]),
    signals: z.record(z.any()).optional(),
    triggered_rules: z.array(z.string()).optional(),
    action_taken: z.string().optional(),
    ip_address: z.string().optional(),
    user_agent: z.string().optional(),
    device_id: z.string().optional(),
  },
  async (opts) => text(await recordAuthRiskEvent(sql, opts as any)),
);

server.tool(
  "auth_get_recent_risk_events",
  "Get recent risk events for a user",
  { user_id: z.string(), limit: z.number().optional().default(10) },
  async ({ user_id, limit }) => text(await getRecentRiskEvents(sql, user_id, limit)),
);

server.tool(
  "auth_get_user_average_risk_score",
  "Get the average historical risk score for a user over N days",
  { user_id: z.string(), days_back: z.number().optional().default(30) },
  async ({ user_id, days_back }) => text(await getUserAverageRiskScore(sql, user_id, days_back)),
);

server.tool(
  "auth_list_high_risk_events",
  "List all high/critical risk events in the last N hours",
  { hours: z.number().optional().default(24) },
  async ({ hours }) => text(await listHighRiskEvents(sql, hours)),
);

// Device trust policies

server.tool(
  "auth_compute_device_trust_score",
  "Compute trust score for a device (0-100) based on age, login frequency, auth method, failed logins",
  { device_id: z.string(), user_id: z.string() },
  async ({ device_id, user_id }) => text(await computeDeviceTrustScore(sql, device_id, user_id)),
);

server.tool(
  "auth_apply_trust_policy",
  "Apply the workspace trust policy to auto-trust or revoke a device",
  { device_id: z.string(), user_id: z.string() },
  async ({ device_id, user_id }) => text(await applyTrustPolicy(sql, device_id, user_id)),
);

server.tool(
  "auth_upsert_trust_policy",
  "Set per-workspace device trust thresholds (auto-trust above threshold, revoke below threshold)",
  {
    workspace_id: z.string().optional(),
    auto_trust_threshold: z.number().optional(),
    auto_revoke_threshold: z.number().optional(),
    require_reauth_on_decline: z.boolean().optional(),
    enabled: z.boolean().optional(),
  },
  async (opts) => text(await upsertTrustPolicy(sql, opts.workspace_id ?? null, opts)),
);

server.tool(
  "auth_get_trust_policy",
  "Get the effective trust policy for a workspace",
  { workspace_id: z.string().optional() },
  async ({ workspace_id }) => text(await getTrustPolicy(sql, workspace_id ?? null)),
);

// --- Prometheus Metrics tools ---

server.tool(
  "auth_export_prometheus_metrics",
  "Export auth metrics in Prometheus text format",
  {
    workspace_id: z.string().optional(),
    since_hours: z.number().optional().default(1),
  },
  async ({ workspace_id, since_hours }) => {
    const { exportAuthMetrics } = await import("../lib/auth-prometheus-metrics.js");
    const since = new Date(Date.now() - since_hours * 3600_000);
    return text(await exportAuthMetrics(sql, workspace_id, since));
  },
);

server.tool(
  "auth_metrics_json",
  "Export auth metrics as structured JSON",
  {
    workspace_id: z.string().optional(),
    since_hours: z.number().optional().default(1),
  },
  async ({ workspace_id, since_hours }) => {
    const { exportAuthMetricsJSON } = await import("../lib/auth-prometheus-metrics.js");
    const since = new Date(Date.now() - since_hours * 3600_000);
    return text(await exportAuthMetricsJSON(sql, workspace_id, since));
  },
);

// --- Session Anomaly tools ---

server.tool(
  "auth_detect_session_anomalies",
  "Detect anomalies in a user session (unusual time, IP change, concurrent sessions, etc.)",
  { session_id: z.string(), user_id: z.string() },
  async ({ session_id, user_id }) => {
    const { detectSessionAnomalies, recordSessionAnomalies } = await import("../lib/session-anomaly.js");
    const anomalies = await detectSessionAnomalies(sql, user_id, session_id);
    if (anomalies.length > 0) {
      await recordSessionAnomalies(sql, anomalies);
    }
    return text({ anomalies });
  },
);

server.tool(
  "auth_get_user_session_pattern",
  "Get typical session pattern for a user (login hours, IPs, devices, duration)",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { getUserSessionPattern } = await import("../lib/session-anomaly.js");
    return text(await getUserSessionPattern(sql, user_id));
  },
);

server.tool(
  "auth_get_recent_session_anomalies",
  "Get recent session anomalies for a user",
  { user_id: z.string(), hours: z.number().optional().default(24) },
  async ({ user_id, hours }) => {
    const { getRecentSessionAnomalies } = await import("../lib/session-anomaly.js");
    return text(await getRecentSessionAnomalies(sql, user_id, hours));
  },
);

// --- Brute Force Analytics tools ---

server.tool(
  "auth_get_brute_force_stats",
  "Get brute force attack statistics for a time window",
  {
    workspace_id: z.string().optional(),
    hours: z.number().optional().default(24),
  },
  async ({ workspace_id, hours }) => {
    const { getBruteForceStats } = await import("../lib/brute-force-analytics.js");
    return text(await getBruteForceStats(sql, workspace_id, hours));
  },
);

server.tool(
  "auth_detect_brute_force_campaigns",
  "Detect coordinated brute force campaigns targeting the same accounts from multiple IPs",
  {
    workspace_id: z.string().optional(),
    hours: z.number().optional().default(24),
  },
  async ({ workspace_id, hours }) => {
    const { detectBruteForceCampaigns } = await import("../lib/brute-force-analytics.js");
    return text(await detectBruteForceCampaigns(sql, workspace_id, hours));
  },
);

server.tool(
  "auth_get_most_targeted_accounts",
  "Get accounts most targeted by brute force attacks",
  {
    workspace_id: z.string().optional(),
    hours: z.number().optional().default(24),
    limit: z.number().optional().default(10),
  },
  async ({ workspace_id, hours, limit }) => {
    const { getMostTargetedAccounts } = await import("../lib/brute-force-analytics.js");
    return text(await getMostTargetedAccounts(sql, workspace_id, hours, limit));
  },
);

server.tool(
  "auth_get_ip_brute_force_stats",
  "Get brute force statistics for a specific IP address",
  {
    ip: z.string(),
    hours: z.number().optional().default(24),
  },
  async ({ ip, hours }) => {
    const { getIpBruteForceStats } = await import("../lib/brute-force-analytics.js");
    return text(await getIpBruteForceStats(sql, ip, hours));
  },
);

// --- MFA Enrollment tools ---

server.tool(
  "auth_get_mfa_status",
  "Get MFA enrollment status for a user (TOTP and passkey MFA)",
  { user_id: z.string().describe("User ID") },
  async ({ user_id }) => {
    const { getMfaStatus } = await import("../lib/mfa-enrollments.js");
    return text(await getMfaStatus(sql, user_id));
  },
);

server.tool(
  "auth_enroll_totp",
  "Enroll a user in TOTP MFA (first step: store secret and backup codes)",
  {
    user_id: z.string().describe("User ID"),
    secret: z.string().describe("Base32-encoded TOTP secret"),
    backup_codes: z.array(z.string()).describe("Array of backup codes"),
    algorithm: z.enum(["SHA1", "SHA256", "SHA512"]).optional().default("SHA1"),
    digits: z.number().optional().default(6),
    period: z.number().optional().default(30),
  },
  async ({ user_id, secret, backup_codes, algorithm, digits, period }) => {
    const { enrollTotp } = await import("../lib/mfa-enrollments.js");
    await enrollTotp(sql, user_id, secret, backup_codes, { algorithm, digits, period });
    return text({ enrolled: true });
  },
);

server.tool(
  "auth_verify_totp_enrollment",
  "Verify a TOTP code during enrollment (second step of TOTP setup)",
  {
    user_id: z.string().describe("User ID"),
    code: z.string().describe("TOTP code from authenticator app"),
  },
  async ({ user_id, code }) => {
    const { verifyTotpEnrollment } = await import("../lib/mfa-enrollments.js");
    return text({ verified: await verifyTotpEnrollment(sql, user_id, code) });
  },
);

server.tool(
  "auth_disable_totp",
  "Disable TOTP MFA for a user",
  { user_id: z.string().describe("User ID") },
  async ({ user_id }) => {
    const { disableTotpEnrollment } = await import("../lib/mfa-enrollments.js");
    return text({ disabled: await disableTotpEnrollment(sql, user_id) });
  },
);

server.tool(
  "auth_verify_totp_code",
  "Verify a TOTP code during an MFA challenge (login step-up)",
  {
    user_id: z.string().describe("User ID"),
    code: z.string().describe("TOTP code from authenticator app"),
  },
  async ({ user_id, code }) => {
    const { verifyTotpCode } = await import("../lib/mfa-enrollments.js");
    return text({ valid: await verifyTotpCode(sql, user_id, code) });
  },
);

server.tool(
  "auth_consume_totp_backup_code",
  "Consume a TOTP backup code (single-use)",
  {
    user_id: z.string().describe("User ID"),
    code: z.string().describe("Backup code"),
  },
  async ({ user_id, code }) => {
    const { consumeTotpBackupCode } = await import("../lib/mfa-enrollments.js");
    return text(await consumeTotpBackupCode(sql, user_id, code));
  },
);

server.tool(
  "auth_list_mfa_enabled_users",
  "List all users with MFA enabled (for admin dashboards)",
  {
    method: z.enum(["totp", "passkey"]).optional().describe("Filter by MFA method"),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ method, limit, offset }) => {
    const { listMfaEnabledUsers } = await import("../lib/mfa-enrollments.js");
    return text(await listMfaEnabledUsers(sql, { method, limit, offset }));
  },
);

server.tool(
  "auth_device_session_analytics",
  "Get device and session analytics for a user",
  {
    user_id: z.string().describe("User ID"),
    days: z.number().optional().default(30).describe("Number of days to look back"),
  },
  async ({ user_id, days }) => {
    const { listUserDevices } = await import("../lib/devices.js");
    const { getActiveSessions } = await import("../lib/session-forensics.js");
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [devices, sessions] = await Promise.all([
      listUserDevices(sql, user_id),
      getActiveSessions(sql, user_id, since),
    ]);

    const activeDeviceCount = devices.filter(d => d.active).length;
    const sessionCount = sessions.length;

    return text({
      devices: { total: devices.length, active: activeDeviceCount },
      sessions: { active: sessionCount },
    });
  },
);

// --- Passkey stats tools ---

server.tool(
  "auth_get_passkey_stats",
  "Get comprehensive passkey statistics for a user (device types, backup status, usage frequency)",
  { user_id: z.string().describe("User UUID") },
  async ({ user_id }) => text(await getPasskeyStats(sql, user_id)),
);

// --- Session security audit tools ---

server.tool(
  "auth_session_security_audit",
  "Perform a comprehensive security audit of all active sessions for a user, detecting issues like excessive sessions, diverse IPs, stale sessions, and missing user agents",
  { user_id: z.string().describe("User UUID") },
  async ({ user_id }) => text(await getSessionSecurityAudit(sql, user_id)),
);

// --- Auth flow tools ---

server.tool(
  "auth_register",
  "Register a new user with email and password",
  {
    email: z.string(),
    password: z.string(),
    name: z.string().optional(),
  },
  async ({ email, password, name }) =>
    text(await register(sql, { email, password, name })),
);

server.tool(
  "auth_login",
  "Authenticate a user with email and password, returning tokens",
  {
    email: z.string(),
    password: z.string(),
    ip: z.string().optional(),
    user_agent: z.string().optional(),
  },
  async ({ email, password, ip, user_agent }) =>
    text(await login(sql, { email, password, ip, userAgent: user_agent })),
);

server.tool(
  "auth_refresh_tokens",
  "Refresh access and refresh tokens using a refresh token",
  {
    refresh_token: z.string(),
  },
  async ({ refresh_token }) =>
    text(await refreshTokens(sql, refresh_token)),
);

server.tool(
  "auth_hash_password",
  "Hash a password using Argon2id (for custom registration flows)",
  { password: z.string().describe("Plain text password to hash") },
  async ({ password }) => text({ hash: await hashPassword(password) }),
);

server.tool(
  "auth_verify_password",
  "Verify a password against an Argon2id hash",
  {
    password: z.string().describe("Plain text password"),
    hash: z.string().describe("Argon2id password hash to verify against"),
  },
  async ({ password, hash }) => text({ valid: await verifyPassword(password, hash) }),
);

server.tool(
  "auth_validate_api_key",
  "Validate an API key and return its associated workspace and scopes",
  { api_key: z.string() },
  async ({ api_key }) =>
    text(await validateApiKey(sql, api_key)),
);

server.tool(
  "auth_get_user_by_email",
  "Look up a user by their email address",
  { email: z.string() },
  async ({ email }) =>
    text(await getUserByEmail(sql, email)),
);

server.tool(
  "auth_count_users",
  "Count total users, optionally filtered by verification status",
  {
    verified: z.boolean().optional(),
  },
  async ({ verified }) =>
    text({ count: await countUsers(sql, { verified } ) }),
);

server.tool(
  "auth_get_failed_attempt_count",
  "Get the number of failed login attempts for an email or IP",
  {
    identifier: z.string().describe("Email or IP address"),
    window_minutes: z.number().optional().default(15),
  },
  async ({ identifier, window_minutes }) =>
    text({ count: await getFailedAttemptCount(sql, identifier, window_minutes) }),
);

server.tool(
  "auth_get_passkey_by_credential_id",
  "Look up a passkey by its credential ID",
  { credential_id: z.string() },
  async ({ credential_id }) =>
    text(await getPasskeyByCredentialId(sql, credential_id)),
);

server.tool(
  "auth_detect_session_anomalies",
  "Run anomaly detection on a user's sessions (unusual IP, time, device patterns)",
  {
    user_id: z.string(),
    sensitivity: z.number().optional().default(0.5),
  },
  async ({ user_id, sensitivity }) =>
    text(await detectSessionAnomalies(sql, user_id, sensitivity)),
);

server.tool(
  "auth_get_user_session_pattern",
  "Get the learned session pattern for a user (typical login times, devices, IPs)",
  { user_id: z.string() },
  async ({ user_id }) =>
    text(await getUserSessionPattern(sql, user_id)),
);

server.tool(
  "auth_get_recent_session_anomalies",
  "Get recently detected session anomalies for a workspace",
  {
    workspace_id: z.string(),
    since: z.string().optional(),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, since, limit }) =>
    text(await getRecentSessionAnomalies(sql, workspace_id, since, limit)),
);

server.tool(
  "auth_record_session_anomalies",
  "Record detected anomalies for a session",
  {
    session_id: z.string(),
    anomalies: z.array(z.object({
      type: z.string(),
      severity: z.string(),
      description: z.string(),
    })),
  },
  async ({ session_id, anomalies }) =>
    text(await recordSessionAnomalies(sql, session_id, anomalies as any)),
);

// --- MFA Enrollment tools ---

server.tool(
  "auth_enroll_totp",
  "Enroll a user in TOTP 2FA — generates a secret and QR URI",
  { user_id: z.string() },
  async ({ user_id }) =>
    text(await enrollTotp(sql, user_id)),
);

server.tool(
  "auth_verify_totp_enrollment",
  "Verify and activate a TOTP enrollment with a valid code",
  {
    user_id: z.string(),
    code: z.string(),
  },
  async ({ user_id, code }) =>
    text(await verifyTotpEnrollment(sql, user_id, code)),
);

server.tool(
  "auth_disable_totp",
  "Disable TOTP 2FA for a user",
  { user_id: z.string() },
  async ({ user_id }) =>
    text(await disableTotpEnrollment(sql, user_id)),
);

server.tool(
  "auth_verify_totp_code",
  "Verify a TOTP code during login as a second factor",
  {
    user_id: z.string(),
    code: z.string(),
  },
  async ({ user_id, code }) =>
    text(await verifyTotpCode(sql, user_id, code)),
);

server.tool(
  "auth_consume_totp_backup_code",
  "Consume a TOTP backup code during login",
  {
    user_id: z.string(),
    code: z.string(),
  },
  async ({ user_id, code }) =>
    text(await consumeTotpBackupCode(sql, user_id, code)),
);

server.tool(
  "auth_get_backup_code_count",
  "Get the remaining backup code count for a user",
  { user_id: z.string() },
  async ({ user_id }) =>
    text({ remaining: await getBackupCodeCount(sql, user_id) }),
);

server.tool(
  "auth_get_mfa_status",
  "Get MFA enrollment status for a user (TOTP, passkey, backup codes)",
  { user_id: z.string() },
  async ({ user_id }) =>
    text(await getMfaStatus(sql, user_id)),
);

server.tool(
  "auth_is_mfa_enabled",
  "Check whether MFA is enabled for a specific user",
  { user_id: z.string() },
  async ({ user_id }) =>
    text({ enabled: await isMfaEnabledForUser(sql, user_id) }),
);

server.tool(
  "auth_list_mfa_enabled_users",
  "List all users who have MFA enabled in a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) =>
    text(await listMfaEnabledUsers(sql, workspace_id)),
);

// --- Prometheus metrics ---

server.tool(
  "auth_export_prometheus_metrics",
  "Export auth metrics in Prometheus text format",
  {
    workspace_id: z.string().optional(),
    include_histograms: z.boolean().optional().default(true),
  },
  async ({ workspace_id, include_histograms }) =>
    text(await toPrometheusTextFormat(
      await exportAuthMetrics(sql, workspace_id),
      include_histograms,
    )),
);

server.tool(
  "auth_export_metrics_json",
  "Export auth metrics as structured JSON",
  { workspace_id: z.string().optional() },
  async ({ workspace_id }) =>
    text(await exportAuthMetricsJSON(sql, workspace_id)),
);

// --- Brute force analytics ---

server.tool(
  "auth_get_brute_force_stats",
  "Get brute force attack statistics for a time window",
  {
    workspace_id: z.string().optional().describe("Filter by workspace UUID"),
    hours: z.number().int().positive().optional().default(24).describe("Time window in hours"),
  },
  async ({ workspace_id, hours }) => text(await getBruteForceStats(sql, workspace_id, hours)),
);

server.tool(
  "auth_detect_brute_force_campaigns",
  "Detect coordinated brute force attack campaigns by IP patterns",
  {
    workspace_id: z.string().optional().describe("Filter by workspace UUID"),
    min_attempts: z.number().int().positive().optional().default(5),
  },
  async ({ workspace_id, min_attempts }) =>
    text(await detectBruteForceCampaigns(sql, workspace_id, min_attempts)),
);

server.tool(
  "auth_get_ip_brute_force_stats",
  "Get brute force statistics for a specific IP address",
  {
    ip_address: z.string().describe("IP address to analyze"),
    hours: z.number().int().positive().optional().default(24),
  },
  async ({ ip_address, hours }) =>
    text(await getIpBruteForceStats(sql, ip_address, hours)),
);

server.tool(
  "auth_get_most_targeted_accounts",
  "Get accounts most frequently targeted by brute force attacks",
  {
    workspace_id: z.string().optional().describe("Filter by workspace UUID"),
    limit: z.number().int().positive().optional().default(10),
  },
  async ({ workspace_id, limit }) =>
    text(await getMostTargetedAccounts(sql, workspace_id, limit)),
);

// --- Workspace role lookup ---

server.tool(
  "auth_get_member_role",
  "Get a user's role in a workspace",
  { workspace_id: z.string(), user_id: z.string() },
  async ({ workspace_id, user_id }) =>
    text({ role: await getMemberRole(sql, workspace_id, user_id) }),
);

// --- User management helpers ---

server.tool(
  "auth_count_users",
  "Count total users, optionally filtered by workspace",
  { workspace_id: z.string().optional() },
  async ({ workspace_id }) =>
    text({ count: await countUsers(sql, workspace_id) }),
);

server.tool(
  "auth_get_user_by_email",
  "Look up a user by their email address",
  { email: z.string() },
  async ({ email }) => text(await getUserByEmail(sql, email)),
);

// --- Device utilities ---

server.tool(
  "auth_touch_device",
  "Update the last-seen timestamp on a device",
  { device_id: z.string() },
  async ({ device_id }) => text({ updated: await touchDevice(sql, device_id) }),
);

// --- MFA maintenance ---

server.tool(
  "auth_prune_expired_mfa_challenges",
  "Delete expired MFA challenge records from the database",
  { older_than_hours: z.number().int().positive().optional().default(24) },
  async ({ older_than_hours }) =>
    text({ pruned: await pruneExpiredMfaChallenges(sql, older_than_hours) }),
);

// --- Extended device & passkey management ---

server.tool(
  "auth_revoke_all_devices",
  "Revoke all devices for a user (all sessions terminated)",
  { user_id: z.string() },
  async ({ user_id }) => text({ revoked: await revokeAllUserDevices(sql, user_id) }),
);

server.tool(
  "auth_get_device",
  "Get a single device by ID",
  { device_id: z.string() },
  async ({ device_id }) => text(await getDevice(sql, device_id)),
);

server.tool(
  "auth_build_passkey_registration",
  "Build WebAuthn registration options for a new passkey (first step of passkey enrollment)",
  {
    user_id: z.string(),
    user_name: z.string(),
    user_display_name: z.string().optional(),
    timeout: z.number().optional(),
  },
  async ({ user_id, user_name, user_display_name, timeout }) => {
    const opts = await buildRegistrationOptions(sql, user_id, user_name, user_display_name, timeout);
    return text(opts);
  },
);

server.tool(
  "auth_build_passkey_authentication",
  "Build WebAuthn authentication options for a passkey login",
  {
    user_id: z.string(),
    timeout: z.number().optional(),
  },
  async ({ user_id, timeout }) => {
    const opts = await buildAuthenticationOptions(sql, user_id, timeout);
    return text(opts);
  },
);

server.tool(
  "auth_get_passkey_stats",
  "Get aggregate passkey statistics for a workspace (total, active, stale)",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await getPasskeyStats(sql, workspace_id)),
);

// --- JWT gap tools ---

server.tool(
  "auth_sign_jwt",
  "Sign a JWT with a custom payload and expiration (for service-to-service tokens)",
  {
    sub: z.string().describe("Subject (user ID)"),
    email: z.string().describe("Email address"),
    type: z.enum(["access", "refresh"]).default("access"),
    expires_in_seconds: z.number().int().positive().optional().default(900),
  },
  async ({ sub, email, type, expires_in_seconds }) =>
    text({ token: await signJwt({ sub, email, type }, expires_in_seconds) }),
);

server.tool(
  "auth_verify_jwt",
  "Verify and decode a JWT, returning its payload",
  { token: z.string() },
  async ({ token }) => text(await verifyJwt(token)),
);

server.tool(
  "auth_generate_access_token",
  "Generate a short-lived access token (15 min) for a user",
  {
    user_id: z.string(),
    email: z.string(),
  },
  async ({ user_id, email }) =>
    text({ token: await generateAccessToken(user_id, email) }),
);

server.tool(
  "auth_generate_refresh_token",
  "Generate a long-lived refresh token (30 days) for a user",
  {
    user_id: z.string(),
    email: z.string(),
  },
  async ({ user_id, email }) =>
    text({ token: await generateRefreshToken(user_id, email) }),
);

// --- Session management gap tools ---

server.tool(
  "auth_create_session",
  "Create a new session for a user with optional device/IP tracking",
  {
    user_id: z.string(),
    ip: z.string().optional(),
    user_agent: z.string().optional(),
    device_id: z.string().optional(),
    device_name: z.string().optional(),
    is_trusted: z.boolean().optional().default(false),
    ttl_seconds: z.number().int().positive().optional(),
  },
  async ({ user_id, ip, user_agent, device_id, device_name, is_trusted, ttl_seconds }) =>
    text(await createSession(sql, user_id, { ip, user_agent, device_id, device_name, is_trusted, ttlSeconds: ttl_seconds })),
);

server.tool(
  "auth_get_session_by_token",
  "Look up a session by its token",
  { token: z.string() },
  async ({ token }) => text(await getSessionByToken(sql, token)),
);

server.tool(
  "auth_clean_expired_sessions",
  "Delete all expired sessions from the database and return count of deleted rows",
  {},
  async () => text({ deleted: await cleanExpiredSessions(sql) }),
);

server.tool(
  "auth_trust_device",
  "Mark a device as trusted for a user (extends session trust, skips MFA for that device)",
  {
    user_id: z.string(),
    device_id: z.string(),
    device_name: z.string().optional(),
    fingerprint: z.string().optional(),
    user_agent: z.string().optional(),
    ip_address: z.string().optional(),
  },
  async ({ user_id, device_id, device_name, fingerprint, user_agent, ip_address }) =>
    text(await trustDevice(sql, user_id, device_id, { deviceName: device_name, fingerprint, userAgent: user_agent, ipAddress: ip_address })),
);

server.tool(
  "auth_is_device_trusted",
  "Check whether a device is in the trusted devices list for a user",
  { user_id: z.string(), device_id: z.string() },
  async ({ user_id, device_id }) =>
    text({ trusted: await isDeviceTrusted(sql, user_id, device_id) }),
);

server.tool(
  "auth_list_trusted_devices",
  "List all trusted devices for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await listTrustedDevices(sql, user_id)),
);

// --- Magic link gap tools ---

server.tool(
  "auth_create_magic_link_token",
  "Create a single-use magic link token for passwordless login",
  { user_id: z.string() },
  async ({ user_id }) => text({ token: await createMagicLinkToken(sql, user_id) }),
);

server.tool(
  "auth_create_email_verify_token",
  "Create a single-use email verification token",
  { user_id: z.string() },
  async ({ user_id }) => text({ token: await createEmailVerifyToken(sql, user_id) }),
);

server.tool(
  "auth_create_password_reset_token",
  "Create a single-use password reset token",
  { user_id: z.string() },
  async ({ user_id }) => text({ token: await createPasswordResetToken(sql, user_id) }),
);

server.tool(
  "auth_verify_magic_link_token",
  "Verify a magic link token and return the user ID (marks token as used)",
  { token: z.string() },
  async ({ token }) => text(await verifyMagicLinkToken(sql, token)),
);

server.tool(
  "auth_verify_password_reset_token",
  "Verify a password reset token and return the user ID",
  { token: z.string() },
  async ({ token }) => text(await verifyPasswordResetToken(sql, token)),
);

// ─── Session Anomaly Detection ───────────────────────────────────────────────

server.tool(
  "auth_detect_session_anomaly",
  "Detect anomalies in a user's session patterns — flags suspicious activity like impossible travel, unusual hours, or erratic behavior",
  {
    user_id: z.string().describe("User ID to analyze"),
    session_id: z.string().optional().describe("Specific session ID to check (checks all if omitted)"),
  },
  async ({ user_id, session_id }) => {
    const { detectSessionAnomalies } = await import("../lib/session-anomaly.js");
    return text(await detectSessionAnomalies(sql, user_id, session_id));
  },
);

server.tool(
  "auth_get_session_security_audit",
  "Get a full security audit for a user's sessions — anomaly summary, trust scores, active threats, recent auth events",
  {
    user_id: z.string().describe("User ID to audit"),
    days: z.number().optional().default(7).describe("Look back window in days"),
  },
  async ({ user_id, days }) => {
    const { getSessionSecurityAudit } = await import("../lib/session-anomaly.js");
    return text(await getSessionSecurityAudit(sql, user_id, days));
  },
);

server.tool(
  "auth_list_recent_session_anomalies",
  "List recently detected session anomalies for a workspace",
  {
    workspace_id: z.string().optional().describe("Workspace ID to filter by"),
    user_id: z.string().optional().describe("User ID to filter by"),
    limit: z.number().optional().default(20),
    acknowledged: z.boolean().optional().describe("Filter by acknowledged status"),
  },
  async ({ workspace_id, user_id, limit, acknowledged }) => {
    const { getRecentSessionAnomalies } = await import("../lib/session-anomaly.js");
    return text(await getRecentSessionAnomalies(sql, { workspaceId: workspace_id, userId: user_id, limit, acknowledged }));
  },
);

// ─── API Key Scoped Access ────────────────────────────────────────────────────

server.tool(
  "auth_can_access_resource",
  "Check if an API key can perform a specific action on a resource (based on its scopes)",
  {
    key_id: z.string().describe("API key ID"),
    resource: z.string().describe("Resource name (e.g. 'memory', 'llm', 'sessions')"),
    action: z.enum(["create", "read", "update", "delete"]).describe("Action to check"),
  },
  async ({ key_id, resource, action }) => {
    const { hasScopePermission, getDetailedKeyInfo } = await import("../lib/api-key-scopes.js");
    const keyInfo = await getDetailedKeyInfo(sql, key_id);
    if (!keyInfo) return text({ allowed: false, reason: "Key not found" });
    const allowed = hasScopePermission(keyInfo.scopes as any, `${resource}:${action}` as any) ||
                    hasScopePermission(keyInfo.scopes as any, "admin" as any);
    return text({ allowed, scopes: keyInfo.scopes });
  },
);

server.tool(
  "auth_get_api_key_usage_stats",
  "Get usage statistics for an API key — request counts, daily breakdown, endpoint hit counts",
  {
    key_id: z.string().describe("API key ID"),
    since: z.string().optional().describe("ISO date — start of window (default 7 days ago)"),
  },
  async ({ key_id, since }) => {
    const { getApiKeyUsageStats } = await import("../lib/api-key-scopes.js");
    const sinceDate = since ? new Date(since) : undefined;
    return text(await getApiKeyUsageStats(sql, key_id, sinceDate));
  },
);

server.tool(
  "auth_log_api_key_usage",
  "Log an API key usage event for an endpoint call — enables per-key audit trail and rate limit tracking",
  {
    key_id: z.string().describe("API key ID"),
    endpoint: z.string().describe("API endpoint called"),
    method: z.string().describe("HTTP method"),
    status_code: z.number().int().describe("HTTP status code returned"),
    response_time_ms: z.number().int().optional().default(0),
  },
  async ({ key_id, endpoint, method, status_code, response_time_ms }) => {
    const { logApiKeyUsage } = await import("../lib/api-key-scopes.js");
    await logApiKeyUsage(sql, key_id, endpoint, method, status_code, response_time_ms);
    return text({ logged: true });
  },
);

// ─── MFA Enrollment Tools ─────────────────────────────────────────────────────

server.tool(
  "auth_mfa_get_status",
  "Get MFA enrollment status for a user (TOTP enrolled, backup codes remaining)",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { getMfaStatus } = await import("../lib/mfa-enrollments.js");
    return text(await getMfaStatus(sql, user_id));
  },
);

server.tool(
  "auth_mfa_verify_code",
  "Verify a TOTP code during MFA login flow",
  {
    user_id: z.string(),
    code: z.string().describe("6-digit TOTP code"),
  },
  async ({ user_id, code }) => {
    const { verifyTotpCode } = await import("../lib/mfa-enrollments.js");
    return text({ valid: await verifyTotpCode(sql, user_id, code) });
  },
);

server.tool(
  "auth_mfa_get_backup_codes",
  "Get remaining backup code count for a user (does not expose codes)",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { getBackupCodeCount } = await import("../lib/mfa-enrollments.js");
    return text({ remaining: await getBackupCodeCount(sql, user_id) });
  },
);

server.tool(
  "auth_mfa_consume_backup_code",
  "Consume a backup code during MFA recovery",
  {
    user_id: z.string(),
    code: z.string().describe("Backup code"),
  },
  async ({ user_id, code }) => {
    const { consumeTotpBackupCode } = await import("../lib/mfa-enrollments.js");
    return text({ valid: await consumeTotpBackupCode(sql, user_id, code) });
  },
);

// ─── Account Lockout Tools ────────────────────────────────────────────────────

server.tool(
  "auth_check_lockout",
  "Check if a user account is currently locked out",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { isLockedOut } = await import("../lib/lockout.js");
    return text({ locked: await isLockedOut(sql, user_id) });
  },
);

server.tool(
  "auth_unlock_account",
  "Manually unlock a user account that is in lockout state",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { unlockAccount } = await import("../lib/lockout.js");
    return text({ unlocked: await unlockAccount(sql, user_id) });
  },
);

server.tool(
  "auth_list_lockouts",
  "List all currently active account lockouts (locked users with timestamps)",
  async () => {
    const { listActiveLockouts } = await import("../lib/lockout.js");
    return text(await listActiveLockouts(sql));
  },
);

server.tool(
  "auth_clear_lockout",
  "Clear failed login attempts and unlock an account",
  {
    user_id: z.string(),
    clear_only: z.boolean().optional().default(false).describe("If true, only clear attempts without unlocking"),
  },
  async ({ user_id, clear_only }) => {
    const { clearFailedAttempts, unlockAccount } = await import("../lib/lockout.js");
    await clearFailedAttempts(sql, user_id);
    if (!clear_only) await unlockAccount(sql, user_id);
    return text({ cleared: true });
  },
);

// ─── Fraud Detection Tools ─────────────────────────────────────────────────────

server.tool(
  "auth_check_fraud",
  "Run fraud detection checks on a login attempt (impossible travel, new device, velocity, credential stuffing)",
  {
    user_id: z.string(),
    ip_address: z.string().optional(),
    user_agent: z.string().optional(),
    login_timestamp: z.string().datetime().optional(),
  },
  async ({ user_id, ip_address, user_agent, login_timestamp }) => {
    const { checkLoginFraud } = await import("../lib/fraud-detection.js");
    return text(await checkLoginFraud(sql, user_id, {
      ip: ip_address,
      userAgent: user_agent,
      timestamp: login_timestamp ? new Date(login_timestamp) : undefined,
    }));
  },
);

server.tool(
  "auth_check_impossible_travel",
  "Detect impossible travel — user appears to login from two geographically distant locations within short time",
  {
    user_id: z.string(),
    ip_address: z.string(),
  },
  async ({ user_id, ip_address }) => {
    const { checkImpossibleTravel } = await import("../lib/fraud-detection.js");
    return text(await checkImpossibleTravel(sql, user_id, ip_address));
  },
);

server.tool(
  "auth_check_credential_stuffing",
  "Check if credentials appear in known breach databases (pattern-based check)",
  {
    email: z.string().describe("User email to check"),
    password_hash: z.string().optional().describe("Optional password hash to check against HIBP patterns"),
  },
  async ({ email, password_hash }) => {
    const { checkCredentialStuffing } = await import("../lib/fraud-detection.js");
    return text(await checkCredentialStuffing(sql, email, password_hash));
  },
);

// ─── Password History ─────────────────────────────────────────────────────────

server.tool(
  "auth_check_password_history",
  "Check if a password was recently used by this user (prevents password reuse)",
  {
    user_id: z.string(),
    password: z.string().describe("Password to check against history"),
  },
  async ({ user_id, password }) => {
    const { checkPasswordAgainstHistory } = await import("../lib/password-history.js");
    return text({ reused: await checkPasswordAgainstHistory(sql, user_id, password) });
  },
);

server.tool(
  "auth_add_password_to_history",
  "Add a password hash to user's password history after password change",
  {
    user_id: z.string(),
    password_hash: z.string().describe("Hashed password to store"),
  },
  async ({ user_id, password_hash }) => {
    const { addPasswordToHistory } = await import("../lib/password-history.js");
    await addPasswordToHistory(sql, user_id, password_hash);
    return text({ added: true });
  },
);

// ─── Audit Export JSON ───────────────────────────────────────────────────────

server.tool(
  "auth_export_audit_json",
  "Export audit log as formatted JSON for compliance reporting",
  {
    user_id: z.string().optional(),
    event_type: z.string().optional().describe("Filter by event type"),
    since: z.string().optional().describe("ISO timestamp — start of window"),
    limit: z.number().optional().default(1000),
  },
  async ({ user_id, event_type, since, limit }) => {
    const { exportAuditLog } = await import("../lib/audit-log.js");
    return text({ export: await exportAuditLog(sql, { userId: user_id, eventType: event_type as any, since: since ? new Date(since) : undefined, format: "json", limit }) });
  },
);

// ─── Permission Delegation ───────────────────────────────────────────────────

server.tool(
  "auth_create_delegation",
  "Grant another user temporary permission to act on your behalf",
  {
    grantor_id: z.string().describe("User ID granting the delegation"),
    grantee_id: z.string().describe("User ID receiving the delegated permissions"),
    scopes: z.array(z.string()).describe("Scopes to delegate (e.g. ['memory:read', 'llm:chat'])"),
    reason: z.string().optional().describe("Reason for delegation"),
    ttl_hours: z.number().int().positive().optional().default(24),
  },
  async ({ grantor_id, grantee_id, scopes, reason, ttl_hours }) =>
    text(await createDelegation(sql, grantor_id, grantee_id, scopes, { reason, ttlHours: ttl_hours })),
);

server.tool(
  "auth_revoke_delegation",
  "Revoke a permission delegation before it expires",
  {
    delegation_id: z.string().describe("Delegation ID to revoke"),
    grantor_id: z.string().describe("User ID who originally granted the delegation"),
  },
  async ({ delegation_id, grantor_id }) =>
    text({ revoked: await revokeDelegation(sql, delegation_id, grantor_id) }),
);

server.tool(
  "auth_get_active_delegations",
  "Get all active delegations for a user (as grantee or grantor)",
  {
    user_id: z.string().describe("User ID"),
    role: z.enum(["grantee", "grantor"]).optional().default("grantee"),
  },
  async ({ user_id, role }) =>
    text(role === "grantor"
      ? await getActiveDelegationsForGrantor(sql, user_id)
      : await getActiveDelegationsForGrantee(sql, user_id)),
);

server.tool(
  "auth_check_delegated_scope",
  "Check if a user has a specific delegated scope from any active delegation",
  {
    grantee_id: z.string().describe("User ID of the potential grantee"),
    required_scope: z.string().describe("Scope to check (e.g. 'memory:write')"),
  },
  async ({ grantee_id, required_scope }) => {
    const scopes = await checkDelegatedScope(sql, grantee_id, required_scope);
    return text({ has_scope: scopes !== null, delegated_scopes: scopes });
  },
);

server.tool(
  "auth_get_delegation_summary",
  "Get a summary of all delegations (given and received) for a user",
  { user_id: z.string().describe("User ID") },
  async ({ user_id }) => text(await getDelegationSummary(sql, user_id)),
);

// ─── Auth Timeout Policies ────────────────────────────────────────────────────

server.tool(
  "auth_upsert_timeout_policy",
  "Set or update a session timeout policy (workspace-level or user-level)",
  {
    workspace_id: z.string().optional().describe("Workspace ID (omit for user-level)"),
    user_id: z.string().optional().describe("User ID (omit for workspace-level)"),
    session_max_age_seconds: z.number().int().positive().optional().default(86400),
    session_idle_timeout_seconds: z.number().int().positive().optional().default(3600),
    require_reauth_on_inactive_seconds: z.number().int().positive().optional(),
    enabled: z.boolean().optional().default(true),
  },
  async (opts) =>
    text(await upsertTimeoutPolicy(sql, {
      workspaceId: opts.workspace_id,
      userId: opts.user_id,
      sessionMaxAgeSeconds: opts.session_max_age_seconds,
      sessionIdleTimeoutSeconds: opts.session_idle_timeout_seconds,
      requireReauthOnInactiveSeconds: opts.require_reauth_on_inactive_seconds,
      enabled: opts.enabled,
    })),
);

server.tool(
  "auth_get_effective_timeout",
  "Get the effective session timeout for a user (user > workspace > global)",
  {
    user_id: z.string().describe("User ID"),
    workspace_id: z.string().optional().describe("Workspace ID"),
  },
  async ({ user_id, workspace_id }) =>
    text(await getEffectiveTimeout(sql, user_id, workspace_id)),
);

server.tool(
  "auth_is_session_idle_expired",
  "Check whether a session has exceeded its idle timeout",
  {
    session_id: z.string().describe("Session ID"),
    user_id: z.string().describe("User ID"),
    workspace_id: z.string().optional(),
  },
  async ({ session_id, user_id, workspace_id }) =>
    text(await isSessionIdleExpired(sql, session_id, user_id, workspace_id)),
);

server.tool(
  "auth_list_timeout_policies",
  "List all timeout policies for a workspace (user-level and workspace-level)",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => text(await listWorkspaceTimeoutPolicies(sql, workspace_id)),
);

// ─── Suspicious Activity Detection ────────────────────────────────────────────

server.tool(
  "auth_record_suspicious_activity",
  "Record a detected suspicious auth activity",
  {
    user_id: z.string().optional().describe("Affected user ID"),
    workspace_id: z.string().optional().describe("Workspace ID"),
    activity_type: z.enum(["burst_logins", "geo_impossible", "many_failed_attempts",
      "unusual_hour", "password_spray", "credential_stuffing", "token_cloning", "permission_escalation"]),
    severity: z.enum(["low", "medium", "high", "critical"]),
    description: z.string().describe("Human-readable description of the activity"),
    ip_addresses: z.array(z.string()).optional(),
    metadata: z.record(z.any()).optional(),
  },
  async (opts) =>
    text(await recordSuspiciousActivity(sql, {
      userId: opts.user_id,
      workspaceId: opts.workspace_id,
      activityType: opts.activity_type,
      severity: opts.severity,
      description: opts.description,
      ipAddresses: opts.ip_addresses,
      metadata: opts.metadata,
    })),
);

server.tool(
  "auth_detect_burst_logins",
  "Detect burst logins — many successful logins in a short window (potential bot or token cloning)",
  {
    user_id: z.string().describe("User ID to check"),
    window_seconds: z.number().int().positive().optional().default(60),
    threshold: z.number().int().positive().optional().default(5),
  },
  async ({ user_id, window_seconds, threshold }) =>
    text(await detectBurstLogins(sql, user_id, { windowSeconds: window_seconds, threshold })),
);

server.tool(
  "auth_detect_password_spray",
  "Detect password spray attack — same IP attempting many different accounts",
  {
    ip_address: z.string().describe("IP address to analyze"),
    window_minutes: z.number().int().positive().optional().default(15),
    account_threshold: z.number().int().positive().optional().default(3),
  },
  async ({ ip_address, window_minutes, account_threshold }) =>
    text(await detectPasswordSpray(sql, ip_address, { windowMinutes: window_minutes, accountThreshold: account_threshold })),
);

server.tool(
  "auth_get_unresolved_activities",
  "Get all unresolved suspicious activities for a workspace",
  {
    workspace_id: z.string().optional(),
    limit: z.number().int().positive().optional().default(50),
    min_severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  },
  async ({ workspace_id, limit, min_severity }) =>
    text(await getUnresolvedActivities(sql, workspace_id, { limit, minSeverity: min_severity })),
);

server.tool(
  "auth_resolve_suspicious_activity",
  "Mark a suspicious activity as resolved or false positive",
  {
    activity_id: z.string().describe("Activity ID to resolve"),
    resolved_by: z.string().describe("User ID of the analyst resolving it"),
    false_positive: z.boolean().optional().default(false),
  },
  async ({ activity_id, resolved_by, false_positive }) =>
    text({ resolved: await resolveSuspiciousActivity(sql, activity_id, resolved_by, { falsePositive: false_positive }) }),
);

server.tool(
  "auth_get_user_activity_summary",
  "Get a summary of suspicious activities for a user (for security dashboards)",
  {
    user_id: z.string().describe("User ID"),
    days: z.number().int().positive().optional().default(30),
  },
  async ({ user_id, days }) => text(await getUserActivitySummary(sql, user_id, days)),
);

// --- Fresh Token Reuse Detection ---

server.tool(
  "auth_record_token_issuance",
  "Record a token issuance event for fresh token reuse detection",
  {
    token_hash: z.string().describe("SHA-256 hash of the token (NOT the raw token)"),
    user_id: z.string().describe("User ID who was issued the token"),
    workspace_id: z.string().optional().describe("Workspace ID"),
    ip_address: z.string().optional().describe("IP address of issuance"),
    user_agent: z.string().optional().describe("User agent of issuance"),
  },
  async ({ token_hash, user_id, workspace_id, ip_address, user_agent }) =>
    text(await recordTokenIssuance(sql, token_hash, user_id, { workspaceId: workspace_id, ipAddress: ip_address, userAgent: user_agent })),
);

server.tool(
  "auth_record_token_usage",
  "Record a token usage event and check for fresh reuse (reuse within seconds of issuance)",
  {
    token_hash: z.string().describe("SHA-256 hash of the token (NOT the raw token)"),
    user_id: z.string().describe("User ID presenting the token"),
    workspace_id: z.string().optional().describe("Workspace ID"),
    ip_address: z.string().optional().describe("IP address of usage"),
    user_agent: z.string().optional().describe("User agent of usage"),
    freshness_window_ms: z.number().int().positive().optional().default(5000).describe("Window in ms to consider as fresh reuse (default 5000)"),
  },
  async ({ token_hash, user_id, workspace_id, ip_address, user_agent, freshness_window_ms }) =>
    text(await recordTokenUsage(sql, token_hash, user_id, { workspaceId: workspace_id, ipAddress: ip_address, userAgent: user_agent, freshnessWindowMs: freshness_window_ms })),
);

server.tool(
  "auth_get_fresh_token_alerts",
  "Get fresh token reuse alerts — flags tokens reused immediately after issuance (potential theft)",
  {
    workspace_id: z.string().optional().describe("Filter by workspace ID"),
    user_id: z.string().optional().describe("Filter by user ID"),
    unresolved_only: z.boolean().optional().default(false).describe("Only show unresolved alerts"),
    severity: z.enum(["low", "medium", "high", "critical"]).optional().describe("Filter by severity"),
    limit: z.number().int().positive().optional().default(50),
  },
  async ({ workspace_id, user_id, unresolved_only, severity, limit }) =>
    text(await getFreshTokenAlerts(sql, { workspaceId: workspace_id, userId: user_id, unresolvedOnly: unresolved_only, severity, limit })),
);

server.tool(
  "auth_resolve_fresh_token_alert",
  "Resolve a fresh token reuse alert after investigation",
  {
    alert_id: z.string().describe("Alert ID to resolve"),
    resolved_by: z.string().optional().describe("User ID who resolved it"),
  },
  async ({ alert_id, resolved_by }) =>
    text(await resolveFreshTokenAlert(sql, alert_id, resolved_by)),
);

server.tool(
  "auth_get_fresh_token_stats",
  "Get fresh token reuse statistics for a workspace — alert counts, severity breakdown, avg reuse window",
  {
    workspace_id: z.string().describe("Workspace ID"),
    since: z.string().optional().describe("ISO date — start of window (default 30 days ago)"),
  },
  async ({ workspace_id, since }) =>
    text(await getFreshTokenStats(sql, workspace_id, since)),
);

// ─── Auth Health Checks ────────────────────────────────────────────────────────

server.tool(
  "auth_get_health",
  "Run all auth health checks (database, session cleanup, token health, login attempts) and return a combined report",
  {},
  async () => text(await getAuthHealth(sql)),
);

server.tool(
  "auth_get_readiness",
  "Check if the auth service is ready to serve traffic — verifies DB connectivity and session cleanup is functional",
  {},
  async () => text(await getAuthReadiness(sql)),
);

server.tool(
  "auth_get_liveness",
  "Check if the auth service is alive (basic liveness probe — always returns alive if the process is running)",
  {},
  async () => text(await getAuthLiveness()),
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// --- OAuth2 Authorization Code Exchange ---

server.tool(
  "auth_create_authorization_code",
  "Create a new OAuth2 authorization code for the authorization_code grant flow",
  {
    user_id: z.string().describe("User ID granting authorization"),
    client_id: z.string().describe("OAuth client ID"),
    redirect_uri: z.string().describe("Redirect URI the client will use"),
    scopes: z.array(z.string()).describe("Requested scopes"),
    code_challenge: z.string().optional().describe("PKCE code challenge (SHA-256 hash of verifier)"),
    code_challenge_method: z.enum(["S256", "plain"]).optional().describe("PKCE method"),
    nonce: z.string().optional().describe("OIDC nonce value to include in ID token"),
    state: z.string().optional().describe("CSRF state parameter"),
    ttl_seconds: z.number().int().positive().optional().default(600).describe("Code TTL in seconds"),
  },
  async ({ user_id, client_id, redirect_uri, scopes, code_challenge, code_challenge_method, nonce, state, ttl_seconds }) => {
    const { createAuthorizationCode } = await import("../lib/oauth-code-exchange.js");
    const result = await createAuthorizationCode(sql, {
      userId: user_id, clientId: client_id, redirectUri: redirect_uri, scopes,
      codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method,
      nonce, state, ttlSeconds: ttl_seconds,
    });
    return text(result);
  },
);

server.tool(
  "auth_exchange_authorization_code",
  "Exchange an OAuth2 authorization code for an access/refresh token pair — completes the authorization_code flow",
  {
    code: z.string().describe("Authorization code from the redirect"),
    client_id: z.string().describe("OAuth client ID"),
    redirect_uri: z.string().describe("Redirect URI (must match the one used in authorization)"),
    code_verifier: z.string().optional().describe("PKCE code verifier (required if code_challenge was used)"),
  },
  async ({ code, client_id, redirect_uri, code_verifier }) => {
    const { exchangeAuthorizationCode } = await import("../lib/oauth-code-exchange.js");
    const tokens = await exchangeAuthorizationCode(sql, { code, clientId: client_id, redirectUri: redirect_uri, codeVerifier: code_verifier });
    return text(tokens);
  },
);

server.tool(
  "auth_validate_authorization_code",
  "Validate an OAuth2 authorization code without consuming it — check if it's valid before exchanging",
  {
    code: z.string().describe("Authorization code to validate"),
    client_id: z.string().describe("OAuth client ID to verify"),
  },
  async ({ code, client_id }) => {
    const { validateAuthorizationCode } = await import("../lib/oauth-code-exchange.js");
    return text(await validateAuthorizationCode(sql, { code, clientId: client_id }));
  },
);

server.tool(
  "auth_revoke_authorization_codes",
  "Revoke all authorization codes for a user and client pair — used during logout or consent revocation",
  {
    user_id: z.string().describe("User ID"),
    client_id: z.string().describe("OAuth client ID"),
  },
  async ({ user_id, client_id }) => {
    const { revokeAuthorizationCodes } = await import("../lib/oauth-code-exchange.js");
    const count = await revokeAuthorizationCodes(sql, { userId: user_id, clientId: client_id });
    return text({ revoked_count: count });
  },
);

// --- Session forensics ---

server.tool(
  "auth_get_active_sessions_forensic",
  "Get all active sessions for a user with full metadata for security auditing — no tokens exposed",
  { user_id: z.string().describe("User ID") },
  async ({ user_id }) => {
    const { getActiveSessions } = await import("../lib/session-forensics.js");
    const sessions = await getActiveSessions(sql, user_id);
    return text({ sessions, count: sessions.length });
  },
);

server.tool(
  "auth_record_login_event",
  "Record a login event for security forensics and audit trail",
  {
    user_id: z.string().describe("User ID"),
    event_type: z.enum(["login_success", "login_failure", "logout", "token_refresh", "passkey_success"]).describe("Type of login event"),
    ip: z.string().optional().describe("Client IP address"),
    user_agent: z.string().optional().describe("Client user agent"),
    device_id: z.string().optional().describe("Device ID"),
    metadata: z.record(z.any()).optional().describe("Additional event metadata"),
  },
  async ({ user_id, event_type, ip, user_agent, device_id, metadata }) => {
    const { recordLoginEvent } = await import("../lib/session-forensics.js");
    await recordLoginEvent(sql, { userId: user_id, eventType: event_type, ip, userAgent: user_agent, deviceId: device_id, metadata });
    return text({ recorded: true });
  },
);

server.tool(
  "auth_get_recent_auth_events",
  "Get recent authentication events for a user — for security auditing and forensics",
  {
    user_id: z.string().describe("User ID"),
    limit: z.number().int().positive().optional().default(20),
    event_type: z.string().optional().describe("Filter by event type"),
  },
  async ({ user_id, limit, event_type }) => {
    const { getRecentAuthEvents } = await import("../lib/session-forensics.js");
    const events = await getRecentAuthEvents(sql, user_id, { limit, eventType: event_type });
    return text({ events, count: events.length });
  },
);

server.tool(
  "auth_create_session_share_link",
  "Create an expiring shareable link for a session — for collaborative debugging",
  {
    session_id: z.string().describe("Session ID to share"),
    created_by: z.string().describe("User ID creating the share link"),
    recipient_email: z.string().optional().describe("Optional recipient email"),
    expires_in_seconds: z.number().int().positive().optional().default(3600),
    max_uses: z.number().int().positive().optional().describe("Optional max number of uses"),
  },
  async ({ session_id, created_by, recipient_email, expires_in_seconds, max_uses }) => {
    const { createSessionShareLink } = await import("../lib/session-sharing.js");
    const link = await createSessionShareLink(sql, session_id, created_by, {
      recipientEmail: recipient_email,
      expiresInSeconds: expires_in_seconds,
      maxUses: max_uses,
    });
    return text({ link, share_url: `auth://session-share/${link.token}` });
  },
);

server.tool(
  "auth_validate_session_share_link",
  "Validate and consume a session share link — returns session viewer context",
  {
    token: z.string().describe("Session share link token"),
  },
  async ({ token }) => {
    const { validateSessionShareLink } = await import("../lib/session-sharing.js");
    const context = await validateSessionShareLink(sql, token);
    return text({ valid: context !== null, context });
  },
);

server.tool(
  "auth_get_concurrent_session_info",
  "Get concurrent session information for a user — shows active count vs limit",
  {
    user_id: z.string().describe("User ID"),
    max_allowed: z.number().int().positive().optional().describe("Override default max sessions"),
  },
  async ({ user_id, max_allowed }) => {
    const { getConcurrentSessionInfo } = await import("../lib/concurrent-sessions.js");
    const info = await getConcurrentSessionInfo(sql, user_id, max_allowed);
    return text(info);
  },
);

server.tool(
  "auth_enforce_session_limit",
  "Enforce concurrent session limit — revokes oldest sessions if over limit",
  {
    user_id: z.string().describe("User ID"),
    max_allowed: z.number().int().positive().optional().describe("Override default max sessions"),
  },
  async ({ user_id, max_allowed }) => {
    const { enforceConcurrentSessionLimit } = await import("../lib/concurrent-sessions.js");
    const revoked = await enforceConcurrentSessionLimit(sql, user_id, max_allowed);
    return text({ revoked_count: revoked.length, revoked_session_ids: revoked });
  },
);

server.tool(
  "auth_rotate_session_keys",
  "Rotate session encryption keys — creates new version and optionally migrates active sessions",
  {
    retire_after_versions: z.number().int().positive().optional().describe("Retire old versions after N versions remain"),
    migrate_active_sessions: z.boolean().optional().default(false).describe("Migrate active sessions to new key"),
  },
  async ({ retire_after_versions, migrate_active_sessions }) => {
    const { rotateSessionKeys } = await import("../lib/session-key-rotation.js");
    const result = await rotateSessionKeys(sql, {
      retireAfterVersions: retire_after_versions,
      migrateActiveSessions: migrate_active_sessions,
    });
    return text(result);
  },
);

server.tool(
  "auth_list_oauth_accounts",
  "List all OAuth accounts linked to a user",
  { user_id: z.string().describe("User ID") },
  async ({ user_id }) => text(await listUserOAuthAccounts(sql, user_id)),
);

server.tool(
  "auth_get_oauth_account",
  "Get a specific OAuth account by provider and provider account ID",
  { provider: z.string().describe("OAuth provider (e.g. google, github)"), provider_account_id: z.string().describe("Account ID on the provider") },
  async ({ provider, provider_account_id }) => {
    const account = await getOAuthAccount(sql, provider, provider_account_id);
    return text({ found: account !== null, account });
  },
);

server.tool(
  "auth_unlink_oauth_account",
  "Unlink an OAuth account from a user — revokes the OAuth token as well",
  { user_id: z.string().describe("User ID"), provider: z.string().describe("OAuth provider"), provider_account_id: z.string().describe("Provider account ID") },
  async ({ user_id, provider, provider_account_id }) => {
    await unlinkOAuthAccount(sql, user_id, provider, provider_account_id);
    return text({ unlinked: true });
  },
);

server.tool(
  "auth_create_permission_delegation",
  "Delegate specific permissions to another user — grantee can act on behalf of grantor for scoped resources",
  {
    grantor_id: z.string().describe("User ID granting permissions"),
    grantee_id: z.string().describe("User ID receiving permissions"),
    scopes: z.array(z.string()).describe("List of permission scopes to delegate"),
    expires_at: z.string().optional().describe("Expiration ISO-8601 datetime"),
    note: z.string().optional().describe("Human-readable note about this delegation"),
  },
  async ({ grantor_id, grantee_id, scopes, expires_at, note }) => {
    const delegation = await createDelegation(sql, grantor_id, grantee_id, scopes, { expiresAt: expires_at ? new Date(expires_at) : undefined, note });
    return text({ delegation });
  },
);

server.tool(
  "auth_list_delegations",
  "List active permission delegations — shows what permissions have been delegated to or from a user",
  { user_id: z.string().describe("User ID"), direction: z.enum(["received", "granted"]).optional().default("received").describe("Direction of delegation") },
  async ({ user_id, direction }) => {
    const delegations = direction === "received"
      ? await getActiveDelegationsForGrantee(sql, user_id)
      : await getActiveDelegationsForGrantor(sql, user_id);
    const summary = await getDelegationSummary(sql, user_id);
    return text({ delegations, summary });
  },
);

server.tool(
  "auth_revoke_delegation",
  "Revoke a permission delegation",
  { delegation_id: z.string().describe("Delegation ID to revoke") },
  async ({ delegation_id }) => {
    await revokeDelegation(sql, delegation_id);
    return text({ revoked: true });
  },
);

server.tool(
  "auth_check_delegated_scope",
  "Check if a user has a specific delegated permission from another user",
  { grantee_id: z.string().describe("User claiming delegated permission"), grantor_id: z.string().describe("User who granted permission"), scope: z.string().describe("Permission scope to check") },
  async ({ grantee_id, grantor_id, scope }) => {
    const hasPermission = await checkDelegatedScope(sql, grantee_id, grantor_id, scope);
    return text({ has_permission: hasPermission });
  },
);

server.tool(
  "auth_detect_suspicious_activity",
  "Detect suspicious login patterns — burst logins and password spray attacks",
  { workspace_id: z.string().optional().describe("Workspace ID to scan"), window_minutes: z.number().int().positive().optional().default(60).describe("Analysis window in minutes") },
  async ({ workspace_id, window_minutes }) => {
    const burstLogins = await detectBurstLogins(sql, workspace_id, window_minutes);
    const passwordSpray = await detectPasswordSpray(sql, workspace_id, window_minutes);
    return text({ burst_logins: burstLogins, password_spray: passwordSpray, window_minutes });
  },
);

server.tool(
  "auth_get_unresolved_activities",
  "Get unresolved suspicious activities for a user or workspace",
  { user_id: z.string().optional().describe("User ID"), workspace_id: z.string().optional().describe("Workspace ID"), limit: z.number().int().positive().optional().default(20) },
  async ({ user_id, workspace_id, limit }) => {
    const activities = await getUnresolvedActivities(sql, { userId: user_id, workspaceId: workspace_id, limit });
    return text({ activities, count: activities.length });
  },
);

server.tool(
  "auth_resolve_suspicious_activity",
  "Mark a suspicious activity as resolved — logs who resolved it and why",
  { activity_id: z.string().describe("Activity ID"), resolved_by: z.string().describe("User ID marking as resolved"), reason: z.string().optional().describe("Resolution reason") },
  async ({ activity_id, resolved_by, reason }) => {
    await resolveSuspiciousActivity(sql, activity_id, resolved_by, reason);
    return text({ resolved: true });
  },
);

server.tool(
  "auth_record_token_issuance",
  "Record when a token (access or refresh) is issued — used for fresh-token reuse detection",
  { user_id: z.string().describe("User ID"), token_hash: z.string().describe("SHA-256 hash of the token"), token_type: z.enum(["access", "refresh"]).describe("Type of token") },
  async ({ user_id, token_hash, token_type }) => {
    await recordTokenIssuance(sql, user_id, token_hash, token_type);
    return text({ recorded: true });
  },
);

server.tool(
  "auth_get_timeout_policy",
  "Get the effective session timeout policy for a workspace or user",
  { workspace_id: z.string().optional().describe("Workspace ID"), user_id: z.string().optional().describe("User ID") },
  async ({ workspace_id, user_id }) => {
    const policy = await getEffectiveTimeout(sql, workspace_id, user_id);
    return text(policy);
  },
);

server.tool(
  "auth_upsert_timeout_policy",
  "Set or update session timeout policy for a workspace",
  { workspace_id: z.string().describe("Workspace ID"), idle_timeout_seconds: z.number().int().nonnegative().optional(), absolute_timeout_seconds: z.number().int().nonnegative().optional(), scope: z.enum(["workspace", "user"]).optional().default("workspace") },
  async ({ workspace_id, idle_timeout_seconds, absolute_timeout_seconds, scope }) => {
    const policy = await upsertTimeoutPolicy(sql, workspace_id, { idleTimeoutSeconds: idle_timeout_seconds, absoluteTimeoutSeconds: absolute_timeout_seconds, scope });
    return text({ policy });
  },
);

server.tool(
  "auth_list_workspace_timeout_policies",
  "List all session timeout policies for a workspace (includes workspace-level and user-level policies)",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => text(await listWorkspaceTimeoutPolicies(sql, workspace_id)),
);

server.tool(
  "auth_delete_timeout_policy",
  "Delete a session timeout policy by scope",
  { workspace_id: z.string().optional().describe("Workspace ID (required for workspace-level policy)"), user_id: z.string().optional().describe("User ID (required for user-level policy)") },
  async ({ workspace_id, user_id }) => {
    if (!workspace_id && !user_id) throw new Error("Either workspace_id or user_id must be provided");
    const deleted = await deleteTimeoutPolicy(sql, workspace_id, user_id);
    return text({ deleted });
  },
);

server.tool(
  "auth_validate_client_credentials",
  "Validate OAuth client credentials (client_id + client_secret) — returns whether the credentials are valid",
  { client_id: z.string().describe("OAuth client ID"), client_secret: z.string().describe("OAuth client secret") },
  async ({ client_id, client_secret }) => {
    const valid = await validateClientCredentials(sql, client_id, client_secret);
    return text({ valid });
  },
);

server.tool(
  "auth_validate_oauth_token",
  "Validate an OAuth access token and return its payload if valid",
  { token: z.string().describe("OAuth access token to validate") },
  async ({ token }) => {
    const payload = await validateOAuthToken(sql, token);
    return text({ valid: !!payload, payload: payload || null });
  },
);

server.tool(
  "auth_revoke_all_user_client_tokens",
  "Revoke all OAuth tokens for a specific user and client combination",
  { user_id: z.string().describe("User ID"), client_id: z.string().describe("OAuth client ID") },
  async ({ user_id, client_id }) => {
    const count = await revokeAllUserClientTokens(sql, user_id, client_id);
    return text({ revoked: count });
  },
);

main().catch(console.error);
