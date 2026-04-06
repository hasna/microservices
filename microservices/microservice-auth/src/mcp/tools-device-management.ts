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

