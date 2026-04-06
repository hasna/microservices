// ─── Quiet Hours & Snooze ─────────────────────────────────────────────────────

server.tool(
  "notify_set_quiet_hours",
  "Set quiet hours when notifications are suppressed for a user",
  {
    user_id: z.string(),
    start_hour: z.number().int().min(0).max(23),
    start_minute: z.number().int().min(0).max(59).optional().default(0),
    end_hour: z.number().int().min(0).max(23),
    end_minute: z.number().int().min(0).max(59).optional().default(0),
    timezone: z.string().optional().default("UTC"),
    channels_affected: z.array(z.string()).optional().default(["email", "in_app"]),
  },
  async (opts) => {
    const { setQuietHours } = await import("../lib/quiet-hours.js");
    return text(await setQuietHours(sql, opts.user_id, {
      startHour: opts.start_hour,
      startMinute: opts.start_minute,
      endHour: opts.end_hour,
      endMinute: opts.end_minute,
      timezone: opts.timezone,
      channelsAffected: opts.channels_affected,
    }));
  },
);

server.tool(
  "notify_get_quiet_hours",
  "Get current quiet hours for a user",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { getQuietHours } = await import("../lib/quiet-hours.js");
    return text(await getQuietHours(sql, user_id));
  },
);

server.tool(
  "notify_is_in_quiet_hours",
  "Check if current time is in quiet hours for a user+channel",
  { user_id: z.string(), channel: z.string() },
  async ({ user_id, channel }) => {
    const { isInQuietHours } = await import("../lib/quiet-hours.js");
    return text(await isInQuietHours(sql, user_id, channel));
  },
);

server.tool(
  "notify_disable_quiet_hours",
  "Disable quiet hours for a user",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { disableQuietHours } = await import("../lib/quiet-hours.js");
    await disableQuietHours(sql, user_id);
    return text({ disabled: true });
  },
);

server.tool(
  "notify_snooze_notification",
  "Snooze a notification for a specified duration",
  {
    notification_id: z.string(),
    user_id: z.string(),
    duration_minutes: z.number().int().positive().optional().default(30),
  },
  async ({ notification_id, user_id, duration_minutes }) => {
    const { snoozeNotification } = await import("../lib/quiet-hours.js");
    return text(await snoozeNotification(sql, notification_id, user_id, duration_minutes));
  },
);

server.tool(
  "notify_list_user_snoozes",
  "List all active snoozes for a user",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { listUserSnoozes } = await import("../lib/quiet-hours.js");
    return text(await listUserSnoozes(sql, user_id));
  },
);

server.tool(
  "notify_dismiss_snooze",
  "Dismiss snooze on a notification so it can be delivered immediately",
  { notification_id: z.string() },
  async ({ notification_id }) => {
    const { dismissSnooze } = await import("../lib/quiet-hours.js");
    await dismissSnooze(sql, notification_id);
    return text({ dismissed: true });
  },
);

server.tool(
  "notify_get_batch_queue_stats",
  "Get batch notification queue statistics — depth, processing state, failure rates",
  { workspace_id: z.string().optional().describe("Workspace ID") },
  async ({ workspace_id }) => {
    const stats = await getBatchQueueStats(sql, workspace_id);
    return text(stats);
  },
);

server.tool(
  "notify_enqueue_batch",
  "Enqueue multiple notifications for batch delivery — efficient bulk insertion into the batch queue",
  {
    workspace_id: z.string().describe("Workspace ID"),
    notifications: z.array(z.object({
      user_id: z.string(),
      channel: z.string(),
      type: z.string(),
      body: z.string(),
      scheduled_after: z.string().optional().describe("ISO-8601 datetime to schedule after"),
      priority: z.number().int().optional().default(0),
      data: z.record(z.any()).optional(),
    })).describe("Array of notification objects to enqueue"),
  },
  async ({ workspace_id, notifications }) => {
    const queued = await enqueueBatchNotifications(sql, workspace_id, notifications.map(n => ({
      ...n,
      scheduledAfter: n.scheduled_after ? new Date(n.scheduled_after) : undefined,
    })));
    return text({ enqueued_count: queued.length, queued_ids: queued.map((q: any) => q.id) });
  },
);

server.tool(
  "notify_dequeue_batch",
  "Dequeue notifications from the batch queue for processing — returns up to the limit",
  {
    workspace_id: z.string().describe("Workspace ID"),
    channel: z.string().optional().describe("Channel filter"),
    limit: z.number().int().positive().optional().default(50).describe("Max notifications to dequeue"),
  },
  async ({ workspace_id, channel, limit }) => {
    const items = await dequeueBatchNotifications(sql, workspace_id, { channel, limit });
    return text({ dequeued_count: items.length, items });
  },
);

server.tool(
  "notify_mark_batch_delivered",
  "Mark a batch notification as successfully delivered",
  { batch_id: z.string().describe("Batch queue item ID") },
  async ({ batch_id }) => {
    await markBatchDelivered(sql, batch_id);
    return text({ marked: true });
  },
);

server.tool(
  "notify_mark_batch_failed",
  "Mark a batch notification as failed — increments retry count",
  { batch_id: z.string().describe("Batch queue item ID"), error: z.string().optional().describe("Error message") },
  async ({ batch_id, error }) => {
    await markBatchFailed(sql, batch_id, error);
    return text({ marked: true });
  },
);

server.tool(
  "notify_get_dedup_stats",
  "Get notification deduplication statistics — hit rates, memory usage, active entries",
  { workspace_id: z.string().optional().describe("Workspace ID") },
  async ({ workspace_id }) => {
    const stats = await getDedupStats(sql, workspace_id);
    return text(stats);
  },
);

server.tool(
  "notify_check_dedup",
  "Check if a notification is a duplicate and record it — returns whether it should be sent",
  {
    workspace_id: z.string().describe("Workspace ID"),
    user_id: z.string().describe("User ID"),
    notification_type: z.string().describe("Notification type"),
    content_hash: z.string().describe("Content hash to deduplicate on"),
    ttl_seconds: z.number().int().nonnegative().optional().default(300).describe("Deduplication window in seconds"),
  },
  async ({ workspace_id, user_id, notification_type, content_hash, ttl_seconds }) => {
    const result = await checkAndRecordDedup(sql, workspace_id, user_id, notification_type, content_hash, ttl_seconds);
    return text(result);
  },
);

server.tool(
  "notify_create_delivery_window",
  "Create a delivery window — restricts when notifications can be sent to a user on specific channels",
  {
    user_id: z.string().describe("User ID"),
    channel: z.string().describe("Channel (email, sms, in_app, webhook)"),
    window_start_hour: z.number().int().min(0).max(23).describe("Start hour (0-23)"),
    window_start_minute: z.number().int().min(0).max(59).optional().default(0),
    window_end_hour: z.number().int().min(0).max(23).describe("End hour (0-23)"),
    window_end_minute: z.number().int().min(0).max(59).optional().default(0),
    timezone: z.string().optional().default("UTC"),
    enabled: z.boolean().optional().default(true),
  },
  async ({ user_id, channel, window_start_hour, window_start_minute, window_end_hour, window_end_minute, timezone, enabled }) => {
    const window = await createDeliveryWindow(sql, user_id, channel, {
      windowStartHour: window_start_hour,
      windowStartMinute: window_start_minute ?? 0,
      windowEndHour: window_end_hour,
      windowEndMinute: window_end_minute ?? 0,
      timezone: timezone ?? "UTC",
      enabled: enabled ?? true,
    });
    return text({ delivery_window: window });
  },
);

server.tool(
  "notify_check_delivery_window",
  "Check if the current time is within a user's delivery window for a channel",
  { user_id: z.string().describe("User ID"), channel: z.string().describe("Channel") },
  async ({ user_id, channel }) => {
    const result = await checkDeliveryWindow(sql, user_id, channel);
    return text(result);
  },
);

server.tool(
  "notify_list_user_delivery_windows",
  "List all delivery windows for a user",
  { user_id: z.string().describe("User ID") },
  async ({ user_id }) => {
    const windows = await listUserDeliveryWindows(sql, user_id);
    return text({ delivery_windows: windows });
  },
);

server.tool(
  "notify_set_channel_throttle",
  "Configure rate limiting for a notification channel — controls burst and sustained rates",
  {
    workspace_id: z.string().describe("Workspace ID"),
    channel: z.string().describe("Channel"),
    burst_limit: z.number().int().nonnegative().optional().describe("Max notifications per burst window"),
    sustained_limit: z.number().int().nonnegative().optional().describe("Max notifications per sustained window"),
    window_seconds: z.number().int().positive().optional().default(60).describe("Sustained window in seconds"),
  },
  async ({ workspace_id, channel, burst_limit, sustained_limit, window_seconds }) => {
    const config = await setChannelThrottle(sql, workspace_id, channel, { burstLimit: burst_limit, sustainedLimit: sustained_limit, windowSeconds: window_seconds });
    return text({ throttle: config });
  },
);

server.tool(
  "notify_get_channel_throttle",
  "Get the current throttle configuration for a channel",
  { workspace_id: z.string().describe("Workspace ID"), channel: z.string().describe("Channel") },
  async ({ workspace_id, channel }) => {
    const throttle = await getChannelThrottle(sql, workspace_id, channel);
    return text({ found: throttle !== null, throttle });
  },
);

server.tool(
  "notify_get_throttle_status",
  "Get current throttle status for a channel — remaining capacity, reset time",
  { workspace_id: z.string().describe("Workspace ID"), channel: z.string().describe("Channel") },
  async ({ workspace_id, channel }) => {
    const status = await getThrottleStatus(sql, workspace_id, channel);
    return text(status);
  },
);

server.tool(
  "notify_delete_channel_throttle",
  "Delete (reset) throttle configuration for a channel",
  { workspace_id: z.string().describe("Workspace ID"), channel: z.string().describe("Channel") },
  async ({ workspace_id, channel }) => {
    await deleteChannelThrottle(sql, workspace_id, channel);
    return text({ deleted: true });
  },
);

main().catch(console.error);
