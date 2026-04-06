/**
 * Prompt template versioning for LLM requests.
 * Stores reusable prompt templates with variable substitution and version history.
 */

import type { Sql } from "postgres";

export interface PromptTemplate {
  id: string;
  workspace_id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  template: string;
  variables: string[];
  model_provider: string | null;
  model_name: string | null;
  version: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface CreatePromptTemplateInput {
  workspace_id: string;
  user_id?: string;
  name: string;
  description?: string;
  template: string;
  variables?: string[];
  model_provider?: string;
  model_name?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdatePromptTemplateInput {
  name?: string;
  description?: string;
  template?: string;
  variables?: string[];
  model_provider?: string;
  model_name?: string;
  is_active?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RenderedPrompt {
  content: string;
  variables_used: string[];
  variables_missing: string[];
  template_id: string;
  template_version: number;
}

/**
 * Create a new prompt template.
 */
export async function createPromptTemplate(
  sql: Sql,
  input: CreatePromptTemplateInput,
): Promise<PromptTemplate> {
  const [template] = await sql<PromptTemplate[]>`
    INSERT INTO llm.prompt_templates
      (workspace_id, user_id, name, description, template, variables,
       model_provider, model_name, version, is_active, metadata)
    VALUES (
      ${input.workspace_id},
      ${input.user_id ?? null},
      ${input.name},
      ${input.description ?? null},
      ${input.template},
      ${input.variables ?? []},
      ${input.model_provider ?? null},
      ${input.model_name ?? null},
      1,
      true,
      ${input.metadata ?? {}}
    )
    RETURNING *
  `;
  return template;
}

/**
 * Get a prompt template by ID.
 */
export async function getPromptTemplate(
  sql: Sql,
  templateId: string,
): Promise<PromptTemplate | null> {
  const [row] = await sql<PromptTemplate[]>`
    SELECT * FROM llm.prompt_templates WHERE id = ${templateId}
  `;
  return row ?? null;
}

/**
 * List prompt templates for a workspace.
 */
export async function listPromptTemplates(
  sql: Sql,
  workspaceId: string,
  options?: { user_id?: string; is_active?: boolean; limit?: number },
): Promise<PromptTemplate[]> {
  const limit = options?.limit ?? 50;

  let query = sql<PromptTemplate[]>`
    SELECT * FROM llm.prompt_templates
    WHERE workspace_id = ${workspaceId}
  `;

  if (options?.user_id) {
    query = sql<PromptTemplate[]>`
      SELECT * FROM llm.prompt_templates
      WHERE workspace_id = ${workspaceId}
        AND (user_id = ${options.user_id} OR user_id IS NULL)
    `;
  }

  if (options?.is_active !== undefined) {
    query = sql<PromptTemplate[]>`
      SELECT * FROM llm.prompt_templates
      WHERE workspace_id = ${workspaceId}
        AND is_active = ${options.is_active}
    `;
  }

  const [rows] = await sql<PromptTemplate[]>`
    SELECT * FROM llm.prompt_templates
    WHERE workspace_id = ${workspaceId}
      AND (${options?.user_id ? sql`user_id = ${options.user_id} OR` : sql``} user_id IS NULL)
      AND ${options?.is_active !== undefined ? sql`is_active = ${options.is_active}` : sql`true`}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;

  return rows;
}

/**
 * Update a prompt template. Creates a new version.
 */
export async function updatePromptTemplate(
  sql: Sql,
  templateId: string,
  input: UpdatePromptTemplateInput,
): Promise<PromptTemplate | null> {
  const [existing] = await sql<PromptTemplate[]>`
    SELECT * FROM llm.prompt_templates WHERE id = ${templateId}
  `;
  if (!existing) return null;

  const [updated] = await sql<PromptTemplate[]>`
    UPDATE llm.prompt_templates SET
      name = ${input.name ?? existing.name},
      description = ${input.description ?? existing.description},
      template = ${input.template ?? existing.template},
      variables = ${input.variables ?? existing.variables},
      model_provider = ${input.model_provider ?? existing.model_provider},
      model_name = ${input.model_name ?? existing.model_name},
      is_active = ${input.is_active ?? existing.is_active},
      metadata = ${input.metadata ?? existing.metadata},
      version = ${existing.version + 1},
      updated_at = NOW()
    WHERE id = ${templateId}
    RETURNING *
  `;
  return updated;
}

/**
 * Delete a prompt template (soft delete via is_active = false).
 */
export async function deletePromptTemplate(
  sql: Sql,
  templateId: string,
): Promise<boolean> {
  const result = await sql`UPDATE llm.prompt_templates SET is_active = false WHERE id = ${templateId}`;
  return (result as any).count > 0;
}

/**
 * Render a prompt template with variable substitution.
 */
export async function renderPromptTemplate(
  sql: Sql,
  templateId: string,
  variables: Record<string, string>,
): Promise<RenderedPrompt | null> {
  const [template] = await sql<PromptTemplate[]>`
    SELECT * FROM llm.prompt_templates WHERE id = ${templateId} AND is_active = true
  `;
  if (!template) return null;

  const allVars = new Set(template.variables);
  const used: string[] = [];
  const missing: string[] = [];

  for (const v of template.variables) {
    if (variables[v] !== undefined) used.push(v);
    else missing.push(v);
  }

  let content = template.template;
  for (const [key, value] of Object.entries(variables)) {
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  return {
    content,
    variables_used: used,
    variables_missing: missing,
    template_id: template.id,
    template_version: template.version,
  };
}

/**
 * Get version history for a template.
 */
export async function getTemplateVersionHistory(
  sql: Sql,
  templateId: string,
): Promise<{ version: number; updated_at: Date; template: string }[]> {
  // This would ideally use a history table; for now return current with note
  const [template] = await sql<PromptTemplate[]>`
    SELECT version, updated_at, template FROM llm.prompt_templates WHERE id = ${templateId}
  `;
  if (!template) return [];
  return [{ version: template.version, updated_at: template.updated_at, template: template.template }];
}