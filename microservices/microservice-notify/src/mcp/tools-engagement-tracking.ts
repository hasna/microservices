// ─── Engagement Tracking ─────────────────────────────────────────────────────

server.tool(
  "notify_record_click",
  "Record a click event on a notification (for CTR tracking)",
  {
    notification_id: z.string(),
    user_id: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  },
  async ({ notification_id, user_id, metadata }) => {
    const { recordClick } = await import("../lib/engagement.js");
    await recordClick(sql, notification_id, user_id, metadata);
    return text({ recorded: true });
  },
);

server.tool(
  "notify_get_engagement",
  "Get engagement metrics for a notification or workspace (open rate, CTR, conversion)",
  {
    notification_id: z.string().optional(),
    workspace_id: z.string().optional(),
    period_days: z.number().optional().default(7),
  },
  async ({ notification_id, workspace_id, period_days }) => {
    const { getNotificationEngagement } = await import("../lib/engagement.js");
    return text(await getNotificationEngagement(sql, notification_id, workspace_id, period_days));
  },
);

server.tool(
  "notify_mark_notification_read",
  "Mark a notification as read for a user",
  {
    notification_id: z.string(),
    user_id: z.string(),
  },
  async ({ notification_id, user_id }) => {
    const { markNotificationRead } = await import("../lib/engagement.js");
    await markNotificationRead(sql, notification_id, user_id);
    return text({ marked: true });
  },
);

