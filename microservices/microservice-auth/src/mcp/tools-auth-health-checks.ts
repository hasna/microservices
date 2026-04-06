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
