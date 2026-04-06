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

