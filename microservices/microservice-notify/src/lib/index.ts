export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
export {
  type BatchNotification,
  type BatchResult,
  sendBatch,
} from "./batch.js";
export {
  type CreateNotificationData,
  countUnread,
  createNotification,
  deleteNotification,
  getNotification,
  type ListNotificationsOptions,
  listUserNotifications,
  markAllRead,
  markRead,
  type Notification,
} from "./notifications.js";
export {
  getPreference,
  getUserPreferences,
  isChannelEnabled,
  type Preference,
  setPreference,
} from "./preferences.js";
export { type SendNotificationData, sendNotification } from "./send.js";
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
