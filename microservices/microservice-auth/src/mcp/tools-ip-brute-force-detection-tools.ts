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

