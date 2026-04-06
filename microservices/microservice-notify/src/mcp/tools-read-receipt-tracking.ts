// --- Read receipt tracking ---

server.tool(
  "notify_mark_notification_read",
  "Mark a notification as read for a specific user (per-user read receipt)",
  {
    notification_id: z.string(),
    user_id: z.string(),
  },
  async ({ notification_id, user_id }) => {
    await markNotificationRead(sql, notification_id, user_id);
    return text({ ok: true });
  },
);

server.tool(
  "notify_list_read_receipts",
  "List read receipts for a user across their notifications",
  {
    user_id: z.string(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ user_id, limit, offset }) =>
    text(await listReadReceiptsForUser(sql, user_id, limit, offset)),
);

server.tool(
  "notify_get_notification_engagement",
  "Get engagement records (delivery, read, click events) for a specific notification",
  {
    notification_id: z.string(),
  },
  async ({ notification_id }) => text(await getNotificationEngagement(sql, notification_id)),
);

