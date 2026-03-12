import { getDatabase } from "./database.js";

export interface Note {
  id: string;
  title: string;
  content: string;
  folder_id: string | null;
  pinned: boolean;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface NoteRow {
  id: string; title: string; content: string; folder_id: string | null;
  pinned: number; tags: string; metadata: string; created_at: string; updated_at: string;
}

function rowToNote(row: NoteRow): Note {
  return { ...row, pinned: row.pinned === 1, tags: JSON.parse(row.tags || "[]"), metadata: JSON.parse(row.metadata || "{}") };
}

export interface CreateNoteInput {
  title: string;
  content?: string;
  folder_id?: string;
  pinned?: boolean;
  tags?: string[];
}

export function createNote(input: CreateNoteInput): Note {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const tags = JSON.stringify(input.tags || []);
  db.prepare(
    `INSERT INTO notes (id, title, content, folder_id, pinned, tags) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.title, input.content || "", input.folder_id || null, input.pinned ? 1 : 0, tags);
  if (input.tags?.length) {
    const ins = db.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)");
    for (const tag of input.tags) ins.run(id, tag);
  }
  return getNote(id)!;
}

export function getNote(id: string): Note | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as NoteRow | null;
  return row ? rowToNote(row) : null;
}

export interface ListNotesOptions { search?: string; tag?: string; folder_id?: string; pinned?: boolean; limit?: number; }

export function listNotes(options: ListNotesOptions = {}): Note[] {
  const db = getDatabase();
  const conds: string[] = []; const params: unknown[] = [];
  if (options.search) { conds.push("(title LIKE ? OR content LIKE ?)"); const q = `%${options.search}%`; params.push(q, q); }
  if (options.tag) { conds.push("id IN (SELECT note_id FROM note_tags WHERE tag = ?)"); params.push(options.tag); }
  if (options.folder_id) { conds.push("folder_id = ?"); params.push(options.folder_id); }
  if (options.pinned !== undefined) { conds.push("pinned = ?"); params.push(options.pinned ? 1 : 0); }
  let sql = "SELECT * FROM notes";
  if (conds.length) sql += " WHERE " + conds.join(" AND ");
  sql += " ORDER BY pinned DESC, updated_at DESC";
  if (options.limit) { sql += " LIMIT ?"; params.push(options.limit); }
  return (db.prepare(sql).all(...params) as NoteRow[]).map(rowToNote);
}

export function updateNote(id: string, input: Partial<CreateNoteInput>): Note | null {
  const db = getDatabase();
  if (!getNote(id)) return null;
  const sets: string[] = []; const params: unknown[] = [];
  if (input.title !== undefined) { sets.push("title = ?"); params.push(input.title); }
  if (input.content !== undefined) { sets.push("content = ?"); params.push(input.content); }
  if (input.folder_id !== undefined) { sets.push("folder_id = ?"); params.push(input.folder_id); }
  if (input.pinned !== undefined) { sets.push("pinned = ?"); params.push(input.pinned ? 1 : 0); }
  if (input.tags !== undefined) {
    sets.push("tags = ?"); params.push(JSON.stringify(input.tags));
    db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(id);
    const ins = db.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)");
    for (const tag of input.tags) ins.run(id, tag);
  }
  if (sets.length === 0) return getNote(id);
  sets.push("updated_at = datetime('now')"); params.push(id);
  db.prepare(`UPDATE notes SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getNote(id);
}

export function deleteNote(id: string): boolean {
  return getDatabase().prepare("DELETE FROM notes WHERE id = ?").run(id).changes > 0;
}

export function countNotes(): number {
  return (getDatabase().prepare("SELECT COUNT(*) as count FROM notes").get() as { count: number }).count;
}

// Folders
export interface Folder { id: string; name: string; parent_id: string | null; created_at: string; updated_at: string; }

export function createFolder(name: string, parentId?: string): Folder {
  const db = getDatabase();
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO folders (id, name, parent_id) VALUES (?, ?, ?)").run(id, name, parentId || null);
  return db.prepare("SELECT * FROM folders WHERE id = ?").get(id) as Folder;
}

export function listFolders(parentId?: string): Folder[] {
  const db = getDatabase();
  if (parentId) return db.prepare("SELECT * FROM folders WHERE parent_id = ? ORDER BY name").all(parentId) as Folder[];
  return db.prepare("SELECT * FROM folders ORDER BY name").all() as Folder[];
}

export function deleteFolder(id: string): boolean {
  return getDatabase().prepare("DELETE FROM folders WHERE id = ?").run(id).changes > 0;
}
