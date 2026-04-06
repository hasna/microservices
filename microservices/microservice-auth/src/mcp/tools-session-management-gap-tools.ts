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

