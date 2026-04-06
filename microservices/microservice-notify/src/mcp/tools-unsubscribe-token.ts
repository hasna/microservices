// ─── Unsubscribe Token ─────────────────────────────────────────────────────────

server.tool(
  "notify_generate_unsubscribe_token",
  "Generate an unsubscribe token for a user+notification combination (用于退链)",
  {
    user_id: z.string(),
    notification_id: z.string().optional(),
    channel: z.string().optional().default("email"),
  },
  async ({ user_id, notification_id, channel }) => {
    const { generateUnsubscribeToken } = await import("../lib/unsubscribe.js");
    return text({ token: await generateUnsubscribeToken(sql, user_id, notification_id, channel) });
  },
);

server.tool(
  "notify_verify_unsubscribe_token",
  "Verify an unsubscribe token and return the associated user/notification",
  { token: z.string() },
  async ({ token }) => {
    const { verifyUnsubscribeToken } = await import("../lib/unsubscribe.js");
    return text(await verifyUnsubscribeToken(sql, token));
  },
);

