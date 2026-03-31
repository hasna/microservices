import type { Sql } from "postgres";

export interface Prompt {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  current_version_id: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface PromptWithContent extends Prompt {
  content: string | null;
  version_number: number | null;
  model: string | null;
  variables: string[];
}

/** Extract declared {{variables}} from content */
function extractVariables(content: string): string[] {
  const matches = content.match(/\{\{(\w+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.slice(2, -2)))];
}

export async function createPrompt(
  sql: Sql,
  opts: { workspaceId: string; name: string; content: string; description?: string; model?: string; variables?: string[]; tags?: string[]; createdBy?: string }
): Promise<PromptWithContent> {
  const variables = opts.variables ?? extractVariables(opts.content);
  const tags = opts.tags ?? [];

  return await sql.begin(async tx => {
    const [prompt] = await tx`
      INSERT INTO prompts.prompts (workspace_id, name, description, tags)
      VALUES (${opts.workspaceId}, ${opts.name}, ${opts.description ?? null}, ${tags})
      RETURNING *`;

    const [version] = await tx`
      INSERT INTO prompts.versions (prompt_id, version_number, content, variables, model, created_by, change_note)
      VALUES (${prompt.id}, 1, ${opts.content}, ${variables}, ${opts.model ?? null}, ${opts.createdBy ?? null}, 'Initial version')
      RETURNING *`;

    await tx`UPDATE prompts.prompts SET current_version_id = ${version.id} WHERE id = ${prompt.id}`;

    return {
      ...prompt,
      current_version_id: version.id,
      content: opts.content,
      version_number: 1,
      model: opts.model ?? null,
      variables,
    } as PromptWithContent;
  });
}

export async function getPrompt(sql: Sql, workspaceId: string, name: string): Promise<PromptWithContent | null> {
  const [row] = await sql`
    SELECT p.*, v.content, v.version_number, v.model, v.variables
    FROM prompts.prompts p
    LEFT JOIN prompts.versions v ON v.id = p.current_version_id
    WHERE p.workspace_id = ${workspaceId} AND p.name = ${name}`;
  return row ? (row as unknown as PromptWithContent) : null;
}

export async function getPromptById(sql: Sql, id: string): Promise<PromptWithContent | null> {
  const [row] = await sql`
    SELECT p.*, v.content, v.version_number, v.model, v.variables
    FROM prompts.prompts p
    LEFT JOIN prompts.versions v ON v.id = p.current_version_id
    WHERE p.id = ${id}`;
  return row ? (row as unknown as PromptWithContent) : null;
}

export async function listPrompts(
  sql: Sql,
  workspaceId: string,
  opts?: { tags?: string[]; search?: string; limit?: number }
): Promise<PromptWithContent[]> {
  const limit = opts?.limit ?? 100;
  const tags = opts?.tags;
  const search = opts?.search;

  if (tags && tags.length > 0 && search) {
    return (await sql`
      SELECT p.*, v.content, v.version_number, v.model, v.variables
      FROM prompts.prompts p
      LEFT JOIN prompts.versions v ON v.id = p.current_version_id
      WHERE p.workspace_id = ${workspaceId}
        AND p.tags @> ${tags}
        AND (p.name ILIKE ${"%" + search + "%"} OR p.description ILIKE ${"%" + search + "%"})
      ORDER BY p.updated_at DESC LIMIT ${limit}`) as unknown as PromptWithContent[];
  }
  if (tags && tags.length > 0) {
    return (await sql`
      SELECT p.*, v.content, v.version_number, v.model, v.variables
      FROM prompts.prompts p
      LEFT JOIN prompts.versions v ON v.id = p.current_version_id
      WHERE p.workspace_id = ${workspaceId} AND p.tags @> ${tags}
      ORDER BY p.updated_at DESC LIMIT ${limit}`) as unknown as PromptWithContent[];
  }
  if (search) {
    return (await sql`
      SELECT p.*, v.content, v.version_number, v.model, v.variables
      FROM prompts.prompts p
      LEFT JOIN prompts.versions v ON v.id = p.current_version_id
      WHERE p.workspace_id = ${workspaceId}
        AND (p.name ILIKE ${"%" + search + "%"} OR p.description ILIKE ${"%" + search + "%"})
      ORDER BY p.updated_at DESC LIMIT ${limit}`) as unknown as PromptWithContent[];
  }
  return (await sql`
    SELECT p.*, v.content, v.version_number, v.model, v.variables
    FROM prompts.prompts p
    LEFT JOIN prompts.versions v ON v.id = p.current_version_id
    WHERE p.workspace_id = ${workspaceId}
    ORDER BY p.updated_at DESC LIMIT ${limit}`) as unknown as PromptWithContent[];
}

export async function deletePrompt(sql: Sql, id: string): Promise<boolean> {
  const result = await sql`DELETE FROM prompts.prompts WHERE id = ${id}`;
  return result.count > 0;
}
