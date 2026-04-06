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
