/**
 * Contact relationship operations
 */

import { getDatabase } from "./database.js";

export interface Relationship {
  id: string;
  contact_id: string;
  related_contact_id: string;
  type: string;
  notes: string | null;
  created_at: string;
}

export interface CreateRelationshipInput {
  contact_id: string;
  related_contact_id: string;
  type?: string;
  notes?: string;
}

export function createRelationship(input: CreateRelationshipInput): Relationship {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO relationships (id, contact_id, related_contact_id, type, notes)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.contact_id, input.related_contact_id, input.type || "knows", input.notes || null);

  return getRelationship(id)!;
}

export function getRelationship(id: string): Relationship | null {
  const db = getDatabase();
  return db.prepare("SELECT * FROM relationships WHERE id = ?").get(id) as Relationship | null;
}

export function getContactRelationships(contactId: string): Relationship[] {
  const db = getDatabase();
  return db
    .prepare(
      "SELECT * FROM relationships WHERE contact_id = ? OR related_contact_id = ? ORDER BY created_at"
    )
    .all(contactId, contactId) as Relationship[];
}

export function deleteRelationship(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM relationships WHERE id = ?").run(id);
  return result.changes > 0;
}
