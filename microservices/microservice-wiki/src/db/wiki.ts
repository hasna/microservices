/**
 * Wiki page CRUD and operations
 */

import { getDatabase } from "./database.js";

export interface Page {
  id: string;
  title: string;
  slug: string | null;
  content: string | null;
  format: string;
  category: string | null;
  parent_id: string | null;
  author: string | null;
  status: string;
  tags: string[];
  version: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface PageRow {
  id: string;
  title: string;
  slug: string | null;
  content: string | null;
  format: string;
  category: string | null;
  parent_id: string | null;
  author: string | null;
  status: string;
  tags: string;
  version: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToPage(row: PageRow): Page {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreatePageInput {
  title: string;
  slug?: string;
  content?: string;
  format?: string;
  category?: string;
  parent_id?: string;
  author?: string;
  status?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function createPage(input: CreatePageInput): Page {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const slug = input.slug || input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const tags = JSON.stringify(input.tags || []);
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO pages (id, title, slug, content, format, category, parent_id, author, status, tags, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.title,
    slug,
    input.content || null,
    input.format || "markdown",
    input.category || null,
    input.parent_id || null,
    input.author || null,
    input.status || "published",
    tags,
    metadata
  );

  return getPage(id)!;
}

export function getPage(id: string): Page | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM pages WHERE id = ?").get(id) as PageRow | null;
  return row ? rowToPage(row) : null;
}

export function getPageBySlug(slug: string): Page | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM pages WHERE slug = ?").get(slug) as PageRow | null;
  return row ? rowToPage(row) : null;
}

export interface UpdatePageInput {
  title?: string;
  slug?: string;
  content?: string;
  format?: string;
  category?: string;
  parent_id?: string | null;
  author?: string;
  status?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function updatePage(id: string, input: UpdatePageInput): Page | null {
  const db = getDatabase();
  const existing = getPage(id);
  if (!existing) return null;

  // Auto-save version before update
  db.prepare(
    `INSERT INTO page_versions (id, page_id, version, title, content, author)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    existing.id,
    existing.version,
    existing.title,
    existing.content,
    existing.author
  );

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.title !== undefined) {
    sets.push("title = ?");
    params.push(input.title);
  }
  if (input.slug !== undefined) {
    sets.push("slug = ?");
    params.push(input.slug);
  }
  if (input.content !== undefined) {
    sets.push("content = ?");
    params.push(input.content);
  }
  if (input.format !== undefined) {
    sets.push("format = ?");
    params.push(input.format);
  }
  if (input.category !== undefined) {
    sets.push("category = ?");
    params.push(input.category);
  }
  if (input.parent_id !== undefined) {
    sets.push("parent_id = ?");
    params.push(input.parent_id);
  }
  if (input.author !== undefined) {
    sets.push("author = ?");
    params.push(input.author);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.tags !== undefined) {
    sets.push("tags = ?");
    params.push(JSON.stringify(input.tags));
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  // Increment version
  sets.push("version = version + 1");
  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE pages SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getPage(id);
}

export function deletePage(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM pages WHERE id = ?").run(id);
  return result.changes > 0;
}

export interface ListPagesOptions {
  search?: string;
  category?: string;
  status?: string;
  parent_id?: string | null;
  tag?: string;
  limit?: number;
  offset?: number;
}

export function listPages(options: ListPagesOptions = {}): Page[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    conditions.push("(title LIKE ? OR content LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q);
  }

  if (options.category) {
    conditions.push("category = ?");
    params.push(options.category);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.parent_id !== undefined) {
    if (options.parent_id === null) {
      conditions.push("parent_id IS NULL");
    } else {
      conditions.push("parent_id = ?");
      params.push(options.parent_id);
    }
  }

  if (options.tag) {
    conditions.push("tags LIKE ?");
    params.push(`%"${options.tag}"%`);
  }

  let sql = "SELECT * FROM pages";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY title";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as PageRow[];
  return rows.map(rowToPage);
}

export function searchPages(query: string): Page[] {
  return listPages({ search: query });
}

export interface PageTreeNode extends Page {
  children: PageTreeNode[];
}

export function getPageTree(): PageTreeNode[] {
  const allPages = listPages();
  const map = new Map<string, PageTreeNode>();

  // Create nodes
  for (const page of allPages) {
    map.set(page.id, { ...page, children: [] });
  }

  // Build tree
  const roots: PageTreeNode[] = [];
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function getRecentlyUpdated(limit: number = 10): Page[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM pages ORDER BY updated_at DESC LIMIT ?")
    .all(limit) as PageRow[];
  return rows.map(rowToPage);
}

export function getByCategory(category: string): Page[] {
  return listPages({ category });
}

export function getByTag(tag: string): Page[] {
  return listPages({ tag });
}

// --- Version history ---

export interface PageVersion {
  id: string;
  page_id: string;
  version: number;
  title: string | null;
  content: string | null;
  author: string | null;
  changed_at: string;
}

export function getPageHistory(pageId: string): PageVersion[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM page_versions WHERE page_id = ? ORDER BY version DESC")
    .all(pageId) as PageVersion[];
  return rows;
}

export function revertToVersion(pageId: string, version: number): Page | null {
  const db = getDatabase();
  const existing = getPage(pageId);
  if (!existing) return null;

  const versionRow = db
    .prepare("SELECT * FROM page_versions WHERE page_id = ? AND version = ?")
    .get(pageId, version) as PageVersion | null;
  if (!versionRow) return null;

  // Save current state as a version before reverting
  db.prepare(
    `INSERT INTO page_versions (id, page_id, version, title, content, author)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    existing.id,
    existing.version,
    existing.title,
    existing.content,
    existing.author
  );

  // Revert to the target version's content
  db.prepare(
    `UPDATE pages SET title = ?, content = ?, author = ?, version = version + 1, updated_at = datetime('now') WHERE id = ?`
  ).run(
    versionRow.title || existing.title,
    versionRow.content,
    versionRow.author,
    pageId
  );

  return getPage(pageId);
}

// --- Links ---

export interface PageLink {
  source_id: string;
  target_id: string;
}

export function addLink(sourceId: string, targetId: string): PageLink {
  const db = getDatabase();
  db.prepare(
    "INSERT OR IGNORE INTO page_links (source_id, target_id) VALUES (?, ?)"
  ).run(sourceId, targetId);
  return { source_id: sourceId, target_id: targetId };
}

export function removeLink(sourceId: string, targetId: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare("DELETE FROM page_links WHERE source_id = ? AND target_id = ?")
    .run(sourceId, targetId);
  return result.changes > 0;
}

export function getLinksFrom(pageId: string): PageLink[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM page_links WHERE source_id = ?")
    .all(pageId) as PageLink[];
}

export function getLinksTo(pageId: string): PageLink[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM page_links WHERE target_id = ?")
    .all(pageId) as PageLink[];
}
