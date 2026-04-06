server.tool(
  "notify_send",
  "Send a notification to a user via the specified channel",
  {
    user_id: z.string(),
    workspace_id: z.string().optional(),
    channel: ChannelSchema,
    type: z.string(),
    title: z.string().optional(),
    body: z.string(),
    data: z.record(z.any()).optional(),
  },
  async (notifData) => {
    await sendNotification(sql, {
      userId: notifData.user_id,
      workspaceId: notifData.workspace_id,
      channel: notifData.channel,
      type: notifData.type,
      title: notifData.title,
      body: notifData.body,
      data: notifData.data,
    });
    return text({ ok: true });
  },
);

server.tool(
  "notify_list_notifications",
  "List notifications for a user",
  {
    user_id: z.string(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
    unread_only: z.boolean().optional().default(false),
    channel: z.string().optional(),
    type: z.string().optional(),
  },
  async ({ user_id, limit, offset, unread_only, channel, type }) =>
    text(
      await listUserNotifications(sql, user_id, {
        limit,
        offset,
        unreadOnly: unread_only,
        channel,
        type,
      }),
    ),
);

server.tool(
  "notify_mark_read",
  "Mark a notification as read",
  { id: z.string() },
  async ({ id }) => text(await markRead(sql, id)),
);

server.tool(
  "notify_count_unread",
  "Count unread notifications for a user",
  { user_id: z.string() },
  async ({ user_id }) => text({ count: await countUnread(sql, user_id) }),
);

server.tool(
  "notify_set_preference",
  "Set notification preference for a user/channel/type combination",
  {
    user_id: z.string(),
    channel: z.string(),
    type: z.string(),
    enabled: z.boolean(),
  },
  async ({ user_id, channel, type, enabled }) =>
    text(await setPreference(sql, user_id, channel, type, enabled)),
);

server.tool(
  "notify_create_template",
  "Create a notification template",
  {
    name: z.string(),
    subject: z.string().optional(),
    body: z.string(),
    channel: z.string().optional(),
    variables: z.array(z.string()).optional(),
  },
  async (templateData) => text(await createTemplate(sql, templateData)),
);

server.tool(
  "notify_list_templates",
  "List all notification templates",
  {},
  async () => text(await listTemplates(sql)),
);

server.tool(
  "notify_delete_notification",
  "Delete a notification by ID",
  { id: z.string() },
  async ({ id }) => {
    const deleted = await deleteNotification(sql, id);
    return text({ ok: deleted });
  },
);

server.tool(
  "notify_list_preferences",
  "List all notification preferences for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await getUserPreferences(sql, user_id)),
);

server.tool(
  "notify_get_preference",
  "Get a specific notification preference for a user/channel/type combination",
  {
    user_id: z.string(),
    channel: z.string(),
    type: z.string(),
  },
  async ({ user_id, channel, type }) => text(await getPreference(sql, user_id, channel, type)),
);

server.tool(
  "notify_delete_template",
  "Delete a notification template by ID",
  { id: z.string() },
  async ({ id }) => {
    const deleted = await deleteTemplate(sql, id);
    return text({ ok: deleted });
  },
);

server.tool(
  "notify_send_batch",
  "Send multiple notifications in batch",
  {
    notifications: z.array(z.object({
      userId: z.string(),
      workspaceId: z.string().optional(),
      channel: ChannelSchema,
      type: z.string(),
      title: z.string().optional(),
      body: z.string(),
      data: z.record(z.any()).optional(),
    })),
  },
  async ({ notifications }) => {
    const results = await sendBatch(sql, notifications as any);
    return text({
      results,
      total: notifications.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    });
  },
);

server.tool(
  "notify_schedule_notification",
  "Schedule a notification for future delivery",
  {
    user_id: z.string(),
    workspace_id: z.string().optional(),
    channel: ChannelSchema,
    type: z.string(),
    title: z.string().optional(),
    body: z.string(),
    data: z.record(z.any()).optional(),
    scheduled_at: z.string().describe("ISO 8601 datetime to send the notification"),
    priority: z.number().optional().default(5).describe("Higher priority (1-10) sent first"),
    expires_at: z.string().optional().describe("ISO 8601 datetime after which notification is dropped"),
  },
  async (notifData) => {
    const { createNotification } = await import("../lib/notifications.js");
    const notif = await createNotification(sql, {
      userId: notifData.user_id,
      workspaceId: notifData.workspace_id,
      channel: notifData.channel,
      type: notifData.type,
      title: notifData.title,
      body: notifData.body,
      data: notifData.data,
      scheduledAt: notifData.scheduled_at,
      priority: notifData.priority,
      expiresAt: notifData.expires_at,
    });
    return text({ notification: notif });
  },
);

server.tool(
  "notify_cancel_scheduled",
  "Cancel a pending scheduled notification",
  { id: z.string() },
  async ({ id }) => {
    const { cancelNotification } = await import("../lib/notifications.js");
    return text(await cancelNotification(sql, id));
  },
);

server.tool(
  "notify_reschedule",
  "Reschedule a pending notification to a new time",
  {
    id: z.string(),
    new_scheduled_at: z.string().describe("New ISO 8601 datetime"),
  },
  async ({ id, new_scheduled_at }) => {
    const { rescheduleNotification } = await import("../lib/notifications.js");
    return text(await rescheduleNotification(sql, id, new_scheduled_at));
  },
);

server.tool(
  "notify_batch_by_channel",
  "Batch-send pending notifications for a user by channel (processes high-priority first)",
  {
    user_id: z.string(),
    channel: ChannelSchema,
    limit: z.number().optional().default(20),
  },
  async ({ user_id, channel, limit }) => {
    const { batchSendByChannel } = await import("../lib/notifications.js");
    const count = await batchSendByChannel(sql, user_id, channel, limit);
    return text({ sent: count });
  },
);

server.tool(
  "notify_list_due_scheduled",
  "List notifications that are due for delivery before a given time",
  {
    before: z.string().describe("ISO 8601 datetime"),
    limit: z.number().optional().default(50),
  },
  async ({ before, limit }) => {
    const { listScheduledDue } = await import("../lib/notifications.js");
    return text(await listScheduledDue(sql, new Date(before), limit));
  },
);

