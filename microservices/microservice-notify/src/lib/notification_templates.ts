import type { Sql } from "postgres";

/**
 * Notification templates with subject_template and body_template supporting {{variable}} placeholders.
 * Distinct from the existing notify.templates table — this is for renderable content templates.
 */
export interface NotificationTemplate {
  id: string;
  workspace_id: string | null;
  name: string;
  channel_type: string | null;
  subject_template: string | null;
  body_template: string;
  variables: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateData {
  workspaceId?: string;
  name: string;
  channelType?: string;
  subjectTemplate?: string;
  bodyTemplate: string;
  variables?: string[];
}

export interface RenderResult {
  subject: string | null;
  body: string;
}

/**
 * Create a new notification template.
 */
export async function createTemplate(
  sql: Sql,
  data: CreateTemplateData,
): Promise<NotificationTemplate> {
  const [t] = await sql<NotificationTemplate[]>`
    INSERT INTO notify.notification_templates
      (workspace_id, name, channel_type, subject_template, body_template, variables)
    VALUES (
      ${data.workspaceId ?? null},
      ${data.name},
      ${data.channelType ?? null},
      ${data.subjectTemplate ?? null},
      ${data.bodyTemplate},
      ${data.variables ?? []}
    )
    RETURNING *
  `;
  return t;
}

/**
 * Get a template by ID.
 */
export async function getTemplate(
  sql: Sql,
  id: string,
): Promise<NotificationTemplate | null> {
  const [t] = await sql<NotificationTemplate[]>`
    SELECT * FROM notify.notification_templates WHERE id = ${id}
  `;
  return t ?? null;
}

/**
 * List all templates for a workspace (or global if workspace_id is null).
 */
export async function listTemplates(
  sql: Sql,
  workspaceId?: string,
): Promise<NotificationTemplate[]> {
  if (workspaceId) {
    return sql<NotificationTemplate[]>`
      SELECT * FROM notify.notification_templates
      WHERE workspace_id = ${workspaceId} OR workspace_id IS NULL
      ORDER BY name ASC
    `;
  }
  return sql<NotificationTemplate[]>`
    SELECT * FROM notify.notification_templates ORDER BY name ASC
  `;
}

/**
 * Delete a template by ID.
 */
export async function deleteTemplate(
  sql: Sql,
  id: string,
): Promise<boolean> {
  const r = await sql`DELETE FROM notify.notification_templates WHERE id = ${id}`;
  return r.count > 0;
}

/**
 * Render a template by substituting {{variable}} placeholders.
 * Variables not found in the map are left as-is.
 */
export function renderTemplate(
  template: NotificationTemplate,
  variables: Record<string, string>,
): RenderResult {
  const replace = (str: string | null) =>
    !str
      ? null
      : str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
          return key in variables ? variables[key] : match;
        });

  return {
    subject: replace(template.subject_template),
    body: replace(template.body_template) ?? template.body_template,
  };
}

/**
 * Render a template by ID.
 */
export async function renderTemplateById(
  sql: Sql,
  templateId: string,
  variables: Record<string, string>,
): Promise<RenderResult | null> {
  const t = await getTemplate(sql, templateId);
  if (!t) return null;
  return renderTemplate(t, variables);
}
