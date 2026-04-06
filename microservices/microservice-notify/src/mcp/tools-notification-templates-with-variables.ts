// --- Notification templates with variables ---

server.tool(
  "notify_create_template_vars",
  "Create a notification template with {{variable}} placeholder support",
  {
    workspace_id: z.string().optional(),
    name: z.string(),
    channel_type: z.string().optional(),
    subject_template: z.string().optional(),
    body_template: z.string(),
    variables: z.array(z.string()).optional(),
  },
  async (data) =>
    text(await createNotificationTemplate(sql, {
      workspaceId: data.workspace_id,
      name: data.name,
      channelType: data.channel_type,
      subjectTemplate: data.subject_template,
      bodyTemplate: data.body_template,
      variables: data.variables,
    })),
);

server.tool(
  "notify_render_template",
  "Render a notification template by ID with variable substitution",
  {
    template_id: z.string(),
    variables: z.record(z.string()),
  },
  async ({ template_id, variables }) => {
    const result = await renderNotificationTemplateById(sql, template_id, variables);
    return text(result);
  },
);

server.tool(
  "notify_list_templates_vars",
  "List all notification templates with variable support",
  {
    workspace_id: z.string().optional(),
  },
  async ({ workspace_id }) =>
    text(await listNotificationTemplates(sql, workspace_id)),
);

server.tool(
  "notify_delete_template_vars",
  "Delete a notification template by ID",
  { id: z.string() },
  async ({ id }) => {
    const deleted = await deleteNotificationTemplate(sql, id);
    return text({ ok: deleted });
  },
);

// ── Feature 1: Notification digests ─────────────────────────────────────────

server.tool(
  "notify_create_digest",
  "Create a digest grouping multiple notifications into one",
  {
    user_id: z.string(),
    workspace_id: z.string().optional(),
    channel: ChannelSchema,
    frequency: z.enum(["hourly", "daily", "weekly"]),
    subject: z.string(),
    body: z.string(),
    notification_ids: z.array(z.string()),
    rendered_data: z.record(z.any()).optional(),
  },
  async (data) =>
    text(await createDigest(sql, {
      userId: data.user_id,
      workspaceId: data.workspace_id,
      channel: data.channel,
      frequency: data.frequency,
      subject: data.subject,
      body: data.body,
      notificationIds: data.notification_ids,
      renderedData: data.rendered_data,
    })),
);

server.tool(
  "notify_get_digest",
  "Get a digest by ID",
  { id: z.string() },
  async ({ id }) => text(await getDigest(sql, id)),
);

server.tool(
  "notify_list_digests",
  "List digests for a user",
  {
    user_id: z.string(),
    status: z.enum(["pending", "sent", "cancelled"]).optional(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ user_id, status, limit, offset }) =>
    text(await listDigests(sql, user_id, { status, limit, offset })),
);

server.tool(
  "notify_mark_digest_sent",
  "Mark a digest as sent",
  { id: z.string() },
  async ({ id }) => text(await markDigestSent(sql, id)),
);

server.tool(
  "notify_cancel_digest",
  "Cancel a pending digest",
  { id: z.string() },
  async ({ id }) => text(await cancelDigest(sql, id)),
);

server.tool(
  "notify_collect_digest_notifications",
  "Collect pending notifications for a digest and render a digest body",
  {
    user_id: z.string(),
    channel: ChannelSchema,
    limit: z.number().optional().default(20),
  },
  async ({ user_id, channel, limit }) => {
    const collected = await collectDigestNotifications(sql, user_id, channel, limit);
    const body = renderDigestBody(collected.notifications, "daily");
    return text({ ...collected, rendered_body: body });
  },
);

server.tool(
  "notify_upsert_digest_schedule",
  "Create or update a digest delivery schedule",
  {
    user_id: z.string(),
    workspace_id: z.string().optional(),
    channel: ChannelSchema,
    frequency: z.enum(["hourly", "daily", "weekly"]),
    hour_of_day: z.number().int().min(0).max(23).optional(),
    day_of_week: z.number().int().min(0).max(6).optional(),
  },
  async (data) =>
    text(await upsertDigestSchedule(sql, {
      userId: data.user_id,
      workspaceId: data.workspace_id,
      channel: data.channel,
      frequency: data.frequency,
      hourOfDay: data.hour_of_day,
      dayOfWeek: data.day_of_week,
    })),
);

server.tool(
  "notify_disable_digest_schedule",
  "Disable a digest schedule",
  {
    user_id: z.string(),
    channel: ChannelSchema,
    frequency: z.enum(["hourly", "daily", "weekly"]),
  },
  async ({ user_id, channel, frequency }) => {
    const ok = await disableDigestSchedule(sql, user_id, channel, frequency);
    return text({ ok });
  },
);

server.tool(
  "notify_list_digest_schedules",
  "List active digest schedules for a user",
  { user_id: z.string() },
  async ({ user_id }) => text(await listDigestSchedules(sql, user_id)),
);

// ── Feature 2: Exponential backoff retry ─────────────────────────────────────

server.tool(
  "notify_record_retry",
  "Record a failed delivery attempt and schedule next retry with exponential backoff",
  {
    notification_id: z.string(),
    channel: ChannelSchema,
    error: z.string(),
    attempt: z.number().int().min(0),
  },
  async ({ notification_id, channel, error, attempt }) => {
    const record = await recordRetry(sql, notification_id, channel, error, attempt);
    return text({ retry: record });
  },
);

server.tool(
  "notify_get_due_retries",
  "Get retry records that are due for processing",
  { limit: z.number().optional().default(50) },
  async ({ limit }) => text(await getDueRetries(sql, limit)),
);

server.tool(
  "notify_get_retry_history",
  "Get retry history for a notification",
  { notification_id: z.string() },
  async ({ notification_id }) => text(await getRetryHistory(sql, notification_id)),
);

server.tool(
  "notify_cancel_retries",
  "Cancel pending retries for a notification",
  { notification_id: z.string() },
  async ({ notification_id }) => text({ cancelled: await cancelRetries(sql, notification_id) }),
);

server.tool(
  "notify_clear_retries",
  "Clear all retry records for a notification (after successful send)",
  { notification_id: z.string() },
  async ({ notification_id }) => {
    await clearRetries(sql, notification_id);
    return text({ ok: true });
  },
);

server.tool(
  "notify_retry_stats",
  "Get retry statistics per channel",
  {
    workspace_id: z.string().optional(),
    channel: ChannelSchema.optional(),
    since: z.string().optional().describe("ISO 8601 datetime"),
  },
  async ({ workspace_id, channel, since }) =>
    text(await getRetryStats(sql, {
      workspaceId: workspace_id,
      channel,
      since: since ? new Date(since) : undefined,
    })),
);

// ── Feature 3: Delivery receipts ────────────────────────────────────────────

server.tool(
  "notify_upsert_receipt",
  "Create or update a delivery receipt",
  {
    notification_id: z.string(),
    channel: ChannelSchema,
    provider_message_id: z.string().optional(),
    status: z.enum(["queued", "sent", "delivered", "bounced", "dropped", "spam", "failed"]),
    provider_status: z.string().optional(),
    provider_response: z.record(z.any()).optional(),
  },
  async (data) =>
    text(await upsertReceipt(sql, {
      notificationId: data.notification_id,
      channel: data.channel,
      providerMessageId: data.provider_message_id,
      status: data.status,
      providerStatus: data.provider_status,
      providerResponse: data.provider_response,
    })),
);

server.tool(
  "notify_get_receipt",
  "Get a delivery receipt for a notification/channel",
  { notification_id: z.string(), channel: ChannelSchema },
  async ({ notification_id, channel }) =>
    text(await getReceipt(sql, notification_id, channel)),
);

server.tool(
  "notify_list_receipts",
  "List all receipts for a notification",
  { notification_id: z.string() },
  async ({ notification_id }) => text(await listReceipts(sql, notification_id)),
);

server.tool(
  "notify_receipt_stats",
  "Get delivery receipt statistics per channel",
  {
    workspace_id: z.string().optional(),
    channel: ChannelSchema.optional(),
    since: z.string().optional().describe("ISO 8601 datetime"),
    until: z.string().optional().describe("ISO 8601 datetime"),
  },
  async ({ workspace_id, channel, since, until }) =>
    text(await getReceiptStats(sql, {
      workspaceId: workspace_id,
      channel,
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
    })),
);

server.tool(
  "notify_list_bounces",
  "List recent bounced/dropped receipts for a workspace",
  {
    workspace_id: z.string(),
    limit: z.number().optional().default(100),
    since: z.string().optional().describe("ISO 8601 datetime"),
  },
  async ({ workspace_id, limit, since }) =>
    text(await listBounces(sql, workspace_id, {
      limit,
      since: since ? new Date(since) : undefined,
    })),
);

