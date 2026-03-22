/**
 * Category CRUD operations
 */

import { getDatabase } from "./database.js";

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  description: string | null;
  created_at: string;
}

export interface CreateCategoryInput {
  name: string;
  parent_id?: string;
  description?: string;
}

export function createCategory(input: CreateCategoryInput): Category {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO categories (id, name, parent_id, description)
     VALUES (?, ?, ?, ?)`
  ).run(id, input.name, input.parent_id || null, input.description || null);

  return getCategory(id)!;
}

export function getCategory(id: string): Category | null {
  const db = getDatabase();
  return db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as Category | null;
}

export interface ListCategoriesOptions {
  search?: string;
  parent_id?: string | null;
  limit?: number;
  offset?: number;
}

export function listCategories(options: ListCategoriesOptions = {}): Category[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    conditions.push("(name LIKE ? OR description LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q);
  }

  if (options.parent_id !== undefined) {
    if (options.parent_id === null) {
      conditions.push("parent_id IS NULL");
    } else {
      conditions.push("parent_id = ?");
      params.push(options.parent_id);
    }
  }

  let sql = "SELECT * FROM categories";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY name";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  return db.prepare(sql).all(...params) as Category[];
}

export interface UpdateCategoryInput {
  name?: string;
  parent_id?: string | null;
  description?: string;
}

export function updateCategory(
  id: string,
  input: UpdateCategoryInput
): Category | null {
  const db = getDatabase();
  const existing = getCategory(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.parent_id !== undefined) {
    sets.push("parent_id = ?");
    params.push(input.parent_id);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }

  if (sets.length === 0) return existing;

  params.push(id);

  db.prepare(
    `UPDATE categories SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getCategory(id);
}

export function deleteCategory(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  return result.changes > 0;
}

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}

export function getCategoryTree(): CategoryTreeNode[] {
  const all = listCategories();
  const byId = new Map<string, CategoryTreeNode>();
  const roots: CategoryTreeNode[] = [];

  // Create nodes
  for (const cat of all) {
    byId.set(cat.id, { ...cat, children: [] });
  }

  // Build tree
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
