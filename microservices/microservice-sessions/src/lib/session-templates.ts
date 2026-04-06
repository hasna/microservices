/**
 * Session templates — reusable session templates with variable placeholders.
 * Create templates once, instantiate them multiple times with different variable values.
 */

import type { Sql } from "postgres";

export interface SessionTemplate {
  id: string;
  workspace_id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  system_prompt_template: string;
  variables: string[];
  default_model: string | null;
  metadata: Record<string, unknown>;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateInput {
  workspace_id: string;
  user_id?: string;
  name: string;
  description?: string;
  system_prompt_template: string;
  variables?: string[];
  default_model?: string;
  metadata?: Record<string, unknown>;
}

export interface RenderedTemplate {
  system_prompt: string;
  variables_used: string[];
  variables_missing: string[];
  template_id: string;
}

/**
 * Create a new session template.
 */
export async function createSessionTemplate(
  sql: Sql,
  input: CreateTemplateInput,
): Promise<SessionTemplate> {
  const [row] = await sql<SessionTemplate[]>`
    INSERT INTO sessions.session_templates
      (workspace_id, user_id, name, description, system_prompt_template, variables,
       default_model, metadata, use_count)
    VALUES (
      ${input.workspace_id},
      ${input.user_id ?? null},
      ${input.name},
      ${input.description ?? null},
      ${input.system_prompt_template},
      ${input.variables ?? []},
      ${input.default_model ?? null},
      ${input.metadata ?? {}},
      0
    )
    RETURNING *
  `;
  return row;
}

/**
 * Get a template by ID.
 */
export async function getSessionTemplate(
  sql: Sql,
  templateId: string,
): Promise<SessionTemplate | null> {
  const [row] = await sql<SessionTemplate[]>`
    SELECT * FROM sessions.session_templates WHERE id = ${templateId}
  `;
  return row ?? null;
}

/**
 * List templates for a workspace.
 */
export async function listSessionTemplates(
  sql: Sql,
  workspaceId: string,
  options?: { user_id?: string; limit?: number },
): Promise<SessionTemplate[]> {
  const limit = options?.limit ?? 50;
  const [rows] = await sql<SessionTemplate[]>`
    SELECT * FROM sessions.session_templates
    WHERE workspace_id = ${workspaceId}
      AND (${options?.user_id ? sql`user_id = ${options.user_id} OR user_id IS NULL` : sql`true`})
    ORDER BY use_count DESC, created_at DESC
    LIMIT ${limit}
  `;
  return rows;
}

/**
 * Update a template.
 */
export async function updateSessionTemplate(
  sql: Sql,
  templateId: string,
  updates: Partial<Pick<SessionTemplate, "name" | "description" | "system_prompt_template" | "variables" | "default_model" | "metadata">>,
): Promise<SessionTemplate | null> {
  const [existing] = await sql<SessionTemplate[]>`SELECT * FROM sessions.session_templates WHERE id = ${templateId}`;
  if (!existing) return null;

  const [updated] = await sql<SessionTemplate[]>`
    UPDATE sessions.session_templates SET
      name = ${updates.name ?? existing.name},
      description = ${updates.description ?? existing.description},
      system_prompt_template = ${updates.system_prompt_template ?? existing.system_prompt_template},
      variables = ${updates.variables ?? existing.variables},
      default_model = ${updates.default_model ?? existing.default_model},
      metadata = ${updates.metadata ?? existing.metadata},
      updated_at = NOW()
    WHERE id = ${templateId}
    RETURNING *
  `;
  return updated;
}

/**
 * Delete a template.
 */
export async function deleteSessionTemplate(
  sql: Sql,
  templateId: string,
): Promise<boolean> {
  const result = await sql`DELETE FROM sessions.session_templates WHERE id = ${templateId}`;
  return (result as any).count > 0;
}

/**
 * Render a template with variable substitution.
 * Variables use {{variable_name}} syntax.
 */
export async function renderSessionTemplate(
  sql: Sql,
  templateId: string,
  variables: Record<string, string>,
): Promise<RenderedTemplate | null> {
  const [template] = await sql<SessionTemplate[]>`
    SELECT * FROM sessions.session_templates WHERE id = ${templateId}
  `;
  if (!template) return null;

  const used: string[] = [];
  const missing: string[] = [];

  for (const v of template.variables) {
    if (variables[v] !== undefined) used.push(v);
    else missing.push(v);
  }

  let systemPrompt = template.system_prompt_template;
  for (const [key, value] of Object.entries(variables)) {
    systemPrompt = systemPrompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  // Increment use count
  await sql`UPDATE sessions.session_templates SET use_count = use_count + 1 WHERE id = ${templateId}`;

  return {
    system_prompt: systemPrompt,
    variables_used: used,
    variables_missing: missing,
    template_id: template.id,
  };
}

/**
 * Create a new session from a rendered template.
 */
export async function createSessionFromTemplate(
  sql: Sql,
  templateId: string,
  userId: string,
  variables: Record<string, string>,
  extra?: { title?: string; workspace_id?: string },
): Promise<{ conversationId: string; template: RenderedTemplate } | null> {
  const rendered = await renderSessionTemplate(sql, templateId, variables);
  if (!rendered) return null;

  const { getConversation } = await import("./conversations.js");
  const { createConversation } = await import("./conversations.js");

  // If workspace_id not provided, we'd need it — require it
  const workspaceId = extra?.workspace_id;
  if (!workspaceId) throw new Error("workspace_id required to create session from template");

  const conv = await createConversation(sql, {
    workspace_id: workspaceId,
    user_id: userId,
    title: extra?.title ?? `Session from template`,
    system_prompt: rendered.system_prompt,
    model: undefined,
    metadata: { template_id: templateId, template_variables: variables },
  });

  return { conversationId: conv.id, template: rendered };
}

/**
 * List most-used templates for a workspace.
 */
export async function getPopularTemplates(
  sql: Sql,
  workspaceId: string,
  limit = 10,
): Promise<SessionTemplate[]> {
  const [rows] = await sql<SessionTemplate[]>`
    SELECT * FROM sessions.session_templates
    WHERE workspace_id = ${workspaceId}
    ORDER BY use_count DESC
    LIMIT ${limit}
  `;
  return rows;
}