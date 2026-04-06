/**
 * Memory templates — reusable patterns for storing memories with predefined structures.
 */

import type { Sql } from "postgres";

export interface MemoryTemplate {
  id: string;
  workspace_id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  content_template: string;
  variables: string[];       // e.g. ["topic", "date", "outcome"]
  default_memory_type: "episodic" | "semantic" | "procedural" | "context";
  default_priority: number;
  metadata_template: any;     // JSON object with {{variable}} placeholders
  created_at: Date;
  updated_at: Date;
}

export interface CreateTemplateInput {
  workspaceId: string;
  userId?: string;
  name: string;
  description?: string;
  contentTemplate: string;    // e.g. "Meeting about {{topic}} on {{date}}: {{summary}}"
  variables?: string[];       // auto-extracted from contentTemplate if not provided
  defaultMemoryType?: "episodic" | "semantic" | "procedural" | "context";
  defaultPriority?: number;
  metadataTemplate?: any;
}

export interface RenderedTemplate {
  content: string;
  metadata: any;
  variables: Record<string, string>;
}

/**
 * Create a memory template.
 */
export async function createMemoryTemplate(
  sql: Sql,
  input: CreateTemplateInput,
): Promise<MemoryTemplate> {
  // Auto-extract variables from {{var}} placeholders if not provided
  const variables =
    input.variables ??
    [...input.contentTemplate.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);

  const [tmpl] = await sql<MemoryTemplate[]>`
    INSERT INTO memory.memory_templates
      (workspace_id, user_id, name, description, content_template,
       variables, default_memory_type, default_priority, metadata_template)
    VALUES (
      ${input.workspaceId}, ${input.userId ?? null}, ${input.name},
      ${input.description ?? null}, ${input.contentTemplate},
      ${variables}, ${input.defaultMemoryType ?? "semantic"},
      ${input.defaultPriority ?? 0}, ${input.metadataTemplate ?? {}}
    )
    RETURNING *
  `;
  return tmpl;
}

/**
 * Get a template by ID.
 */
export async function getMemoryTemplate(
  sql: Sql,
  id: string,
): Promise<MemoryTemplate | null> {
  const [tmpl] = await sql<MemoryTemplate[]>`
    SELECT * FROM memory.memory_templates WHERE id = ${id}
  `;
  return tmpl ?? null;
}

/**
 * List templates for a workspace.
 */
export async function listMemoryTemplates(
  sql: Sql,
  workspaceId: string,
  opts?: { userId?: string; limit?: number },
): Promise<MemoryTemplate[]> {
  const limit = opts?.limit ?? 50;
  let query = sql<MemoryTemplate[]>`
    SELECT * FROM memory.memory_templates
    WHERE workspace_id = ${workspaceId}
  `;
  if (opts?.userId) {
    query = sql<MemoryTemplate[]>`
      SELECT * FROM memory.memory_templates
      WHERE workspace_id = ${workspaceId}
        AND (user_id = ${opts.userId} OR user_id IS NULL)
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }
  return query;
}

/**
 * Update a template.
 */
export async function updateMemoryTemplate(
  sql: Sql,
  id: string,
  updates: Partial<Omit<CreateTemplateInput, "workspaceId">>,
): Promise<MemoryTemplate | null> {
  const sets: string[] = [];
  const vals: any[] = [];
  let idx = 0;

  if (updates.name !== undefined) { sets.push(`name = $${++idx}`); vals.push(updates.name); }
  if (updates.description !== undefined) { sets.push(`description = $${++idx}`); vals.push(updates.description); }
  if (updates.contentTemplate !== undefined) { sets.push(`content_template = $${++idx}`); vals.push(updates.contentTemplate); }
  if (updates.variables !== undefined) { sets.push(`variables = $${++idx}`); vals.push(updates.variables); }
  if (updates.defaultMemoryType !== undefined) { sets.push(`default_memory_type = $${++idx}`); vals.push(updates.defaultMemoryType); }
  if (updates.defaultPriority !== undefined) { sets.push(`default_priority = $${++idx}`); vals.push(updates.defaultPriority); }
  if (updates.metadataTemplate !== undefined) { sets.push(`metadata_template = $${++idx}`); vals.push(updates.metadataTemplate); }

  if (sets.length === 0) return getMemoryTemplate(sql, id);

  vals.push(id);
  const [tmpl] = await sql<MemoryTemplate[]>`
    UPDATE memory.memory_templates
    SET ${sql.unsafe(sets.join(", "))}, updated_at = NOW()
    WHERE id = $${vals.length}
    RETURNING *
  `;
  return tmpl ?? null;
}

/**
 * Delete a template.
 */
export async function deleteMemoryTemplate(
  sql: Sql,
  id: string,
): Promise<boolean> {
  const r = await sql`DELETE FROM memory.memory_templates WHERE id = ${id}`;
  return r.count > 0;
}

/**
 * Render a template by substituting {{variable}} placeholders.
 */
export function renderMemoryTemplate(
  template: MemoryTemplate | string,
  variables: Record<string, string>,
): RenderedTemplate {
  const content =
    typeof template === "string"
      ? template
      : template.content_template;

  let rendered = content;
  for (const [key, val] of Object.entries(variables)) {
    rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
  }

  const metadata =
    typeof template === "string" || !template.metadata_template
      ? {}
      : JSON.parse(
          JSON.stringify(template.metadata_template).replace(
            /\{\{(\w+)\}\}/g,
            (_, k) => variables[k] ?? `{{${k}}}`,
          ),
        );

  return { content: rendered, metadata, variables };
}

/**
 * Render a template by ID.
 */
export async function renderMemoryTemplateById(
  sql: Sql,
  templateId: string,
  variables: Record<string, string>,
): Promise<RenderedTemplate | null> {
  const tmpl = await getMemoryTemplate(sql, templateId);
  if (!tmpl) return null;
  return renderMemoryTemplate(tmpl, variables);
}
