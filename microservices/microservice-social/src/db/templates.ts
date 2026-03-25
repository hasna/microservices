/**
 * Template CRUD operations
 */

import { getDatabase } from "./database.js";
import { createPost } from "./posts.js";
import type { Post } from "./posts.js";

export interface Template {
  id: string;
  name: string;
  content: string;
  variables: string[];
  created_at: string;
}

interface TemplateRow {
  id: string;
  name: string;
  content: string;
  variables: string;
  created_at: string;
}

function rowToTemplate(row: TemplateRow): Template {
  return {
    ...row,
    variables: JSON.parse(row.variables || "[]"),
  };
}

export interface CreateTemplateInput {
  name: string;
  content: string;
  variables?: string[];
}

export function createTemplate(input: CreateTemplateInput): Template {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const variables = JSON.stringify(input.variables || []);

  db.prepare(
    `INSERT INTO templates (id, name, content, variables)
     VALUES (?, ?, ?, ?)`
  ).run(id, input.name, input.content, variables);

  return getTemplate(id)!;
}

export function getTemplate(id: string): Template | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM templates WHERE id = ?").get(id) as TemplateRow | null;
  return row ? rowToTemplate(row) : null;
}

export function listTemplates(): Template[] {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM templates ORDER BY name").all() as TemplateRow[];
  return rows.map(rowToTemplate);
}

export function deleteTemplate(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM templates WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Use a template to create a post — replaces {{variable}} with values
 */
export function useTemplate(
  templateId: string,
  accountId: string,
  values: Record<string, string>,
  tags?: string[]
): Post {
  const template = getTemplate(templateId);
  if (!template) throw new Error(`Template '${templateId}' not found`);

  let content = template.content;
  for (const [key, value] of Object.entries(values)) {
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  return createPost({
    account_id: accountId,
    content,
    tags,
  });
}
