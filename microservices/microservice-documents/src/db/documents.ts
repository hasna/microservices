/**
 * Document CRUD operations
 */

import { getDatabase } from "./database.js";

export interface Document {
  id: string;
  title: string;
  description: string | null;
  file_path: string | null;
  file_type: string | null;
  file_size: number | null;
  version: number;
  status: "draft" | "active" | "archived";
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version: number;
  file_path: string | null;
  notes: string | null;
  created_at: string;
}

interface DocumentRow {
  id: string;
  title: string;
  description: string | null;
  file_path: string | null;
  file_type: string | null;
  file_size: number | null;
  version: number;
  status: string;
  tags: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToDocument(row: DocumentRow): Document {
  return {
    ...row,
    status: row.status as Document["status"],
    tags: JSON.parse(row.tags || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreateDocumentInput {
  title: string;
  description?: string;
  file_path?: string;
  file_type?: string;
  file_size?: number;
  status?: "draft" | "active" | "archived";
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function createDocument(input: CreateDocumentInput): Document {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const tags = JSON.stringify(input.tags || []);
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO documents (id, title, description, file_path, file_type, file_size, status, tags, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.title,
    input.description || null,
    input.file_path || null,
    input.file_type || null,
    input.file_size || null,
    input.status || "draft",
    tags,
    metadata
  );

  // Insert tags into junction table
  if (input.tags?.length) {
    const insertTag = db.prepare(
      "INSERT OR IGNORE INTO document_tags (document_id, tag) VALUES (?, ?)"
    );
    for (const tag of input.tags) {
      insertTag.run(id, tag);
    }
  }

  return getDocument(id)!;
}

export function getDocument(id: string): Document | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | null;
  return row ? rowToDocument(row) : null;
}

export interface ListDocumentsOptions {
  search?: string;
  file_type?: string;
  status?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export function listDocuments(options: ListDocumentsOptions = {}): Document[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    conditions.push(
      "(title LIKE ? OR description LIKE ?)"
    );
    const q = `%${options.search}%`;
    params.push(q, q);
  }

  if (options.file_type) {
    conditions.push("file_type = ?");
    params.push(options.file_type);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.tag) {
    conditions.push(
      "id IN (SELECT document_id FROM document_tags WHERE tag = ?)"
    );
    params.push(options.tag);
  }

  let sql = "SELECT * FROM documents";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY updated_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as DocumentRow[];
  return rows.map(rowToDocument);
}

export interface UpdateDocumentInput {
  title?: string;
  description?: string;
  file_path?: string;
  file_type?: string;
  file_size?: number;
  status?: "draft" | "active" | "archived";
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function updateDocument(
  id: string,
  input: UpdateDocumentInput
): Document | null {
  const db = getDatabase();
  const existing = getDocument(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.title !== undefined) {
    sets.push("title = ?");
    params.push(input.title);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.file_path !== undefined) {
    sets.push("file_path = ?");
    params.push(input.file_path);
  }
  if (input.file_type !== undefined) {
    sets.push("file_type = ?");
    params.push(input.file_type);
  }
  if (input.file_size !== undefined) {
    sets.push("file_size = ?");
    params.push(input.file_size);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.tags !== undefined) {
    sets.push("tags = ?");
    params.push(JSON.stringify(input.tags));

    // Update junction table
    db.prepare("DELETE FROM document_tags WHERE document_id = ?").run(id);
    const insertTag = db.prepare(
      "INSERT OR IGNORE INTO document_tags (document_id, tag) VALUES (?, ?)"
    );
    for (const tag of input.tags) {
      insertTag.run(id, tag);
    }
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE documents SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getDocument(id);
}

export function deleteDocument(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  return result.changes > 0;
}

export function countDocuments(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM documents").get() as { count: number };
  return row.count;
}

export function searchDocuments(query: string): Document[] {
  return listDocuments({ search: query });
}

export function getDocumentsByTag(tag: string): Document[] {
  return listDocuments({ tag });
}

// --- Versions ---

export interface AddVersionInput {
  document_id: string;
  file_path?: string;
  notes?: string;
}

export function addVersion(input: AddVersionInput): DocumentVersion {
  const db = getDatabase();
  const id = crypto.randomUUID();

  // Get current version number and increment
  const doc = db
    .prepare("SELECT version FROM documents WHERE id = ?")
    .get(input.document_id) as { version: number } | null;

  if (!doc) {
    throw new Error(`Document '${input.document_id}' not found.`);
  }

  const newVersion = doc.version + 1;

  db.prepare(
    `INSERT INTO document_versions (id, document_id, version, file_path, notes)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    id,
    input.document_id,
    newVersion,
    input.file_path || null,
    input.notes || null
  );

  // Update document version number and file_path if provided
  const updateSets = ["version = ?", "updated_at = datetime('now')"];
  const updateParams: unknown[] = [newVersion];

  if (input.file_path) {
    updateSets.push("file_path = ?");
    updateParams.push(input.file_path);
  }

  updateParams.push(input.document_id);
  db.prepare(
    `UPDATE documents SET ${updateSets.join(", ")} WHERE id = ?`
  ).run(...updateParams);

  return db.prepare("SELECT * FROM document_versions WHERE id = ?").get(id) as DocumentVersion;
}

export function listVersions(documentId: string): DocumentVersion[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM document_versions WHERE document_id = ? ORDER BY version DESC")
    .all(documentId) as DocumentVersion[];
}
