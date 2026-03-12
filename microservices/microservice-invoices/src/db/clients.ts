/**
 * Client CRUD operations for invoicing
 */

import { getDatabase } from "./database.js";

export interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  tax_id: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ClientRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  tax_id: string | null;
  notes: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToClient(row: ClientRow): Client {
  return { ...row, metadata: JSON.parse(row.metadata || "{}") };
}

export interface CreateClientInput {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  tax_id?: string;
  notes?: string;
}

export function createClient(input: CreateClientInput): Client {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO clients (id, name, email, phone, address, tax_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.name, input.email || null, input.phone || null, input.address || null, input.tax_id || null, input.notes || null);

  return getClient(id)!;
}

export function getClient(id: string): Client | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM clients WHERE id = ?").get(id) as ClientRow | null;
  return row ? rowToClient(row) : null;
}

export function listClients(search?: string): Client[] {
  const db = getDatabase();
  if (search) {
    const q = `%${search}%`;
    const rows = db
      .prepare("SELECT * FROM clients WHERE name LIKE ? OR email LIKE ? ORDER BY name")
      .all(q, q) as ClientRow[];
    return rows.map(rowToClient);
  }
  return (db.prepare("SELECT * FROM clients ORDER BY name").all() as ClientRow[]).map(rowToClient);
}

export function updateClient(id: string, input: Partial<CreateClientInput>): Client | null {
  const db = getDatabase();
  const existing = getClient(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (sets.length === 0) return existing;
  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE clients SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getClient(id);
}

export function deleteClient(id: string): boolean {
  const db = getDatabase();
  return db.prepare("DELETE FROM clients WHERE id = ?").run(id).changes > 0;
}
