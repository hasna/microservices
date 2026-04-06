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

