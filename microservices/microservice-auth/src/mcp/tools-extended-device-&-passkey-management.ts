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

