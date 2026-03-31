import type { Sql } from "postgres";

export interface Template {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  channel: string | null;
  variables: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateData {
  name: string;
  subject?: string;
  body: string;
  channel?: string;
  variables?: string[];
}

export async function createTemplate(sql: Sql, data: CreateTemplateData): Promise<Template> {
  const [t] = await sql<Template[]>`
    INSERT INTO notify.templates (name, subject, body, channel, variables)
    VALUES (${data.name}, ${data.subject ?? null}, ${data.body}, ${data.channel ?? null}, ${data.variables ?? []})
    RETURNING *`;
  return t;
}

export async function getTemplate(sql: Sql, id: string): Promise<Template | null> {
  const [t] = await sql<Template[]>`SELECT * FROM notify.templates WHERE id = ${id}`;
  return t ?? null;
}

export async function getTemplateByName(sql: Sql, name: string): Promise<Template | null> {
  const [t] = await sql<Template[]>`SELECT * FROM notify.templates WHERE name = ${name}`;
  return t ?? null;
}

export async function listTemplates(sql: Sql): Promise<Template[]> {
  return sql<Template[]>`SELECT * FROM notify.templates ORDER BY name ASC`;
}

export async function updateTemplate(sql: Sql, id: string, data: Partial<CreateTemplateData>): Promise<Template | null> {
  const [t] = await sql<Template[]>`
    UPDATE notify.templates SET
      name      = COALESCE(${data.name ?? null}, name),
      subject   = COALESCE(${data.subject ?? null}, subject),
      body      = COALESCE(${data.body ?? null}, body),
      channel   = COALESCE(${data.channel ?? null}, channel),
      variables = COALESCE(${data.variables ?? null}, variables),
      updated_at = NOW()
    WHERE id = ${id} RETURNING *`;
  return t ?? null;
}

export async function deleteTemplate(sql: Sql, id: string): Promise<boolean> {
  const r = await sql`DELETE FROM notify.templates WHERE id = ${id}`;
  return r.count > 0;
}

/**
 * Render a template body/subject by substituting {{variable}} placeholders.
 * Variables not found in the map are left as-is.
 */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in variables ? variables[key] : match;
  });
}
