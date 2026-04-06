#!/usr/bin/env bun
/**
 * MCP server for microservice-notify.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { sendBatch } from "../lib/batch.js";
import {
  createABTest,
  getABTest,
  recordABConversion,
  getABTestResults,
  completeABTest,
  listABTests,
} from "../lib/ab-testing.js";
import {
  addToInbox,
  getInboxBadgeCount,
  listInboxItems,
  markInboxRead,
  archiveInboxItem,
  deleteInboxItem,
  pruneReadItems,
  markAllInboxRead,
} from "../lib/notification-inbox.js";
import {
  createFailoverRule,
  getFailoverRule,
  listFailoverRules,
  deleteFailoverRule,
  recordFailoverEvent,
  getFailoverStats,
  setFailoverRuleEnabled,
} from "../lib/channel-failover.js";
import {
  getChannelStats,
  getNotificationEngagement,
  listReadReceiptsForUser,
  markNotificationRead,
  recordClick,
  recordDelivery,
  recordRead,
} from "../lib/engagement.js";
import {
  countUnread,
  deleteNotification,
  getNotification,
  listScheduledDue,
  listUserNotifications,
  markAllRead,
  markRead,
} from "../lib/notifications.js";
import {
  createTemplate as createNotificationTemplate,
  deleteTemplate as deleteNotificationTemplate,
  getTemplate as getNotificationTemplate,
  listTemplates as listNotificationTemplates,
  renderTemplateById as renderNotificationTemplateById,
} from "../lib/notification_templates.js";
import { getPreference, getUserPreferences, isChannelEnabled, setPreference } from "../lib/preferences.js";
import {
  getChannelPriority,
  getChannelPriorityMatrix,
  getDeliveryQueue,
  rescheduleByPriority,
  setChannelPriority,
  addPriorityRule,
  evaluatePriorityBoost,
} from "../lib/prioritization.js";
import {
  cancelScheduled,
  getPendingScheduled,
  getScheduleConflicts,
  listScheduled,
  rescheduleScheduled,
  scheduleBatch,
  scheduleNotification,
  markScheduledSent,
} from "../lib/scheduled.js";
import { sendNotification } from "../lib/send.js";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  listWorkspaceWebhooks,
  triggerWebhooks,
  updateWebhookEndpoint,
} from "../lib/webhooks.js";
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
} from "../lib/unsubscribe.js";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  getTemplateByName,
  listTemplates,
  updateTemplate,
  renderTemplate,
} from "../lib/templates.js";
import {
  cancelDigest,
  collectDigestNotifications,
  createDigest,
  disableDigestSchedule,
  getDigest,
  listDigestSchedules,
  listDigests,
  markDigestSent,
  renderDigestBody,
  upsertDigestSchedule,
} from "../lib/digests.js";
import {
  DEFAULT_RETRY_CONFIGS,
  cancelRetries,
  clearRetries,
  getDueRetries,
  getRetryHistory,
  getRetryStats,
  getRetrySubsystemHealth,
  drainFailedRetries,
  recordRetry,
  calculateBackoff,
} from "../lib/retry.js";
import {
  getReceipt,
  getReceiptStats,
  listBounces,
  listReceipts,
  markBounced,
  upsertReceipt,
} from "../lib/receipts.js";
import {
  getEngagementFunnel,
  getEngagementTimeSeries,
} from "../lib/engagement.js";
import {
  createTemplateVersion,
  getLatestTemplateVersion,
  getTemplateVersion,
  listTemplateVersions,
  rollbackTemplate,
  getTemplateVersionDiff,
} from "../lib/template-versions.js";
import {
  archiveTemplate,
  createTemplateV2,
  getTemplateV2,
  getTemplateAnalytics,
  listTemplatesV2,
  renderTemplateV2,
  type NotificationTemplate,
  type TemplateAnalytics,
  type TemplateRenderResult,
  updateTemplateV2,
} from "../lib/notification-templates-v2.js";
import {
  dequeueBatchNotifications,
  enqueueBatchNotifications,
  getBatchQueueStats,
  markBatchDelivered,
  markBatchFailed,
  processBatchWithConcurrency,
  rescheduleBatchNotifications,
  type BatchQueueStats,
  type QueuedNotification,
} from "../lib/batch-queue.js";
import {
  exportNotifyMetrics,
  exportNotifyMetricsJSON,
  getNotifyMetrics,
  toPrometheusTextFormat,
} from "../lib/notify-prometheus-metrics.js";
import {
  generateNotificationFingerprint,
  checkAndRecordDedup,
  coalesceNotifications,
  getDedupStats,
} from "../lib/index.js";
import {
  setChannelThrottle,
  getChannelThrottle,
  checkThrottle,
  getThrottleStatus,
  listWorkspaceThrottles,
  deleteChannelThrottle,
} from "../lib/index.js";
import {
  createEscalationRule,
  evaluateEscalation,
  manualEscalate,
  listEscalationRules,
  deleteEscalationRule,
} from "../lib/index.js";

const server = new McpServer({
  name: "microservice-notify",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
// ─── A/B Testing ──────────────────────────────────────────────────────────────

server.tool(
  "notify_create_ab_test",
  "Create a new A/B test with multiple notification variants",
  {
    workspace_id: z.string().describe("Workspace ID"),
    name: z.string().describe("Test name"),
    description: z.string().optional(),
    variants: z.array(z.object({
      name: z.string(),
      template_id: z.string().optional(),
      subject_template: z.string().optional(),
      body_template: z.string().optional(),
      channel: z.string(),
      send_delay_seconds: z.number().optional(),
      weight: z.number().int().min(0).max(100),
    })).min(2).describe("At least 2 variants required"),
    target_user_ids: z.array(z.string()),
    start_at: z.string().optional(),
    end_at: z.string().optional(),
  },
  async (opts) => text(await createABTest(sql, {
    workspaceId: opts.workspace_id,
    name: opts.name,
    description: opts.description,
    variants: opts.variants,
    targetUserIds: opts.target_user_ids,
    startAt: opts.start_at,
    endAt: opts.end_at,
  })),
);

server.tool(
  "notify_get_ab_test",
  "Get an A/B test with its variants",
  { test_id: z.string() },
  async ({ test_id }) => text(await getABTest(sql, test_id)),
);

server.tool(
  "notify_list_ab_tests",
  "List A/B tests for a workspace",
  {
    workspace_id: z.string(),
    status: z.enum(["draft", "running", "paused", "completed", "cancelled"]).optional(),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, status, limit }) =>
    text(await listABTests(sql, workspace_id, { status, limit })),
);

server.tool(
  "notify_get_ab_test_results",
  "Get results for all variants in an A/B test",
  { test_id: z.string() },
  async ({ test_id }) => text(await getABTestResults(sql, test_id)),
);

server.tool(
  "notify_record_ab_conversion",
  "Record a conversion event for an A/B test variant (send, open, or click)",
  {
    variant_id: z.string().describe("Variant ID"),
    event_type: z.enum(["send", "open", "click"]),
  },
  async ({ variant_id, event_type }) => {
    await recordABConversion(sql, variant_id, event_type);
    return text({ recorded: true });
  },
);

server.tool(
  "notify_complete_ab_test",
  "Complete an A/B test and determine the winning variant",
  { test_id: z.string() },
  async ({ test_id }) => text(await completeABTest(sql, test_id)),
);


// --- Batch queue operations ---

server.tool(
  "notify_enqueue_batch_notifications",
  "Enqueue a batch of notifications for delivery processing",
  {
    notifications: z.array(z.object({
      user_id: z.string(),
      workspace_id: z.string(),
      channel: z.string(),
      type: z.string(),
      title: z.string(),
      body: z.string(),
      data: z.record(z.any()).optional(),
      priority: z.number().int().optional().default(5),
      scheduled_at: z.string().optional().describe("ISO timestamp for delayed delivery"),
    })),
  },
  async ({ notifications }) => {
    const { enqueueBatchNotifications } = await import("../lib/batch-queue.js");
    return text(await enqueueBatchNotifications(sql, notifications));
  },
);

server.tool(
  "notify_get_batch_queue_stats",
  "Get current batch notification queue statistics — pending, processing, completed, failed counts and oldest pending age",
  {},
  async () => {
    const { getBatchQueueStats } = await import("../lib/batch-queue.js");
    return text(await getBatchQueueStats(sql));
  },
);

server.tool(
  "notify_dequeue_batch_notifications",
  "Dequeue pending notifications from the batch delivery queue for processing",
  {
    limit: z.number().int().positive().optional().default(100).describe("Maximum notifications to dequeue"),
    channels: z.array(z.string()).optional().describe("Filter to specific channel types"),
  },
  async ({ limit, channels }) => {
    const { dequeueBatchNotifications } = await import("../lib/batch-queue.js");
    return text({ notifications: await dequeueBatchNotifications(sql, limit, channels) });
  },
);


// --- Batch Queue tools ---

server.tool(
  "notify_enqueue_batch",
  "Enqueue multiple notifications for batch processing",
  {
    notifications: z.array(z.object({
      user_id: z.string(),
      workspace_id: z.string().optional(),
      channel: ChannelSchema,
      type: z.string(),
      title: z.string().optional(),
      body: z.string(),
      data: z.record(z.any()).optional(),
      priority: z.number().int().min(0).max(10).optional(),
      scheduled_at: z.string().optional().describe("ISO 8601 datetime"),
    })),
  },
  async ({ notifications }) => {
    const queued: QueuedNotification[] = notifications.map((n) => ({
      userId: n.user_id,
      workspaceId: n.workspace_id ?? "",
      channel: n.channel,
      type: n.type,
      title: n.title ?? "",
      body: n.body,
      data: n.data,
      priority: n.priority ?? 5,
      scheduledAt: n.scheduled_at ? new Date(n.scheduled_at) : undefined,
    }));
    const result = await enqueueBatchNotifications(sql, queued);
    return text(result);
  },
);

server.tool(
  "notify_dequeue_batch",
  "Dequeue notifications for processing from the batch queue",
  {
    limit: z.number().int().positive().optional().default(100),
    channels: z.array(ChannelSchema).optional(),
  },
  async ({ limit, channels }) => {
    const items = await dequeueBatchNotifications(sql, limit, channels);
    return text({ items });
  },
);

server.tool(
  "notify_batch_queue_stats",
  "Get batch queue statistics",
  async () => {
    const stats = await getBatchQueueStats(sql);
    return text({ stats });
  },
);

server.tool(
  "notify_mark_batch_delivered",
  "Mark batch notification items as delivered",
  { ids: z.array(z.string()) },
  async ({ ids }) => {
    const uuidIds = ids.map((id) => {
      const parsed = parseInt(id, 10);
      return isNaN(parsed) ? id : parsed;
    });
    await markBatchDelivered(sql, uuidIds as number[]);
    return text({ ok: true });
  },
);

server.tool(
  "notify_mark_batch_failed",
  "Mark batch notification items as failed",
  {
    ids: z.array(z.string()),
    reason: z.string().optional(),
  },
  async ({ ids, reason }) => {
    const uuidIds = ids.map((id) => {
      const parsed = parseInt(id, 10);
      return isNaN(parsed) ? id : parsed;
    });
    await markBatchFailed(sql, uuidIds as number[], reason);
    return text({ ok: true });
  },
);


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


// --- Channel prioritization ---

server.tool(
  "notify_set_channel_priority",
  "Set the delivery priority for a channel (higher = delivered first)",
  {
    channel_id: z.string(),
    priority: z.number().int().min(0).max(10),
  },
  async ({ channel_id, priority }) => {
    await setChannelPriority(sql, channel_id, priority);
    return text({ ok: true, priority });
  },
);

server.tool(
  "notify_get_delivery_queue",
  "Get pending delivery records ordered by priority DESC, created_at ASC",
  {
    limit: z.number().optional().default(50),
  },
  async ({ limit }) => text(await getDeliveryQueue(sql, limit)),
);

server.tool(
  "notify_get_channel_priority",
  "Get the current priority level for a channel",
  { channel_id: z.string() },
  async ({ channel_id }) => text(await getChannelPriority(sql, channel_id)),
);

server.tool(
  "notify_get_channel_stats",
  "Get per-channel delivery/read/click statistics for a workspace — shows delivered, read, clicked, and total counts per channel type (email, sms, push, etc.)",
  {
    workspace_id: z.string(),
    since: z.string().optional().describe("ISO timestamp — if provided, stats are filtered to notifications created after this time"),
  },
  async ({ workspace_id, since }) =>
    text(await getChannelStats(sql, workspace_id, since ? new Date(since) : undefined)),
);

server.tool(
  "notify_get_pending_scheduled",
  "List pending scheduled notifications due before a given time — used by workers to pick up due items",
  {
    before: z.string().describe("ISO timestamp — return notifications scheduled for before this time"),
    limit: z.number().optional().default(50).describe("Max notifications to return"),
  },
  async ({ before, limit }) => {
    const pending = await getPendingScheduled(sql, new Date(before), limit);
    return text({ pending, count: pending.length });
  },
);

server.tool(
  "notify_reschedule_by_priority",
  "Reschedule pending delivery records for a channel to a new priority",
  {
    channel_id: z.string(),
    new_priority: z.number().int().min(0).max(10),
  },
  async ({ channel_id, new_priority }) => {
    const count = await rescheduleByPriority(sql, channel_id, new_priority);
    return text({ updated: count });
  },
);


// --- Channel priority rules ---
server.tool(
  "notify_add_priority_rule",
  "Add a priority boost rule for a channel — rules are evaluated in order when scheduling",
  {
    workspace_id: z.string(),
    channel_type: z.string(),
    condition: z.string().describe("Condition expression (e.g. 'urgency >= high')"),
    boost_score: z.number().describe("Boost score to add when condition matches"),
    description: z.string().optional(),
  },
  async ({ workspace_id, channel_type, condition, boost_score, description }) => {
    await addPriorityRule(sql, workspace_id, channel_type, { condition, boostScore: boost_score, description });
    return text({ added: true });
  },
);

server.tool(
  "notify_get_priority_matrix",
  "Get the full channel priority matrix for a workspace — shows all priorities and active rules",
  {
    workspace_id: z.string(),
  },
  async ({ workspace_id }) => {
    const matrix = await getChannelPriorityMatrix(sql, workspace_id);
    return text(matrix);
  },
);

server.tool(
  "notify_reschedule_by_priority",
  "Reschedule all notifications for a channel to a new priority level",
  {
    channel_type: z.string(),
    new_priority: z.number().int().min(1).max(100),
  },
  async ({ channel_type, new_priority }) => {
    const count = await rescheduleByPriority(sql, channel_type, new_priority);
    return text({ rescheduled: count });
  },
);

server.tool(
  "notify_detect_scheduling_overlaps",
  "Detect overlapping scheduled notification windows for a user — finds notifications that could be merged into a digest",
  {
    user_id: z.string(),
    channel_type: z.string(),
    window_hours: z.number().optional().default(1).describe("Window size in hours"),
    after: z.string().optional().describe("ISO timestamp — window start (defaults to now)"),
  },
  async ({ user_id, channel_type, window_hours, after }) => {
    const conflicts = await getScheduleConflicts(sql, {
      userId: user_id,
      channelType: channel_type,
      windowMinutes: (window_hours ?? 1) * 60,
      after: after ? new Date(after) : undefined,
    });
    return text(conflicts);
  },
);

server.tool(
  "notify_reschedule_notification",
  "Reschedule a notification to a new delivery time",
  {
    notification_id: z.string(),
    new_scheduled_at: z.string().describe("ISO timestamp for new delivery time"),
  },
  async ({ notification_id, new_scheduled_at }) => {
    const result = await rescheduleNotification(sql, notification_id, new Date(new_scheduled_at));
    return text({ rescheduled: result });
  },
);

server.tool(
  "notify_cancel_scheduled",
  "Cancel a scheduled notification that has not yet been delivered",
  {
    notification_id: z.string(),
  },
  async ({ notification_id }) => {
    const cancelled = await cancelNotification(sql, notification_id);
    return text({ cancelled });
  },
);

server.tool(
  "notify_mark_all_read",
  "Mark all unread notifications as read for a user",
  {
    user_id: z.string(),
  },
  async ({ user_id }) => {
    await markAllRead(sql, user_id);
    return text({ marked: true });
  },
);


// ─── Channel Priority ─────────────────────────────────────────────────────────

server.tool(
  "notify_set_channel_priority",
  "Set the base delivery priority for a channel in a workspace (higher = more urgent)",
  {
    workspace_id: z.string(),
    channel: z.string(),
    priority: z.number().int().min(1).max(10).describe("Priority 1-10 (10 = highest)"),
  },
  async ({ workspace_id, channel, priority }) => {
    const { setChannelPriority } = await import("../lib/prioritization.js");
    return text(await setChannelPriority(sql, workspace_id, channel, priority));
  },
);

server.tool(
  "notify_get_channel_priority",
  "Get the current priority and boost rules for a channel",
  {
    workspace_id: z.string(),
    channel: z.string(),
  },
  async ({ workspace_id, channel }) => {
    const { getChannelPriority } = await import("../lib/prioritization.js");
    return text(await getChannelPriority(sql, workspace_id, channel));
  },
);

server.tool(
  "notify_add_priority_rule",
  "Add a conditional priority boost rule (e.g., boost email by 2 when user has unread notifications > 5)",
  {
    workspace_id: z.string(),
    channel: z.string(),
    condition: z.string().describe("JSON condition e.g. {'unread_count': {'$gt': 5}}"),
    boost: z.number().int().describe("Priority boost amount (1-5)"),
    reason: z.string().optional(),
  },
  async ({ workspace_id, channel, condition, boost, reason }) => {
    const { addPriorityRule } = await import("../lib/prioritization.js");
    return text(await addPriorityRule(sql, workspace_id, channel, JSON.parse(condition), boost, reason));
  },
);

server.tool(
  "notify_reschedule_by_priority",
  "Reschedule pending notifications based on updated channel priority matrix",
  {
    workspace_id: z.string(),
    dry_run: z.boolean().optional().default(false),
  },
  async ({ workspace_id, dry_run }) => {
    const { rescheduleByPriority } = await import("../lib/prioritization.js");
    return text({ rescheduled: dry_run ? 0 : await rescheduleByPriority(sql, workspace_id) });
  },
);


// ─── Delivery Windows ─────────────────────────────────────────────────────────

server.tool(
  "notify_create_delivery_window",
  "Create a delivery window restricting when notifications can be sent for a user+channel",
  {
    user_id: z.string().describe("User ID"),
    channel: z.string().describe("Channel (email, in_app, sms, etc.)"),
    day_of_week: z.array(z.number().int().min(0).max(6)).optional().default([0, 1, 2, 3, 4, 5, 6]),
    start_hour: z.number().int().min(0).max(23).optional().default(9),
    start_minute: z.number().int().min(0).max(59).optional().default(0),
    end_hour: z.number().int().min(0).max(23).optional().default(21),
    end_minute: z.number().int().min(0).max(59).optional().default(0),
    timezone: z.string().optional().default("UTC"),
  },
  async (opts) => {
    const { createDeliveryWindow } = await import("../lib/delivery-windows.js");
    return text(await createDeliveryWindow(sql, opts.user_id, opts.channel, {
      dayOfWeek: opts.day_of_week,
      startHour: opts.start_hour,
      startMinute: opts.start_minute,
      endHour: opts.end_hour,
      endMinute: opts.end_minute,
      timezone: opts.timezone,
    }));
  },
);

server.tool(
  "notify_check_delivery_window",
  "Check if current time is within a user's delivery window",
  { user_id: z.string(), channel: z.string() },
  async ({ user_id, channel }) => {
    const { checkDeliveryWindow } = await import("../lib/delivery-windows.js");
    return text(await checkDeliveryWindow(sql, user_id, channel));
  },
);

server.tool(
  "notify_hold_for_window",
  "Hold a notification until the next open delivery window",
  { notification_id: z.string(), user_id: z.string(), channel: z.string() },
  async ({ notification_id, user_id, channel }) => {
    const { holdForWindow } = await import("../lib/delivery-windows.js");
    return text({ held_until: await holdForWindow(sql, notification_id, user_id, channel) });
  },
);

server.tool(
  "notify_list_delivery_windows",
  "List all delivery windows for a user",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { listUserDeliveryWindows } = await import("../lib/delivery-windows.js");
    return text(await listUserDeliveryWindows(sql, user_id));
  },
);

server.tool(
  "notify_delete_delivery_window",
  "Delete a delivery window",
  { id: z.string() },
  async ({ id }) => {
    const { deleteDeliveryWindow } = await import("../lib/delivery-windows.js");
    await deleteDeliveryWindow(sql, id);
    return text({ deleted: true });
  },
);


// ─── Digest Management ─────────────────────────────────────────────────────────

server.tool(
  "notify_create_digest",
  "Create a one-time or recurring notification digest for a user",
  {
    user_id: z.string(),
    channel: z.enum(["email", "sms", "push"]).default("email"),
    schedule: z.enum(["daily", "weekly", "monthly"]),
    workspace_id: z.string().optional(),
    filters: z.record(z.any()).optional().describe("Filter criteria for included notifications"),
  },
  async ({ user_id, channel, schedule, workspace_id, filters }) => {
    const { createDigest } = await import("../lib/digests.js");
    return text(await createDigest(sql, { userId: user_id, channel, schedule, workspaceId: workspace_id, filters }));
  },
);

server.tool(
  "notify_list_digests",
  "List notification digests for a user",
  { user_id: z.string() },
  async ({ user_id }) => {
    const { listDigests } = await import("../lib/digests.js");
    return text(await listDigests(sql, user_id));
  },
);

server.tool(
  "notify_render_digest_body",
  "Render a digest's body with current notification content",
  {
    digest_id: z.string(),
    include_notifications: z.boolean().optional().default(true),
  },
  async ({ digest_id, include_notifications }) => {
    const { renderDigestBody } = await import("../lib/digests.js");
    return text(await renderDigestBody(sql, digest_id, include_notifications));
  },
);

server.tool(
  "notify_cancel_digest",
  "Cancel a notification digest by ID",
  { digest_id: z.string() },
  async ({ digest_id }) => {
    const { cancelDigest } = await import("../lib/digests.js");
    return text({ cancelled: await cancelDigest(sql, digest_id) });
  },
);


// --- Digest rendering ---
server.tool(
  "notify_render_digest_body",
  "Render a digest body string from a list of notifications — groups them under a header (hourly/daily/weekly)",
  {
    notifications: z.array(z.object({
      type: z.string(),
      title: z.string().nullable(),
      body: z.string(),
    })),
    frequency: z.enum(["hourly", "daily", "weekly"]),
  },
  async ({ notifications, frequency }) => {
    return text(renderDigestBody(notifications, frequency));
  },
);


// --- Engagement analytics: funnel ---
server.tool(
  "notify_get_engagement_funnel",
  "Get a conversion funnel for a workspace: delivered → read → clicked",
  {
    workspace_id: z.string(),
    since: z.string().optional(),
    until: z.string().optional(),
  },
  async ({ workspace_id, since, until }) => {
    const sinceDate = since ? new Date(since) : undefined;
    const untilDate = until ? new Date(until) : undefined;
    return text(await getEngagementFunnel(sql, workspace_id, sinceDate, untilDate));
  },
);


// --- Engagement analytics: time series ---
server.tool(
  "notify_get_engagement_time_series",
  "Get engagement time-series data for a workspace over a date range",
  {
    workspace_id: z.string(),
    since: z.string().optional(),
    until: z.string().optional(),
    channel: z.string().optional(),
    granularity: z.enum(["day", "hour"]).optional(),
  },
  async ({ workspace_id, since, until, channel, granularity }) => {
    const sinceDate = since ? new Date(since) : undefined;
    const untilDate = until ? new Date(until) : undefined;
    return text(await getEngagementTimeSeries(sql, workspace_id, {
      since: sinceDate,
      until: untilDate,
      channel,
      granularity,
    }));
  },
);


// --- Engagement Analytics tools ---

server.tool(
  "notify_engagement_time_series",
  "Get time-series engagement data (delivered/read/clicked over time) for a workspace",
  {
    workspace_id: z.string(),
    since: z.string().optional().describe("ISO 8601 datetime start"),
    until: z.string().optional().describe("ISO 8601 datetime end"),
    channel: ChannelSchema.optional(),
    granularity: z.enum(["day", "hour"]).optional().default("day"),
  },
  async ({ workspace_id, since, until, channel, granularity }) =>
    text(await getEngagementTimeSeries(sql, workspace_id, {
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
      channel,
      granularity,
    })),
);

server.tool(
  "notify_engagement_funnel",
  "Get a conversion funnel (delivered → read → clicked) for a workspace",
  {
    workspace_id: z.string(),
    since: z.string().optional().describe("ISO 8601 datetime start"),
    until: z.string().optional().describe("ISO 8601 datetime end"),
  },
  async ({ workspace_id, since, until }) =>
    text(await getEngagementFunnel(sql, workspace_id,
      since ? new Date(since) : undefined,
      until ? new Date(until) : undefined,
    )),
);


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


// --- Gap: notification_templates.ts getTemplate ---

server.tool(
  "notify_get_notification_template",
  "Get a notification template by ID (notification_templates table with workspace support)",
  { id: z.string() },
  async ({ id }) => text(await getNotificationTemplate(sql, id)),
);


// --- Gap: retry DEFAULT_RETRY_CONFIGS ---

server.tool(
  "notify_get_default_retry_configs",
  "Get the default retry configurations per channel (email, sms, in_app, webhook)",
  {},
  async () => text({ configs: DEFAULT_RETRY_CONFIGS }),
);


// --- Gap: templates.ts direct access ---

server.tool(
  "notify_get_template",
  "Get a notification template by ID (basic templates table)",
  { id: z.string() },
  async ({ id }) => text(await getTemplate(sql, id)),
);

server.tool(
  "notify_get_template_by_name",
  "Get a notification template by name (basic templates table)",
  { name: z.string() },
  async ({ name }) => text(await getTemplateByName(sql, name)),
);

server.tool(
  "notify_update_template",
  "Update a notification template (basic templates table)",
  {
    id: z.string(),
    name: z.string().optional(),
    subject: z.string().optional(),
    body: z.string().optional(),
    channel: z.string().optional(),
    variables: z.array(z.string()).optional(),
  },
  async ({ id, name, subject, body, channel, variables }) =>
    text(await updateTemplate(sql, id, { name, subject, body, channel, variables })),
);

server.tool(
  "notify_render_template_string",
  "Render a template string by substituting {{variable}} placeholders",
  {
    template: z.string(),
    variables: z.record(z.string()),
  },
  async ({ template, variables }) => text({ rendered: renderTemplate(template, variables) }),
);


// ─── Notification Inbox ────────────────────────────────────────────────────────

server.tool(
  "notify_add_to_inbox",
  "Add a notification to a user's inbox",
  {
    user_id: z.string(),
    workspace_id: z.string().optional(),
    notification_id: z.string().optional(),
    title: z.string(),
    body: z.string(),
    channel: z.string(),
    priority: z.number().optional().default(0),
  },
  async (opts) => text(await addToInbox(sql, {
    userId: opts.user_id,
    workspaceId: opts.workspace_id,
    notificationId: opts.notification_id,
    title: opts.title,
    body: opts.body,
    channel: opts.channel,
    priority: opts.priority,
  })),
);

server.tool(
  "notify_get_inbox_badge",
  "Get unread badge counts for a user's inbox",
  { user_id: z.string() },
  async ({ user_id }) => text(await getInboxBadgeCount(sql, user_id)),
);

server.tool(
  "notify_list_inbox",
  "List items in a user's notification inbox",
  {
    user_id: z.string(),
    status: z.enum(["unread", "read", "archived", "deleted"]).optional(),
    channel: z.string().optional(),
    search: z.string().optional(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async (opts) => text(await listInboxItems(sql, opts.user_id, {
    status: opts.status,
    channel: opts.channel,
    search: opts.search,
    limit: opts.limit,
    offset: opts.offset,
  })),
);

server.tool(
  "notify_mark_inbox_read",
  "Mark an inbox item as read",
  { item_id: z.string(), user_id: z.string() },
  async ({ item_id, user_id }) =>
    text({ marked: await markInboxRead(sql, item_id, user_id) }),
);

server.tool(
  "notify_archive_inbox_item",
  "Archive an inbox item (soft-delete, user can still view)",
  { item_id: z.string(), user_id: z.string() },
  async ({ item_id, user_id }) =>
    text({ archived: await archiveInboxItem(sql, item_id, user_id) }),
);

server.tool(
  "notify_delete_inbox_item",
  "Permanently delete an inbox item",
  { item_id: z.string(), user_id: z.string() },
  async ({ item_id, user_id }) =>
    text({ deleted: await deleteInboxItem(sql, item_id, user_id) }),
);

server.tool(
  "notify_mark_all_inbox_read",
  "Mark all unread inbox items as read for a user",
  { user_id: z.string() },
  async ({ user_id }) => text({ marked: await markAllInboxRead(sql, user_id) }),
);

server.tool(
  "notify_prune_read_inbox_items",
  "Archive old read inbox items (default: items older than 30 days)",
  { user_id: z.string(), older_than_days: z.number().optional().default(30) },
  async ({ user_id, older_than_days }) =>
    text({ pruned: await pruneReadItems(sql, user_id, older_than_days) }),
);


// ─── Notification Templates ──────────────────────────────────────────────────

server.tool(
  "notify_create_template",
  "Create a reusable notification template with variable placeholders",
  {
    workspace_id: z.string(),
    name: z.string().describe("Template name (unique per workspace)"),
    subject: z.string().optional().describe("Email subject template"),
    body: z.string().describe("Body template with {{variable}} placeholders"),
    channel: z.enum(["email", "sms", "push", "webhook"]).optional().default("email"),
    description: z.string().optional(),
  },
  async ({ workspace_id, name, subject, body, channel, description }) => {
    const { createTemplate } = await import("../lib/templates.js");
    return text(await createTemplate(sql, { workspaceId: workspace_id, name, subject, body, channel, description }));
  },
);

server.tool(
  "notify_render_template",
  "Render a notification template with provided variable values",
  {
    template_id: z.string(),
    variables: z.record(z.string()).describe("Key-value pairs for template variables"),
  },
  async ({ template_id, variables }) => {
    const { renderTemplate } = await import("../lib/templates.js");
    return text(await renderTemplate(sql, template_id, variables));
  },
);

server.tool(
  "notify_render_template_by_name",
  "Render a template by workspace and name without needing template ID",
  {
    workspace_id: z.string(),
    name: z.string(),
    variables: z.record(z.string()),
  },
  async ({ workspace_id, name, variables }) => {
    const { getTemplateByName, renderTemplate } = await import("../lib/templates.js");
    const template = await getTemplateByName(sql, workspace_id, name);
    if (!template) return text({ error: "Template not found" });
    return text(await renderTemplate(sql, template.id, variables));
  },
);

server.tool(
  "notify_list_templates",
  "List all notification templates for a workspace",
  {
    workspace_id: z.string(),
    channel: z.enum(["email", "sms", "push", "webhook"]).optional(),
    limit: z.number().optional().default(50),
  },
  async ({ workspace_id, channel, limit }) => {
    const { listTemplates } = await import("../lib/templates.js");
    return text(await listTemplates(sql, workspace_id, channel, limit));
  },
);

server.tool(
  "notify_delete_template",
  "Delete a notification template by ID",
  { template_id: z.string() },
  async ({ template_id }) => {
    const { deleteTemplate } = await import("../lib/templates.js");
    return text({ deleted: await deleteTemplate(sql, template_id) });
  },
);


// --- Notification Templates v2 tools ---

server.tool(
  "notify_v2_create_template",
  "Create a new versioned notification template",
  {
    workspace_id: z.string(),
    name: z.string(),
    channel: ChannelSchema,
    subject: z.string().optional(),
    body: z.string(),
  },
  async ({ workspace_id, name, channel, subject, body }) => {
    const id = await createTemplateV2(sql, {
      workspaceId: workspace_id,
      name,
      channel,
      subject,
      body,
      active: true,
    });
    return text({ id });
  },
);

server.tool(
  "notify_v2_get_template",
  "Get a notification template by workspace, name, channel (optionally specific version)",
  {
    workspace_id: z.string(),
    name: z.string(),
    channel: ChannelSchema,
    version: z.number().int().positive().optional(),
  },
  async ({ workspace_id, name, channel, version }) => {
    const template = await getTemplateV2(sql, workspace_id, name, channel, version);
    return text({ template });
  },
);

server.tool(
  "notify_v2_list_templates",
  "List notification templates for a workspace",
  {
    workspace_id: z.string(),
    channel: ChannelSchema.optional(),
  },
  async ({ workspace_id, channel }) => {
    const templates = await listTemplatesV2(sql, workspace_id, channel);
    return text({ templates });
  },
);

server.tool(
  "notify_v2_render_template",
  "Render a notification template with variable substitution",
  {
    workspace_id: z.string(),
    name: z.string(),
    channel: ChannelSchema,
    variables: z.record(z.union([z.string(), z.number()])),
    version: z.number().int().positive().optional(),
  },
  async ({ workspace_id, name, channel, variables, version }) => {
    const template = await getTemplateV2(sql, workspace_id, name, channel, version);
    if (!template) return text({ error: "Template not found" });
    const rendered = await renderTemplateV2(template, variables as Record<string, string | number>);
    return text({ rendered });
  },
);

server.tool(
  "notify_v2_update_template",
  "Update a notification template (creates a new version)",
  {
    id: z.string(),
    subject: z.string().optional(),
    body: z.string().optional(),
  },
  async ({ id, subject, body }) => {
    await updateTemplateV2(sql, id, { subject, body });
    return text({ ok: true });
  },
);

server.tool(
  "notify_v2_get_template_analytics",
  "Get analytics for a notification template",
  {
    template_id: z.string(),
    start_date: z.string().optional().describe("ISO 8601 datetime"),
    end_date: z.string().optional().describe("ISO 8601 datetime"),
  },
  async ({ template_id, start_date, end_date }) => {
    const analytics = await getTemplateAnalytics(
      sql,
      parseInt(template_id, 10),
      start_date ? new Date(start_date) : undefined,
      end_date ? new Date(end_date) : undefined,
    );
    return text({ analytics });
  },
);

server.tool(
  "notify_v2_archive_template",
  "Archive (deactivate) a notification template",
  { id: z.string() },
  async ({ id }) => {
    await archiveTemplate(sql, parseInt(id, 10));
    return text({ ok: true });
  },
);


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


// --- Prometheus metrics export ---

server.tool(
  "notify_export_prometheus_metrics",
  "Export notify service metrics in Prometheus text format",
  async () => {
    const metrics = getNotifyMetrics();
    return text({ metrics: metrics });
  },
);

server.tool(
  "notify_metrics_json",
  "Export notify service metrics as JSON",
  async () => {
    const metrics = getNotifyMetrics();
    return text({ metrics: metrics });
  },
);

server.tool(
  "notify_export_prometheus_metrics_db",
  "Export notify service metrics in Prometheus text format (fetched from database)",
  async () => text(await exportNotifyMetrics(sql)),
);

server.tool(
  "notify_export_metrics_json_db",
  "Export notify service metrics as JSON (fetched from database)",
  async () => text(await exportNotifyMetricsJSON(sql)),
);


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


// --- Receipt stats ---
server.tool(
  "notify_get_receipt_stats",
  "Get aggregate delivery receipt statistics per channel — delivered, bounced, dropped, failed counts and delivery rate",
  {
    workspace_id: z.string().optional(),
    channel: z.string().optional(),
    since: z.string().optional().describe("ISO date — start of window"),
    until: z.string().optional().describe("ISO date — end of window"),
  },
  async ({ workspace_id, channel, since, until }) => {
    const sinceDate = since ? new Date(since) : undefined;
    const untilDate = until ? new Date(until) : undefined;
    return text(await getReceiptStats(sql, { workspaceId: workspace_id, channel, since: sinceDate, until: untilDate }));
  },
);


// --- Record delivery ---
server.tool(
  "notify_record_delivery",
  "Record that a notification was successfully delivered to a channel",
  {
    notification_id: z.string(),
    channel_type: z.string(),
    metadata: z.record(z.any()).optional(),
  },
  async ({ notification_id, channel_type, metadata }) => {
    await recordDelivery(sql, notification_id, channel_type, metadata);
    return text({ recorded: true });
  },
);


// --- Retry Health tools ---

server.tool(
  "notify_retry_subsystem_health",
  "Get retry subsystem health — checks for stuck retries, high failure rates, returns overall health score (0-100)",
  {},
  async () => text(JSON.stringify(await getRetrySubsystemHealth(sql), null, 2)),
);

server.tool(
  "notify_drain_failed_retries",
  "Retrieve all permanently failed retries (exceeded max retries) with last error details for forensics",
  {
    workspace_id: z.string().optional(),
    channel: z.string().optional(),
    since_hours: z.number().optional().default(24),
    limit: z.number().optional().default(100),
  },
  async ({ workspace_id, channel, since_hours, limit }) => {
    const since = new Date(Date.now() - since_hours * 3600_000);
    return text(JSON.stringify(
      await drainFailedRetries(sql, { workspaceId: workspace_id, channel, since, limit }),
      null, 2
    ));
  },
);


// ─── Retry Management ──────────────────────────────────────────────────────────

server.tool(
  "notify_get_retry_health",
  "Get retry subsystem health summary: dead letter queue size, oldest retry age, success rate",
  async () => {
    const { getRetryHealth } = await import("../lib/retry.js");
    return text(await getRetryHealth(sql));
  },
);

server.tool(
  "notify_drain_failed_retries",
  "Drain and delete all failed retries that have exceeded max retry count",
  {
    workspace_id: z.string().optional(),
    before: z.string().optional().describe("ISO timestamp — only drain retries created before this time"),
  },
  async ({ workspace_id, before }) => {
    const { drainFailedRetries } = await import("../lib/retry.js");
    return text({ drained: await drainFailedRetries(sql, workspace_id, before ? new Date(before) : undefined) });
  },
);

server.tool(
  "notify_clear_retries",
  "Clear (delete) all pending retry records for a notification",
  { notification_id: z.string() },
  async ({ notification_id }) => {
    const { clearRetries } = await import("../lib/retry.js");
    return text({ cleared: await clearRetries(sql, notification_id) });
  },
);

server.tool(
  "notify_get_due_retries",
  "Get retries that are due for the next delivery attempt",
  { limit: z.number().optional().default(50) },
  async ({ limit }) => {
    const { getDueRetries } = await import("../lib/retry.js");
    return text(await getDueRetries(sql, limit));
  },
);


// --- Scheduled notification reschedule ---

server.tool(
  "notify_reschedule_scheduled",
  "Reschedule a pending standalone scheduled notification to a new time",
  {
    id: z.string(),
    new_scheduled_for: z.string().describe("New ISO 8601 datetime"),
  },
  async ({ id, new_scheduled_for }) => {
    const result = await rescheduleScheduled(sql, id, new_scheduled_for);
    return text({ scheduled: result });
  },
);


// --- Scheduling conflict detection ---

server.tool(
  "notify_get_schedule_conflicts",
  "Detect overlapping scheduled notifications for a user/channel within a time window — useful for digest merging or rate-limit avoidance",
  {
    user_id: z.string(),
    channel_type: z.string(),
    window_minutes: z.number().int().positive().optional().default(60),
    after: z.string().optional().describe("ISO timestamp — window start (defaults to now)"),
  },
  async ({ user_id, channel_type, window_minutes, after }) => {
    const { getScheduleConflicts } = await import("../lib/scheduled.js");
    return text(await getScheduleConflicts(sql, { userId: user_id, channelType: channel_type, windowMinutes: window_minutes, after: after ? new Date(after) : undefined }));
  },
);


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


// --- Template analytics ---
server.tool(
  "notify_get_template_analytics",
  "Get delivery analytics for a template — rendered, delivered, opened, clicked counts and conversion rate",
  {
    template_id: z.number().int(),
    start_date: z.string().optional().describe("ISO date — start of window"),
    end_date: z.string().optional().describe("ISO date — end of window"),
  },
  async ({ template_id, start_date, end_date }) => {
    const startDate = start_date ? new Date(start_date) : undefined;
    const endDate = end_date ? new Date(end_date) : undefined;
    return text(await getTemplateAnalytics(sql, template_id, startDate, endDate));
  },
);


// --- Template versioning: diff ---
server.tool(
  "notify_get_template_version_diff",
  "Compare two versions of a template and return the diff",
  {
    template_id: z.string(),
    from_version: z.number(),
    to_version: z.number(),
  },
  async ({ template_id, from_version, to_version }) => {
    const result = await getTemplateVersionDiff(sql, template_id, from_version, to_version);
    if (!result) return text({ error: "One or both versions not found" });
    return text(result);
  },
);


// --- Template Versioning tools ---

server.tool(
  "notify_list_template_versions",
  "List all versions of a notification template (newest first)",
  { template_id: z.string().describe("Template ID to get version history for") },
  async ({ template_id }) => text(await listTemplateVersions(sql, template_id)),
);

server.tool(
  "notify_create_template_version",
  "Manually create a version snapshot of a notification template (useful before making changes)",
  {
    template_id: z.string().describe("Template ID to snapshot"),
    changed_by: z.string().optional().describe("User creating the snapshot"),
    change_reason: z.string().optional().describe("Reason for snapshot (e.g. 'before major update')"),
  },
  async ({ template_id, changed_by, change_reason }) => {
    // First get the current template to snapshot its content
    const current = await getTemplate(sql, template_id);
    if (!current) return text({ error: "Template not found" });
    return text(await createTemplateVersion(sql, {
      template_id,
      name: current.name,
      subject_template: current.subject ?? null,
      body_template: current.body,
      channel_type: current.channel ?? null,
      variables: current.variables ?? [],
      changed_by: changed_by ?? null,
      change_reason: change_reason ?? null,
    }));
  },
);

server.tool(
  "notify_get_template_version",
  "Get a specific version of a notification template by version number",
  {
    template_id: z.string().describe("Template ID"),
    version_number: z.number().int().positive().describe("Version number to retrieve"),
  },
  async ({ template_id, version_number }) =>
    text(await getTemplateVersion(sql, template_id, version_number)),
);

server.tool(
  "notify_rollback_template",
  "Rollback a notification template to a previous version",
  {
    template_id: z.string().describe("Template ID to rollback"),
    target_version: z.number().int().positive().describe("Version number to rollback to"),
    changed_by: z.string().optional().describe("User performing the rollback"),
    reason: z.string().optional().describe("Reason for rollback"),
  },
  async ({ template_id, target_version, changed_by, reason }) =>
    text(await rollbackTemplate(sql, template_id, target_version, changed_by, reason)),
);

server.tool(
  "notify_get_template_diff",
  "Compare two versions of a template to see what changed",
  {
    template_id: z.string().describe("Template ID"),
    from_version: z.number().int().positive().describe("Older version number"),
    to_version: z.number().int().positive().describe("Newer version number"),
  },
  async ({ template_id, from_version, to_version }) =>
    text(await getTemplateVersionDiff(sql, template_id, from_version, to_version)),
);


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


// ─── User Preferences ─────────────────────────────────────────────────────────

server.tool(
  "notify_set_preference",
  "Set a user's notification preference for a channel/type",
  {
    user_id: z.string(),
    channel: z.string(),
    notification_type: z.string().optional(),
    enabled: z.boolean().describe("Enable or disable this preference"),
    quiet_hours_start: z.string().optional().describe("HH:MM local time"),
    quiet_hours_end: z.string().optional(),
  },
  async ({ user_id, channel, notification_type, enabled, quiet_hours_start, quiet_hours_end }) => {
    const { setPreference } = await import("../lib/preferences.js");
    return text(await setPreference(sql, { userId: user_id, channel, notificationType: notification_type, enabled, quietHoursStart: quiet_hours_start, quietHoursEnd: quiet_hours_end }));
  },
);

server.tool(
  "notify_get_preference",
  "Get a user's notification preference for a specific channel",
  {
    user_id: z.string(),
    channel: z.string(),
    notification_type: z.string().optional(),
  },
  async ({ user_id, channel, notification_type }) => {
    const { getPreference } = await import("../lib/preferences.js");
    return text(await getPreference(sql, user_id, channel, notification_type));
  },
);

server.tool(
  "notify_is_channel_enabled",
  "Check if a notification channel is enabled for a user",
  {
    user_id: z.string(),
    channel: z.string(),
  },
  async ({ user_id, channel }) => {
    const { isChannelEnabled } = await import("../lib/preferences.js");
    return text({ enabled: await isChannelEnabled(sql, user_id, channel) });
  },
);


// ─── Webhook Management ───────────────────────────────────────────────────────

server.tool(
  "notify_create_webhook",
  "Create a webhook endpoint for workspace event notifications",
  {
    workspace_id: z.string(),
    url: z.string().url().describe("Webhook endpoint URL"),
    events: z.array(z.enum(["notification_sent", "notification_clicked", "notification_read", "notification_failed", "digest_ready"])).describe("Event types to subscribe to"),
    secret: z.string().optional().describe("HMAC secret for payload signature verification"),
    name: z.string().optional(),
  },
  async ({ workspace_id, url, events, secret, name }) => {
    const { createWebhookEndpoint } = await import("../lib/webhooks.js");
    return text(await createWebhookEndpoint(sql, { workspaceId: workspace_id, url, events, secret, name }));
  },
);

server.tool(
  "notify_list_webhooks",
  "List all webhook endpoints configured for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const { listWorkspaceWebhooks } = await import("../lib/webhooks.js");
    return text(await listWorkspaceWebhooks(sql, workspace_id));
  },
);

server.tool(
  "notify_delete_webhook",
  "Delete a webhook endpoint by ID",
  { webhook_id: z.string() },
  async ({ webhook_id }) => {
    const { deleteWebhookEndpoint } = await import("../lib/webhooks.js");
    return text({ deleted: await deleteWebhookEndpoint(sql, webhook_id) });
  },
);


