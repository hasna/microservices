// --- Priority tools ---

server.tool(
  "notify_get_channel_priority_matrix",
  "Get all channels with their current priority, pending count, and 24h delivery stats",
  {},
  async () => text(JSON.stringify(await getChannelPriorityMatrix(sql), null, 2)),
);

server.tool(
  "notify_evaluate_priority_boost",
  "Evaluate priority boost for a notification against enabled priority rules",
  {
    channel: z.string(),
    type: z.string(),
    title: z.string().optional(),
    body: z.string().optional(),
  },
  async ({ channel, type, title, body }) => {
    const boost = await evaluatePriorityBoost(sql, { channel, type, title, body });
    return text(JSON.stringify({ channel, type, priority_boost: boost }, null, 2));
  },
);

server.tool(
  "notify_schedule_batch",
  "Schedule multiple notifications at once. Returns created scheduled notifications.",
  {
    items: z.array(z.object({
      workspaceId: z.string().optional(),
      channelType: z.string(),
      payload: z.record(z.any()),
      scheduledFor: z.string(),
    })).min(1).max(100),
  },
  async ({ items }) => {
    const data = items.map((item) => ({
      workspaceId: item.workspaceId,
      channelType: item.channelType,
      payload: item.payload,
      scheduledFor: item.scheduledFor,
    }));
    return text(JSON.stringify(await scheduleBatch(sql, data), null, 2));
  },
);

// Unsubscribe token tools
server.tool(
  "notify_generate_unsubscribe_token",
  "Generate a secure unsubscribe token for a user and channel",
  {
    user_id: z.string(),
    channel: ChannelSchema,
    expires_in_hours: z.number().int().positive().optional().default(720),
  },
  async ({ user_id, channel, expires_in_hours }) => {
    const token = await generateUnsubscribeToken(sql, user_id, channel, expires_in_hours);
    return text({ token, user_id, channel, expires_in_hours });
  },
);

server.tool(
  "notify_verify_unsubscribe_token",
  "Verify an unsubscribe token and get the associated user/channel",
  {
    token: z.string(),
  },
  async ({ token }) => {
    const result = await verifyUnsubscribeToken(sql, token);
    if (!result.valid) return text({ valid: false, error: result.error });
    return text({ valid: true, user_id: result.userId, channel: result.channel });
  },
);

// Scheduled notification management
server.tool(
  "notify_mark_scheduled_sent",
  "Mark a scheduled notification as sent",
  {
    notification_id: z.string(),
    sent_at: z.string().datetime().optional(),
  },
  async ({ notification_id, sent_at }) => {
    await markScheduledSent(sql, notification_id, sent_at ? new Date(sent_at) : new Date());
    return text({ ok: true, notification_id });
  },
);

// Retry backoff calculator
server.tool(
  "notify_calculate_backoff",
  "Calculate the next retry delay using exponential backoff with jitter",
  {
    attempt: z.number().int().min(0),
    base_delay_ms: z.number().int().positive().optional().default(1000),
    max_delay_ms: z.number().int().positive().optional().default(60000),
    factor: z.number().min(1).optional().default(2),
  },
  async ({ attempt, base_delay_ms, max_delay_ms, factor }) => {
    const delay = calculateBackoff(attempt, { baseDelayMs: base_delay_ms, maxDelayMs: max_delay_ms, factor });
    return text({
      attempt,
      delay_ms: delay,
      delay_seconds: Math.round(delay / 1000),
      next_attempt_in_ms: delay,
    });
  },
);

// Notification lookup
server.tool(
  "notify_get_notification",
  "Get a single notification by ID",
  { id: z.string() },
  async ({ id }) => text(await getNotification(sql, id)),
);

server.tool(
  "notify_mark_all_read",
  "Mark all notifications as read for a user",
  {
    user_id: z.string(),
    channel: z.string().optional(),
    type: z.string().optional(),
  },
  async ({ user_id, channel, type }) => text({ marked: await markAllRead(sql, user_id, { channel, type }) }),
);

// Channel preference checks
server.tool(
  "notify_is_channel_enabled",
  "Check if a channel is enabled for a user and notification type",
  {
    user_id: z.string(),
    channel: z.string(),
    type: z.string(),
  },
  async ({ user_id, channel, type }) => {
    const enabled = await isChannelEnabled(sql, user_id, channel, type);
    return text({ enabled });
  },
);

// Priority rules
server.tool(
  "notify_add_priority_rule",
  "Add a dynamic priority rule for channel/type matching",
  {
    channel: z.string(),
    type: z.string(),
    boost: z.number().int(),
    description: z.string().optional(),
  },
  async ({ channel, type, boost, description }) => {
    const rule = await addPriorityRule(sql, { channel, type, boost, description });
    return text({ rule });
  },
);

// Schedule conflict detection
server.tool(
  "notify_check_schedule_window",
  "Check if a user has overlapping scheduled notifications within a time window — returns conflict pairs",
  {
    user_id: z.string(),
    channel_type: z.string(),
    window_minutes: z.number().int().positive().optional().default(60),
  },
  async ({ user_id, channel_type, window_minutes }) =>
    text(await getScheduleConflicts(sql, { userId: user_id, channelType: channel_type, windowMinutes: window_minutes })),
);

// Webhook endpoint management
server.tool(
  "notify_create_webhook_endpoint",
  "Register a webhook endpoint to receive notification events",
  {
    workspace_id: z.string(),
    url: z.string().url(),
    events: z.array(z.string()),
    secret: z.string().optional(),
    name: z.string().optional(),
  },
  async ({ workspace_id, url, events, secret, name }) => {
    const endpoint = await createWebhookEndpoint(sql, { workspaceId: workspace_id, url, events, secret, name });
    return text({ endpoint });
  },
);

server.tool(
  "notify_list_webhooks",
  "List all webhook endpoints for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await listWorkspaceWebhooks(sql, workspace_id)),
);

server.tool(
  "notify_update_webhook_endpoint",
  "Update a webhook endpoint URL, events, or active status",
  {
    id: z.string(),
    url: z.string().url().optional(),
    events: z.array(z.string()).optional(),
    active: z.boolean().optional(),
  },
  async ({ id, url, events, active }) => {
    await updateWebhookEndpoint(sql, { id, url, events, active });
    return text({ ok: true });
  },
);

server.tool(
  "notify_delete_webhook_endpoint",
  "Delete a webhook endpoint",
  { id: z.string() },
  async ({ id }) => text({ deleted: await deleteWebhookEndpoint(sql, id) }),
);

server.tool(
  "notify_trigger_webhooks",
  "Manually trigger webhooks for a specific event type",
  {
    workspace_id: z.string(),
    event_type: z.string(),
    payload: z.record(z.any()),
  },
  async ({ workspace_id, event_type, payload }) => {
    const count = await triggerWebhooks(sql, workspace_id, event_type, payload);
    return text({ triggered: count });
  },
);

// Retry subsystem health
server.tool(
  "notify_retry_health",
  "Get a health summary of the retry subsystem including stuck queues and failure rates",
  {},
  async () => text(await getRetrySubsystemHealth(sql)),
);

// Bounce management
server.tool(
  "notify_mark_bounced",
  "Mark a notification as bounced with provider details",
  {
    notification_id: z.string(),
    channel: ChannelSchema,
    bounce_type: z.enum(["hard", "soft"]),
    provider_response: z.record(z.any()).optional(),
  },
  async ({ notification_id, channel, bounce_type, provider_response }) => {
    await markBounced(sql, notification_id, channel, bounce_type, provider_response);
    return text({ ok: true });
  },
);

// Template version helpers
server.tool(
  "notify_get_latest_template_version",
  "Get the most recent version of a notification template",
  { template_id: z.string() },
  async ({ template_id }) => text(await getLatestTemplateVersion(sql, template_id)),
);

// Prometheus text export
server.tool(
  "notify_prometheus_text_format",
  "Export notify metrics in Prometheus text format for scraping",
  {},
  async () => {
    const metrics = getNotifyMetrics();
    return text({ metrics: toPrometheusTextFormat(metrics) });
  },
);

// Batch queue operations
server.tool(
  "notify_reschedule_batch",
  "Reschedule batch notification items to a new delivery time",
  {
    ids: z.array(z.string()),
    new_scheduled_at: z.string().datetime(),
  },
  async ({ ids, new_scheduled_at }) => {
    const uuidIds = ids.map((id) => { const parsed = parseInt(id, 10); return isNaN(parsed) ? id : parsed; });
    const count = await rescheduleBatchNotifications(sql, uuidIds as number[], new Date(new_scheduled_at));
    return text({ rescheduled: count });
  },
);

server.tool(
  "notify_process_batch_concurrent",
  "Process batch notifications with a configurable concurrency limit",
  {
    limit: z.number().int().positive().optional().default(50),
    channels: z.array(ChannelSchema).optional(),
  },
  async ({ limit, channels }) => {
    const result = await processBatchWithConcurrency(sql, { limit, channels });
    return text(result);
  },
);

