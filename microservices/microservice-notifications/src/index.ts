/**
 * microservice-notifications — Notification management microservice
 */

export {
  sendNotification,
  getNotification,
  listNotifications,
  markRead,
  markAllRead,
  markSent,
  markFailed,
  createRule,
  getRule,
  listRules,
  updateRule,
  deleteRule,
  enableRule,
  disableRule,
  createTemplate,
  getTemplate,
  listTemplates,
  deleteTemplate,
  renderTemplate,
  processEvent,
  getNotificationStats,
  type Notification,
  type NotificationRule,
  type NotificationTemplate,
  type NotificationStats,
  type SendNotificationInput,
  type ListNotificationsOptions,
  type CreateRuleInput,
  type UpdateRuleInput,
  type CreateTemplateInput,
  type Channel,
  type NotificationStatus,
  type Priority,
} from "./db/notifications.js";

export { getDatabase, closeDatabase } from "./db/database.js";
