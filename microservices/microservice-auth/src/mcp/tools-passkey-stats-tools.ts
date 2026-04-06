// --- Passkey stats tools ---

server.tool(
  "auth_get_passkey_stats",
  "Get comprehensive passkey statistics for a user (device types, backup status, usage frequency)",
  { user_id: z.string().describe("User UUID") },
  async ({ user_id }) => text(await getPasskeyStats(sql, user_id)),
);

