/**
 * Prompt versioning — track version history of prompt template changes.
 */

import type { Sql } from "postgres";

export interface PromptVersion {
  id: string;
  template_id: string;
  version_number: number;
  content: string;
  variables: string[];
  description: string | null;
  changed_by: string | null;
  changed_at: string;
  change_reason: string | null;
}

/**
 * Create a new version of a prompt template (call before updating).
 */
export async function createPromptVersion(
  sql: Sql,
  opts: {
    templateId: string;
    content: string;
    variables: string[];
    description?: string;
    changedBy?: string;
    changeReason?: string;
  },
): Promise<PromptVersion> {
  const [existing] = await sql<{ id: string; version_number: number }[]>`
    SELECT id, version_number
    FROM llm.prompt_versions
    WHERE template_id = ${opts.templateId}
    ORDER BY version_number DESC
    LIMIT 1
  `;
  const nextVersion = existing ? existing.version_number + 1 : 1;

  const [version] = await sql<PromptVersion[]>`
    INSERT INTO llm.prompt_versions (
      template_id, version_number, content, variables,
      description, changed_by, change_reason
    )
    VALUES (
      ${opts.templateId}, ${nextVersion}, ${opts.content},
      ${opts.variables}, ${opts.description ?? null},
      ${opts.changedBy ?? null}, ${opts.changeReason ?? null}
    )
    RETURNING
      id, template_id, version_number, content, variables,
      description, changed_by, changed_at::text, change_reason
  `;
  return version;
}

/**
 * Get all versions of a prompt template.
 */
export async function getPromptVersions(
  sql: Sql,
  templateId: string,
  limit = 20,
): Promise<PromptVersion[]> {
  return sql<PromptVersion[]>`
    SELECT id, template_id, version_number, content, variables,
           description, changed_by, changed_at::text, change_reason
    FROM llm.prompt_versions
    WHERE template_id = ${templateId}
    ORDER BY version_number DESC
    LIMIT ${limit}
  `;
}

/**
 * Get a specific version of a prompt template.
 */
export async function getPromptVersion(
  sql: Sql,
  templateId: string,
  versionNumber: number,
): Promise<PromptVersion | null> {
  const [version] = await sql<PromptVersion[]>`
    SELECT id, template_id, version_number, content, variables,
           description, changed_by, changed_at::text, change_reason
    FROM llm.prompt_versions
    WHERE template_id = ${templateId}
      AND version_number = ${versionNumber}
  `;
  return version ?? null;
}

/**
 * Compare two versions of a prompt template.
 */
export async function comparePromptVersions(
  sql: Sql,
  templateId: string,
  versionA: number,
  versionB: number,
): Promise<{
  version_a: PromptVersion | null;
  version_b: PromptVersion | null;
  content_changed: boolean;
  variables_added: string[];
  variables_removed: string[];
  variables_changed: string[];
}> {
  const [vA, vB] = await Promise.all([
    getPromptVersion(sql, templateId, versionA),
    getPromptVersion(sql, templateId, versionB),
  ]);

  const varsA = new Set(vA?.variables ?? []);
  const varsB = new Set(vB?.variables ?? []);

  const added = [...varsB].filter((v) => !varsA.has(v));
  const removed = [...varsA].filter((v) => !varsB.has(v));
  const changed = [...varsA].filter((v) => varsB.has(v));

  return {
    version_a: vA,
    version_b: vB,
    content_changed: vA?.content !== vB?.content,
    variables_added: added,
    variables_removed: removed,
    variables_changed: changed,
  };
}

/**
 * Restore a prompt template to a previous version.
 */
export async function restorePromptVersion(
  sql: Sql,
  templateId: string,
  versionNumber: number,
  restoredBy?: string,
): Promise<{ restored: boolean; new_version: number; content: string }> {
  const version = await getPromptVersion(sql, templateId, versionNumber);
  if (!version) return { restored: false, new_version: 0, content: "" };

  const [existing] = await sql<{ id: string; version_number: number }[]>`
    SELECT id, version_number
    FROM llm.prompt_versions
    WHERE template_id = ${templateId}
    ORDER BY version_number DESC
    LIMIT 1
  `;
  const nextVersion = existing ? existing.version_number + 1 : 1;

  // Create a new version with the old content (restore by creating new)
  await createPromptVersion(sql, {
    templateId,
    content: version.content,
    variables: version.variables,
    description: version.description ?? undefined,
    changedBy: restoredBy,
    changeReason: `Restored from version ${versionNumber}`,
  });

  return { restored: true, new_version: nextVersion, content: version.content };
}
