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
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  tax_id: string | null;
  vat_number: string | null;
  language: string | null;
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
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  tax_id?: string;
  vat_number?: string;
  language?: string;
  notes?: string;
}

export function createClient(input: CreateClientInput): Client {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO clients (id, name, email, phone, address, address_line1, address_line2, city, state, postal_code, country, tax_id, vat_number, language, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, input.name, input.email || null, input.phone || null,
    input.address || null,
    input.address_line1 || null, input.address_line2 || null,
    input.city || null, input.state || null, input.postal_code || null,
    input.country || null,
    input.tax_id || null, input.vat_number || null,
    input.language || null,
    input.notes || null
  );

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
