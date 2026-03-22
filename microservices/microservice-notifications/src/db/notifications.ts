/**
 * Notification CRUD, rules, templates, and event processing
 */

import { getDatabase } from "./database.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Channel = "email" | "slack" | "sms" | "webhook" | "in_app";
export type NotificationStatus = "pending" | "sent" | "failed" | "read";
export type Priority = "low" | "normal" | "high" | "urgent";

export interface Notification {
  id: string;
  channel: Channel;
  recipient: string;
  subject: string | null;
  body: string | null;
  status: NotificationStatus;
  source_service: string | null;
  source_event: string | null;
  priority: Priority;
  metadata: Record<string, unknown>;
  created_at: string;
  sent_at: string | null;
}

interface NotificationRow {
  id: string;
  channel: string;
  recipient: string;
  subject: string | null;
  body: string | null;
  status: string;
  source_service: string | null;
  source_event: string | null;
  priority: string;
  metadata: string;
  created_at: string;
  sent_at: string | null;
}

function rowToNotification(row: NotificationRow): Notification {
  return {
    ...row,
    channel: row.channel as Channel,
    status: row.status as NotificationStatus,
    priority: row.priority as Priority,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface NotificationRule {
  id: string;
  name: string | null;
  trigger_event: string;
  channel: string;
  recipient: string;
  template_id: string | null;
  enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface RuleRow {
  id: string;
  name: string | null;
  trigger_event: string;
  channel: string;
  recipient: string;
  template_id: string | null;
  enabled: number;
  metadata: string;
  created_at: string;
}

function rowToRule(row: RuleRow): NotificationRule {
  return {
    ...row,
    enabled: row.enabled === 1,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface NotificationTemplate {
  id: string;
  name: string;
  channel: string | null;
  subject_template: string | null;
  body_template: string | null;
  variables: string[];
  created_at: string;
}

interface TemplateRow {
  id: string;
  name: string;
  channel: string | null;
  subject_template: string | null;
  body_template: string | null;
  variables: string;
  created_at: string;
}

function rowToTemplate(row: TemplateRow): NotificationTemplate {
  return {
    ...row,
    variables: JSON.parse(row.variables || "[]"),
  };
}

// ─── Notifications ───────────────────────────────────────────────────────────

export interface SendNotificationInput {
  channel: Channel;
  recipient: string;
  subject?: string;
  body?: string;
  source_service?: string;
  source_event?: string;
  priority?: Priority;
  metadata?: Record<string, unknown>;
}

export function sendNotification(input: SendNotificationInput): Notification {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO notifications (id, channel, recipient, subject, body, source_service, source_event, priority, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.channel,
    input.recipient,
    input.subject || null,
    input.body || null,
    input.source_service || null,
    input.source_event || null,
    input.priority || "normal",
    metadata
  );

  return getNotification(id)!;
}

export function getNotification(id: string): Notification | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as NotificationRow | null;
  return row ? rowToNotification(row) : null;
}

export interface ListNotificationsOptions {
  status?: NotificationStatus;
  channel?: Channel;
  priority?: Priority;
  recipient?: string;
  limit?: number;
  offset?: number;
}

export function listNotifications(options: ListNotificationsOptions = {}): Notification[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options.channel) {
    conditions.push("channel = ?");
    params.push(options.channel);
  }
  if (options.priority) {
    conditions.push("priority = ?");
    params.push(options.priority);
  }
  if (options.recipient) {
    conditions.push("recipient = ?");
    params.push(options.recipient);
  }

  let sql = "SELECT * FROM notifications";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as NotificationRow[];
  return rows.map(rowToNotification);
}

export function markRead(id: string): Notification | null {
  const db = getDatabase();
  const existing = getNotification(id);
  if (!existing) return null;

  db.prepare("UPDATE notifications SET status = 'read' WHERE id = ?").run(id);
  return getNotification(id);
}

export function markAllRead(recipient: string): number {
  const db = getDatabase();
  const result = db.prepare(
    "UPDATE notifications SET status = 'read' WHERE recipient = ? AND status != 'read'"
  ).run(recipient);
  return result.changes;
}

export function markSent(id: string): Notification | null {
  const db = getDatabase();
  const existing = getNotification(id);
  if (!existing) return null;

  db.prepare(
    "UPDATE notifications SET status = 'sent', sent_at = datetime('now') WHERE id = ?"
  ).run(id);
  return getNotification(id);
}

export function markFailed(id: string): Notification | null {
  const db = getDatabase();
  const existing = getNotification(id);
  if (!existing) return null;

  db.prepare("UPDATE notifications SET status = 'failed' WHERE id = ?").run(id);
  return getNotification(id);
}

// ─── Rules ───────────────────────────────────────────────────────────────────

export interface CreateRuleInput {
  name?: string;
  trigger_event: string;
  channel: string;
  recipient: string;
  template_id?: string;
  metadata?: Record<string, unknown>;
}

export function createRule(input: CreateRuleInput): NotificationRule {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO notification_rules (id, name, trigger_event, channel, recipient, template_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name || null,
    input.trigger_event,
    input.channel,
    input.recipient,
    input.template_id || null,
    metadata
  );

  return getRule(id)!;
}

export function getRule(id: string): NotificationRule | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM notification_rules WHERE id = ?").get(id) as RuleRow | null;
  return row ? rowToRule(row) : null;
}

export function listRules(): NotificationRule[] {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM notification_rules ORDER BY created_at DESC").all() as RuleRow[];
  return rows.map(rowToRule);
}

export interface UpdateRuleInput {
  name?: string;
  trigger_event?: string;
  channel?: string;
  recipient?: string;
  template_id?: string | null;
  metadata?: Record<string, unknown>;
}

export function updateRule(id: string, input: UpdateRuleInput): NotificationRule | null {
  const db = getDatabase();
  const existing = getRule(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.trigger_event !== undefined) {
    sets.push("trigger_event = ?");
    params.push(input.trigger_event);
  }
  if (input.channel !== undefined) {
    sets.push("channel = ?");
    params.push(input.channel);
  }
  if (input.recipient !== undefined) {
    sets.push("recipient = ?");
    params.push(input.recipient);
  }
  if (input.template_id !== undefined) {
    sets.push("template_id = ?");
    params.push(input.template_id);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  params.push(id);
  db.prepare(`UPDATE notification_rules SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getRule(id);
}

export function deleteRule(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM notification_rules WHERE id = ?").run(id);
  return result.changes > 0;
}

export function enableRule(id: string): NotificationRule | null {
  const db = getDatabase();
  const existing = getRule(id);
  if (!existing) return null;

  db.prepare("UPDATE notification_rules SET enabled = 1 WHERE id = ?").run(id);
  return getRule(id);
}

export function disableRule(id: string): NotificationRule | null {
  const db = getDatabase();
  const existing = getRule(id);
  if (!existing) return null;

  db.prepare("UPDATE notification_rules SET enabled = 0 WHERE id = ?").run(id);
  return getRule(id);
}

// ─── Templates ───────────────────────────────────────────────────────────────

export interface CreateTemplateInput {
  name: string;
  channel?: string;
  subject_template?: string;
  body_template?: string;
  variables?: string[];
}

export function createTemplate(input: CreateTemplateInput): NotificationTemplate {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const variables = JSON.stringify(input.variables || []);

  db.prepare(
    `INSERT INTO notification_templates (id, name, channel, subject_template, body_template, variables)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.channel || null,
    input.subject_template || null,
    input.body_template || null,
    variables
  );

  return getTemplate(id)!;
}

export function getTemplate(id: string): NotificationTemplate | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM notification_templates WHERE id = ?").get(id) as TemplateRow | null;
  return row ? rowToTemplate(row) : null;
}

export function listTemplates(): NotificationTemplate[] {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM notification_templates ORDER BY created_at DESC").all() as TemplateRow[];
  return rows.map(rowToTemplate);
}

export function deleteTemplate(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM notification_templates WHERE id = ?").run(id);
  return result.changes > 0;
}

export function renderTemplate(
  templateId: string,
  variables: Record<string, string>
): { subject: string | null; body: string | null } | null {
  const template = getTemplate(templateId);
  if (!template) return null;

  function substitute(text: string | null): string | null {
    if (!text) return null;
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
  }

  return {
    subject: substitute(template.subject_template),
    body: substitute(template.body_template),
  };
}

// ─── Event Processing ────────────────────────────────────────────────────────

export function processEvent(
  event: string,
  data: Record<string, string> = {}
): Notification[] {
  const db = getDatabase();
  const rows = db.prepare(
    "SELECT * FROM notification_rules WHERE trigger_event = ? AND enabled = 1"
  ).all(event) as RuleRow[];

  const rules = rows.map(rowToRule);
  const notifications: Notification[] = [];

  for (const rule of rules) {
    let subject: string | null = null;
    let body: string | null = null;

    if (rule.template_id) {
      const rendered = renderTemplate(rule.template_id, data);
      if (rendered) {
        subject = rendered.subject;
        body = rendered.body;
      }
    }

    const notification = sendNotification({
      channel: rule.channel as Channel,
      recipient: rule.recipient,
      subject,
      body,
      source_service: undefined,
      source_event: event,
      priority: "normal",
      metadata: data,
    });

    notifications.push(notification);
  }

  return notifications;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface NotificationStats {
  total: number;
  by_channel: Record<string, number>;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
}

export function getNotificationStats(): NotificationStats {
  const db = getDatabase();

  const totalRow = db.prepare("SELECT COUNT(*) as count FROM notifications").get() as { count: number };

  const channelRows = db.prepare(
    "SELECT channel, COUNT(*) as count FROM notifications GROUP BY channel"
  ).all() as { channel: string; count: number }[];

  const statusRows = db.prepare(
    "SELECT status, COUNT(*) as count FROM notifications GROUP BY status"
  ).all() as { status: string; count: number }[];

  const priorityRows = db.prepare(
    "SELECT priority, COUNT(*) as count FROM notifications GROUP BY priority"
  ).all() as { priority: string; count: number }[];

  const by_channel: Record<string, number> = {};
  for (const row of channelRows) by_channel[row.channel] = row.count;

  const by_status: Record<string, number> = {};
  for (const row of statusRows) by_status[row.status] = row.count;

  const by_priority: Record<string, number> = {};
  for (const row of priorityRows) by_priority[row.priority] = row.count;

  return {
    total: totalRow.count,
    by_channel,
    by_status,
    by_priority,
  };
}
