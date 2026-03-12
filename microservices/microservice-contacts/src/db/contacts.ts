/**
 * Contact CRUD operations
 */

import { getDatabase } from "./database.js";

export interface Contact {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_id: string | null;
  title: string | null;
  notes: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ContactRow {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_id: string | null;
  title: string | null;
  notes: string | null;
  tags: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToContact(row: ContactRow): Contact {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreateContactInput {
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company_id?: string;
  title?: string;
  notes?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function createContact(input: CreateContactInput): Contact {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const tags = JSON.stringify(input.tags || []);
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO contacts (id, first_name, last_name, email, phone, company_id, title, notes, tags, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.first_name,
    input.last_name || null,
    input.email || null,
    input.phone || null,
    input.company_id || null,
    input.title || null,
    input.notes || null,
    tags,
    metadata
  );

  // Insert tags into junction table
  if (input.tags?.length) {
    const insertTag = db.prepare(
      "INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)"
    );
    for (const tag of input.tags) {
      insertTag.run(id, tag);
    }
  }

  return getContact(id)!;
}

export function getContact(id: string): Contact | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as ContactRow | null;
  return row ? rowToContact(row) : null;
}

export interface ListContactsOptions {
  search?: string;
  tag?: string;
  company_id?: string;
  limit?: number;
  offset?: number;
}

export function listContacts(options: ListContactsOptions = {}): Contact[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    conditions.push(
      "(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ?)"
    );
    const q = `%${options.search}%`;
    params.push(q, q, q, q);
  }

  if (options.tag) {
    conditions.push(
      "id IN (SELECT contact_id FROM contact_tags WHERE tag = ?)"
    );
    params.push(options.tag);
  }

  if (options.company_id) {
    conditions.push("company_id = ?");
    params.push(options.company_id);
  }

  let sql = "SELECT * FROM contacts";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY last_name, first_name";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as ContactRow[];
  return rows.map(rowToContact);
}

export interface UpdateContactInput {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company_id?: string | null;
  title?: string;
  notes?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function updateContact(
  id: string,
  input: UpdateContactInput
): Contact | null {
  const db = getDatabase();
  const existing = getContact(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.first_name !== undefined) {
    sets.push("first_name = ?");
    params.push(input.first_name);
  }
  if (input.last_name !== undefined) {
    sets.push("last_name = ?");
    params.push(input.last_name);
  }
  if (input.email !== undefined) {
    sets.push("email = ?");
    params.push(input.email);
  }
  if (input.phone !== undefined) {
    sets.push("phone = ?");
    params.push(input.phone);
  }
  if (input.company_id !== undefined) {
    sets.push("company_id = ?");
    params.push(input.company_id);
  }
  if (input.title !== undefined) {
    sets.push("title = ?");
    params.push(input.title);
  }
  if (input.notes !== undefined) {
    sets.push("notes = ?");
    params.push(input.notes);
  }
  if (input.tags !== undefined) {
    sets.push("tags = ?");
    params.push(JSON.stringify(input.tags));

    // Update junction table
    db.prepare("DELETE FROM contact_tags WHERE contact_id = ?").run(id);
    const insertTag = db.prepare(
      "INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)"
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
    `UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getContact(id);
}

export function deleteContact(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
  return result.changes > 0;
}

export function countContacts(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM contacts").get() as { count: number };
  return row.count;
}

export function searchContacts(query: string): Contact[] {
  return listContacts({ search: query });
}

export function getContactsByTag(tag: string): Contact[] {
  return listContacts({ tag });
}
