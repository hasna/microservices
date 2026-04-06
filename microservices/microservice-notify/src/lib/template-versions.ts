/**
 * Template versioning — maintains a version history for notification templates
 * so changes can be audited and rolled back to any previous version.
 *
 * template_versions table: immutable append-only log of every change to a template.
 */

import type { Sql } from "postgres";
import type { NotificationTemplate } from "./notification_templates.js";

export interface TemplateVersion {
  id: string;
  template_id: string;
  version_number: number;
  name: string;
  subject_template: string | null;
  body_template: string;
  channel_type: string | null;
  variables: string[];
  changed_by: string | null;
  change_reason: string | null;
  created_at: Date;
}

export interface CreateVersionInput {
  template_id: string;
  name: string;
  subject_template: string | null;
  body_template: string;
  channel_type: string | null;
  variables: string[];
  changed_by?: string | null;
  change_reason?: string | null;
}

/**
 * Record a new version of a template. Called whenever a template is updated.
 */
export async function createTemplateVersion(
  sql: Sql,
  input: CreateVersionInput,
): Promise<TemplateVersion> {
  const [last] = await sql<TemplateVersion[]>`
    SELECT version_number FROM notify.template_versions
    WHERE template_id = ${input.template_id}
    ORDER BY version_number DESC
    LIMIT 1
  `;
  const nextVersion = last ? last.version_number + 1 : 1;

  const [row] = await sql<TemplateVersion[]>`
    INSERT INTO notify.template_versions (
      template_id, version_number, name, subject_template,
      body_template, channel_type, variables, changed_by, change_reason
    )
    VALUES (
      ${input.template_id},
      ${nextVersion},
      ${input.name},
      ${input.subject_template},
      ${input.body_template},
      ${input.channel_type},
      ${input.variables},
      ${input.changed_by ?? null},
      ${input.change_reason ?? null}
    )
    RETURNING *
  `;
  return row;
}

/**
 * Get a specific version of a template by template_id and version_number.
 */
export async function getTemplateVersion(
  sql: Sql,
  templateId: string,
  versionNumber: number,
): Promise<TemplateVersion | null> {
  const [row] = await sql<TemplateVersion[]>`
    SELECT * FROM notify.template_versions
    WHERE template_id = ${templateId} AND version_number = ${versionNumber}
  `;
  return row ?? null;
}

/**
 * List all versions of a template, newest first.
 */
export async function listTemplateVersions(
  sql: Sql,
  templateId: string,
): Promise<TemplateVersion[]> {
  return sql<TemplateVersion[]>`
    SELECT * FROM notify.template_versions
    WHERE template_id = ${templateId}
    ORDER BY version_number DESC
  `;
}

/**
 * Get the latest version of a template.
 */
export async function getLatestTemplateVersion(
  sql: Sql,
  templateId: string,
): Promise<TemplateVersion | null> {
  const [row] = await sql<TemplateVersion[]>`
    SELECT * FROM notify.template_versions
    WHERE template_id = ${templateId}
    ORDER BY version_number DESC
    LIMIT 1
  `;
  return row ?? null;
}

/**
 * Rollback a template to a specific version. Updates the live template
 * with the content of the target version. Returns the newly created version.
 */
export async function rollbackTemplate(
  sql: Sql,
  templateId: string,
  targetVersion: number,
  changedBy?: string,
  reason?: string,
): Promise<TemplateVersion | null> {
  const target = await getTemplateVersion(sql, templateId, targetVersion);
  if (!target) return null;

  // Update the live template row
  await sql`
    UPDATE notify.notification_templates SET
      name             = ${target.name},
      subject_template = ${target.subject_template},
      body_template    = ${target.body_template},
      channel_type     = ${target.channel_type},
      variables        = ${target.variables},
      updated_at       = NOW()
    WHERE id = ${templateId}
  `;

  // Create a new version entry recording the rollback
  return createTemplateVersion(sql, {
    template_id: templateId,
    name: target.name,
    subject_template: target.subject_template,
    body_template: target.body_template,
    channel_type: target.channel_type,
    variables: target.variables,
    changed_by: changedBy ?? `rollback to v${targetVersion}`,
    change_reason: reason ?? "Rollback to previous version",
  });
}

/**
 * Compare two versions of a template and return the diff.
 */
export async function getTemplateVersionDiff(
  sql: Sql,
  templateId: string,
  fromVersion: number,
  toVersion: number,
): Promise<{
  from: TemplateVersion;
  to: TemplateVersion;
  changes: string[];
} | null> {
  const [from, to] = await Promise.all([
    getTemplateVersion(sql, templateId, fromVersion),
    getTemplateVersion(sql, templateId, toVersion),
  ]);
  if (!from || !to) return null;

  const changes: string[] = [];
  if (from.name !== to.name) changes.push(`name: "${from.name}" → "${to.name}"`);
  if ((from.subject_template ?? "") !== (to.subject_template ?? "")) changes.push(`subject: "${from.subject_template ?? ""}" → "${to.subject_template ?? ""}"`);
  if (from.body_template !== to.body_template) changes.push(`body: "${from.body_template.slice(0, 50)}..." → "${to.body_template.slice(0, 50)}..."`);
  if (from.channel_type !== to.channel_type) changes.push(`channel_type: ${from.channel_type ?? "null"} → ${to.channel_type ?? "null"}`);

  return { from, to, changes };
}
