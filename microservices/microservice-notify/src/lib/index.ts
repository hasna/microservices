export { migrate } from "../db/migrations.js";
export { getDb, closeDb } from "../db/client.js";
export {
  createNotification, getNotification, listUserNotifications,
  markRead, markAllRead, deleteNotification, countUnread,
  type Notification, type CreateNotificationData, type ListNotificationsOptions
} from "./notifications.js";
export {
  createTemplate, getTemplate, getTemplateByName, listTemplates,
  updateTemplate, deleteTemplate, renderTemplate,
  type Template, type CreateTemplateData
} from "./templates.js";
export {
  getPreference, setPreference, getUserPreferences, isChannelEnabled,
  type Preference
} from "./preferences.js";
export {
  createWebhookEndpoint, listWorkspaceWebhooks, updateWebhookEndpoint,
  deleteWebhookEndpoint, triggerWebhooks,
  type WebhookEndpoint, type CreateWebhookEndpointData
} from "./webhooks.js";
export { sendNotification, type SendNotificationData } from "./send.js";
export { sendBatch, type BatchNotification, type BatchResult } from "./batch.js";
export { generateUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe.js";
