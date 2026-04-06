// --- Standalone scheduled notifications ---

server.tool(
  "notify_schedule_notification_standalone",
  "Schedule a notification for future delivery using the standalone scheduled_notifications table",
  {
    workspace_id: z.string().optional(),
    channel_type: z.string(),
    payload: z.record(z.any()),
    scheduled_for: z.string().describe("ISO 8601 datetime"),
  },
  async ({ workspace_id, channel_type, payload, scheduled_for }) =>
    text(await scheduleNotification(sql, {
      workspaceId: workspace_id,
      channelType: channel_type,
      payload,
      scheduledFor: scheduled_for,
    })),
);

server.tool(
  "notify_cancel_scheduled_standalone",
  "Cancel a pending scheduled notification from the standalone queue",
  { id: z.string() },
  async ({ id }) => text(await cancelScheduled(sql, id)),
);

server.tool(
  "notify_list_scheduled",
  "List all scheduled notifications for a workspace",
  {
    workspace_id: z.string(),
    status: z.enum(["pending", "sent", "cancelled", "failed"]).optional(),
  },
  async ({ workspace_id, status }) => text(await listScheduled(sql, workspace_id, status)),
);

server.tool(
  "notify_list_scheduled_due",
  "List pending notifications that are due before a certain time — useful for finding notifications ready to be sent",
  {
    before: z.string().describe("ISO timestamp — return notifications due before this time"),
    limit: z.number().optional().default(50),
  },
  async ({ before, limit }) => text(await listScheduledDue(sql, new Date(before), limit)),
);

