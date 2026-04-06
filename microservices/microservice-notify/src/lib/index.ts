export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
export {
  type BatchNotification,
  type BatchResult,
  sendBatch,
} from "./batch.js";
export {
  type ChannelStats,
  getChannelStats,
  getNotificationEngagement,
  listReadReceiptsForUser,
  markNotificationRead,
  recordClick,
  recordDelivery,
  recordRead,
  type NotificationEngagement,
  type ReadReceipt,
} from "./engagement.js";
export {
  type CreateNotificationData,
  batchSendByChannel,
  cancelNotification,
  countUnread,
  createNotification,
  deleteNotification,
  getNotification,
  type ListNotificationsOptions,
  listScheduledDue,
  listUserNotifications,
  markAllRead,
  markRead,
  type Notification,
  rescheduleNotification,
} from "./notifications.js";
export {
  type CreateTemplateData,
  createTemplate,
  deleteTemplate,
  getTemplate,
  getTemplateByName,
  listTemplates,
  renderTemplate,
  type Template,
  updateTemplate,
} from "./templates.js";
export {
  type CreateTemplateData as CreateNotificationTemplateData,
  type NotificationTemplate,
  createTemplate as createNotificationTemplate,
  deleteTemplate as deleteNotificationTemplate,
  getTemplate as getNotificationTemplate,
  listTemplates as listNotificationTemplates,
  renderTemplate as renderNotificationTemplate,
  renderTemplateById as renderNotificationTemplateById,
} from "./notification_templates.js";
export {
  getPreference,
  getUserPreferences,
  isChannelEnabled,
  type Preference,
  setPreference,
} from "./preferences.js";
export {
  type DeliveryQueueItem,
  getChannelPriority,
  getChannelPriorityMatrix,
  getDeliveryQueue,
  rescheduleByPriority,
  setChannelPriority,
  addPriorityRule,
  evaluatePriorityBoost,
  type PriorityRule,
} from "./prioritization.js";
export { type SendNotificationData, sendNotification } from "./send.js";
export {
  type CreateScheduledData,
  cancelScheduled,
  getPendingScheduled,
  getScheduleConflicts,
  listScheduled,
  markScheduledSent,
  rescheduleScheduled,
  scheduleBatch,
  scheduleNotification,
  type ScheduledNotification,
} from "./scheduled.js";
export {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./unsubscribe.js";
export {
  type CreateWebhookEndpointData,
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  listWorkspaceWebhooks,
  triggerWebhooks,
  updateWebhookEndpoint,
  type WebhookEndpoint,
} from "./webhooks.js";
export {
  type NotificationDigest,
  type DigestSchedule,
  collectDigestNotifications,
  createDigest,
  disableDigestSchedule,
  getDigest,
  listDigestSchedules,
  listDigests,
  markDigestSent,
  cancelDigest,
  renderDigestBody,
  type CreateDigestData,
  type CreateDigestScheduleData,
  upsertDigestSchedule,
} from "./digests.js";
export {
  calculateBackoff,
  clearRetries,
  cancelRetries,
  DEFAULT_RETRY_CONFIGS,
  drainFailedRetries,
  getDueRetries,
  getRetryHealth,
  getRetryHistory,
  getRetryStats,
  getRetrySubsystemHealth,
  recordRetry,
  type RetryConfig,
  type RetryRecord,
} from "./retry.js";
export {
  type NotifyMetric,
  type NotifyMetrics,
  exportNotifyMetrics,
  exportNotifyMetricsJSON,
  getNotifyMetrics,
  toPrometheusTextFormat,
} from "./notify-prometheus-metrics.js";
export {
  type BatchQueueConfig,
  type BatchQueueStats,
  dequeueBatchNotifications,
  enqueueBatchNotifications,
  getBatchQueueStats,
  markBatchDelivered,
  markBatchFailed,
  processBatchWithConcurrency,
  rescheduleBatchNotifications,
  type QueuedNotification,
} from "./batch-queue.js";
export {
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
} from "./notification-templates-v2.js";
export {
  type DeliveryReceipt,
  type DeliveryStatus,
  getReceipt,
  getReceiptStats,
  listBounces,
  listReceipts,
  markBounced,
  upsertReceipt,
} from "./receipts.js";
// Template Versioning
export {
  type TemplateVersion,
  createTemplateVersion,
  getTemplateVersion,
  getLatestTemplateVersion,
  listTemplateVersions,
  rollbackTemplate,
  getTemplateVersionDiff,
} from "./template-versions.js";
// Engagement Analytics
export {
  type EngagementFunnelStep,
  type EngagementTimeSeriesPoint,
  getEngagementFunnel,
  getEngagementTimeSeries,
} from "./engagement.js";
// A/B Testing
export {
  type ABTest,
  type ABTestVariant,
  type ABTestResult,
  createABTest,
  getABTest,
  recordABConversion,
  getABTestResults,
  completeABTest,
  listABTests,
} from "./ab-testing.js";
// Notification Inbox
export {
  type InboxItemStatus,
  type InboxItem,
  type InboxBadgeCount,
  addToInbox,
  getInboxBadgeCount,
  listInboxItems,
  markInboxRead,
  archiveInboxItem,
  deleteInboxItem,
  pruneReadItems,
  markAllInboxRead,
} from "./notification-inbox.js";
// Channel Failover
export {
  type FailoverTrigger,
  type ChannelFailoverRule,
  createFailoverRule,
  getFailoverRule,
  listFailoverRules,
  deleteFailoverRule,
  recordFailoverEvent,
  getFailoverStats,
  setFailoverRuleEnabled,
} from "./channel-failover.js";
// Notification deduplication
export {
  type DedupEntry,
  type DedupCheckResult,
  generateNotificationFingerprint,
  checkAndRecordDedup,
  coalesceNotifications,
  getDedupStats,
} from "./notification-dedup.js";
// Channel throttle/burst
export {
  type ThrottleConfig,
  type ThrottleStatus,
  type ThrottleBurstState,
  setChannelThrottle,
  getChannelThrottle,
  checkThrottle,
  getThrottleStatus,
  listWorkspaceThrottles,
  deleteChannelThrottle,
} from "./channel-throttle.js";
// Delivery escalation
export {
  type EscalationRule,
  type EscalationEvent,
  createEscalationRule,
  evaluateEscalation,
  manualEscalate,
  listEscalationRules,
  deleteEscalationRule,
} from "./delivery-escalation.js";
// Delivery windows (restrict when notifications can be sent)
export {
  type DeliveryWindow,
  type WindowCheckResult,
  createDeliveryWindow,
  getDeliveryWindow,
  checkDeliveryWindow,
  holdForWindow,
  listUserDeliveryWindows,
  deleteDeliveryWindow,
} from "./delivery-windows.js";
// Quiet hours and notification snooze
export {
  type QuietHours,
  type SnoozedNotification,
  setQuietHours,
  getQuietHours,
  isInQuietHours,
  disableQuietHours,
  snoozeNotification,
  getNotificationSnooze,
  isSnoozed,
  listUserSnoozes,
  dismissSnooze,
} from "./quiet-hours.js";
