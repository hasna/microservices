// ─── Channel Failover ─────────────────────────────────────────────────────────

server.tool(
  "notify_create_failover_rule",
  "Create a channel failover rule (primary → secondary on failure)",
  {
    workspace_id: z.string().optional(),
    user_id: z.string().optional(),
    primary_channel: z.string(),
    failover_channel: z.string(),
    trigger: z.enum(["delivery_failure", "channel_disabled", "rate_limit", "user_preference_off"]).optional().default("delivery_failure"),
    max_retries: z.number().optional().default(3),
    retry_delay_seconds: z.number().optional().default(60),
  },
  async (opts) => text(await createFailoverRule(sql, {
    workspaceId: opts.workspace_id,
    userId: opts.user_id,
    primaryChannel: opts.primary_channel,
    failoverChannel: opts.failover_channel,
    trigger: opts.trigger,
    maxRetries: opts.max_retries,
    retryDelaySeconds: opts.retry_delay_seconds,
  })),
);

server.tool(
  "notify_get_failover_rule",
  "Get the effective failover rule for a primary channel",
  {
    primary_channel: z.string(),
    user_id: z.string().optional(),
    workspace_id: z.string().optional(),
  },
  async ({ primary_channel, user_id, workspace_id }) =>
    text(await getFailoverRule(sql, primary_channel, user_id, workspace_id)),
);

server.tool(
  "notify_list_failover_rules",
  "List all failover rules for a workspace",
  { workspace_id: z.string().optional() },
  async ({ workspace_id }) => text(await listFailoverRules(sql, workspace_id)),
);

server.tool(
  "notify_get_failover_stats",
  "Get failover statistics for a workspace over a time window",
  {
    workspace_id: z.string().optional(),
    days: z.number().optional().default(7),
  },
  async ({ workspace_id, days }) =>
    text(await getFailoverStats(sql, workspace_id, days)),
);

server.tool(
  "notify_set_failover_rule_enabled",
  "Enable or disable a failover rule",
  { rule_id: z.string(), enabled: z.boolean() },
  async ({ rule_id, enabled }) =>
    text({ updated: await setFailoverRuleEnabled(sql, rule_id, enabled) }),
);

// --- Additional scheduling and retry gap tools ---

server.tool(
  "notify_get_due_retries",
  "Get retry records that are due for retry — used by retry workers to pick up failed deliveries",
  {
    limit: z.number().optional().default(50).describe("Max retry records to return"),
  },
  async ({ limit }) => {
    const due = await getDueRetries(sql, limit);
    return text({ due_retries: due, count: due.length });
  },
);

server.tool(
  "notify_get_retry_history",
  "Get the full retry history for a notification — shows all attempts with timestamps and errors",
  {
    notification_id: z.string().describe("Notification ID to get retry history for"),
  },
  async ({ notification_id }) => {
    const history = await getRetryHistory(sql, notification_id);
    return text({ notification_id, history, attempts: history.length });
  },
);

server.tool(
  "notify_cancel_retries",
  "Cancel pending retries for a notification — use when a notification is cancelled or superseded",
  {
    notification_id: z.string().describe("Notification ID to cancel retries for"),
  },
  async ({ notification_id }) => {
    const cancelled = await cancelRetries(sql, notification_id);
    return text({ cancelled_count: cancelled, notification_id });
  },
);

server.tool(
  "notify_list_scheduled_for_workspace",
  "List all scheduled notifications for a workspace, optionally filtered by status",
  {
    workspace_id: z.string().describe("Workspace ID to list scheduled notifications for"),
    status: z.enum(["pending", "sent", "cancelled", "failed"]).optional().describe("Filter by status"),
  },
  async ({ workspace_id, status }) => {
    const scheduled = await listScheduled(sql, workspace_id, status);
    return text({ scheduled, count: scheduled.length });
  },
);

server.tool(
  "notify_get_retry_stats",
  "Get per-channel retry statistics — attempts, successes, failures, and average retry count",
  {
    workspace_id: z.string().optional().describe("Filter to a specific workspace"),
    channel: z.string().optional().describe("Filter to a specific channel type"),
    since_hours: z.number().optional().default(24).describe("Look back window in hours"),
  },
  async ({ workspace_id, channel, since_hours }) => {
    const since = new Date(Date.now() - since_hours * 3600_000);
    const stats = await getRetryStats(sql, { workspaceId: workspace_id, channel, since });
    return text({ stats });
  },
);

server.tool(
  "notify_record_retry",
  "Record a failed delivery attempt and schedule a retry with exponential backoff",
  {
    notification_id: z.string().describe("Notification ID that failed"),
    channel: z.string().describe("Channel type (email, sms, in_app, webhook)"),
    error: z.string().describe("Error message from the failed delivery"),
    attempt: z.number().int().min(0).describe("Current attempt number (0-based)"),
  },
  async ({ notification_id, channel, error, attempt }) => {
    const result = await recordRetry(sql, notification_id, channel, error, attempt);
    return text({ retry: result, max_retries_exceeded: result === null });
  },
);

server.tool(
  "notify_get_channel_failover_stats",
  "Get channel failover statistics for the past N days — total failovers and success rate per channel",
  {
    workspace_id: z.string().optional().describe("Filter to a specific workspace"),
    days: z.number().optional().default(7).describe("Look back window in days"),
  },
  async ({ workspace_id, days = 7 }) => {
    const stats = await getFailoverStats(sql, workspace_id, days);
    return text({ stats });
  },
);

// --- Deduplication Tools ---
server.tool(
  "notify_check_dedup",
  "Check if a notification is a duplicate and record it in the dedup log",
  {
    user_id: z.string().describe("User ID"),
    workspace_id: z.string().describe("Workspace ID"),
    channel: z.string().describe("Channel (e.g. email, sms, push)"),
    content: z.string().describe("Notification content to hash"),
    idempotency_key: z.string().optional().describe("Optional idempotency key for dedup"),
    ttl_seconds: z.number().optional().default(300).describe("TTL for dedup entry in seconds"),
  },
  async ({ user_id, workspace_id, channel, content, idempotency_key, ttl_seconds = 300 }) => {
    const result = await checkAndRecordDedup(sql, user_id, workspace_id, channel, content, idempotency_key, ttl_seconds);
    return text(result);
  },
);

server.tool(
  "notify_coalesce_notifications",
  "Coalesce similar notifications into a single aggregated notification",
  {
    user_id: z.string().describe("User ID"),
    workspace_id: z.string().describe("Workspace ID"),
    channel: z.string().describe("Channel"),
    template_id: z.string().describe("Template ID"),
    coalesce_key: z.string().describe("Key to group similar notifications"),
    ttl_seconds: z.number().optional().default(3600).describe("Window for coalescing in seconds"),
  },
  async ({ user_id, workspace_id, channel, template_id, coalesce_key, ttl_seconds = 3600 }) => {
    const result = await coalesceNotifications(sql, user_id, workspace_id, channel, template_id, coalesce_key, ttl_seconds);
    return text(result);
  },
);

server.tool(
  "notify_get_dedup_stats",
  "Get deduplication statistics for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    days: z.number().optional().default(7).describe("Look back window in days"),
  },
  async ({ workspace_id, days = 7 }) => {
    const stats = await getDedupStats(sql, workspace_id, days);
    return text({ total_checked: stats.total_checked, duplicates_found: stats.duplicates_found, dedup_rate_pct: stats.dedup_rate_pct });
  },
);

// --- Throttle Tools ---
server.tool(
  "notify_set_channel_throttle",
  "Set throttle configuration for a workspace + channel",
  {
    workspace_id: z.string().describe("Workspace ID"),
    channel: z.string().describe("Channel (e.g. email, sms, push)"),
    rate_per_minute: z.number().describe("Max notifications per minute"),
    burst_limit: z.number().describe("Burst capacity limit"),
    window_seconds: z.number().optional().default(60).describe("Window size in seconds"),
  },
  async ({ workspace_id, channel, rate_per_minute, burst_limit, window_seconds = 60 }) => {
    const config = await setChannelThrottle(sql, workspace_id, channel, rate_per_minute, burst_limit, window_seconds);
    return text(config);
  },
);

server.tool(
  "notify_get_throttle_status",
  "Get current throttle status without consuming a token",
  {
    workspace_id: z.string().describe("Workspace ID"),
    channel: z.string().describe("Channel"),
  },
  async ({ workspace_id, channel }) => {
    const status = await getThrottleStatus(sql, workspace_id, channel);
    return text(status);
  },
);

server.tool(
  "notify_check_throttle",
  "Check if a notification is allowed under throttle limits (consumes a token)",
  {
    workspace_id: z.string().describe("Workspace ID"),
    channel: z.string().describe("Channel"),
    cost: z.number().optional().default(1).describe("Notification cost"),
  },
  async ({ workspace_id, channel, cost = 1 }) => {
    const status = await checkThrottle(sql, workspace_id, channel, cost);
    return text(status);
  },
);

server.tool(
  "notify_list_workspace_throttles",
  "List all throttle configurations for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
  },
  async ({ workspace_id }) => {
    const throttles = await listWorkspaceThrottles(sql, workspace_id);
    return text({ throttles });
  },
);

server.tool(
  "notify_delete_channel_throttle",
  "Delete a throttle configuration",
  {
    workspace_id: z.string().describe("Workspace ID"),
    channel: z.string().describe("Channel"),
  },
  async ({ workspace_id, channel }) => {
    const deleted = await deleteChannelThrottle(sql, workspace_id, channel);
    return text({ deleted });
  },
);

// --- Escalation Tools ---
server.tool(
  "notify_create_escalation_rule",
  "Create an escalation rule for a workspace + channel",
  {
    workspace_id: z.string().describe("Workspace ID"),
    channel: z.string().describe("Channel"),
    trigger_type: z.enum(["time_delay", "retry_count", "engagement_threshold", "manual"]).describe("Trigger type"),
    trigger_value: z.number().describe("Value that triggers escalation (minutes, retry count, or score threshold)"),
    priority_boost: z.number().optional().default(1).describe("Priority boost amount"),
    additional_channels: z.array(z.string()).optional().describe("Additional channels to add on escalation"),
  },
  async ({ workspace_id, channel, trigger_type, trigger_value, priority_boost = 1, additional_channels }) => {
    const rule = await createEscalationRule(sql, workspace_id, channel, { triggerType: trigger_type, triggerValue: trigger_value, priorityBoost: priority_boost, additionalChannels: additional_channels });
    return text(rule);
  },
);

server.tool(
  "notify_evaluate_escalation",
  "Evaluate escalation rules for a notification and apply if triggered",
  {
    notification_id: z.string().describe("Notification ID to evaluate"),
  },
  async ({ notification_id }) => {
    const event = await evaluateEscalation(sql, notification_id);
    return text({ escalation_event: event });
  },
);

server.tool(
  "notify_manual_escalate",
  "Manually trigger escalation for a notification",
  {
    notification_id: z.string().describe("Notification ID"),
    priority_boost: z.number().describe("Priority boost amount"),
    additional_channels: z.array(z.string()).optional().describe("Additional channels to add"),
  },
  async ({ notification_id, priority_boost, additional_channels }) => {
    const event = await manualEscalate(sql, notification_id, priority_boost, additional_channels);
    return text({ escalation_event: event });
  },
);

server.tool(
  "notify_list_escalation_rules",
  "List escalation rules for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    channel: z.string().optional().describe("Filter by specific channel"),
  },
  async ({ workspace_id, channel }) => {
    const rules = await listEscalationRules(sql, workspace_id, channel);
    return text({ rules });
  },
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

