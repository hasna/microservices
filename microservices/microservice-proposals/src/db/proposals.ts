/**
 * Proposal CRUD operations and business logic
 */

import { getDatabase } from "./database.js";

// --- Types ---

export type ProposalStatus = "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired";

export interface ProposalItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export interface Proposal {
  id: string;
  title: string;
  client_name: string;
  client_email: string | null;
  status: ProposalStatus;
  items: ProposalItem[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  discount: number;
  total: number;
  currency: string;
  valid_until: string | null;
  notes: string | null;
  terms: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  responded_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ProposalRow {
  id: string;
  title: string;
  client_name: string;
  client_email: string | null;
  status: ProposalStatus;
  items: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  discount: number;
  total: number;
  currency: string;
  valid_until: string | null;
  notes: string | null;
  terms: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  responded_at: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToProposal(row: ProposalRow): Proposal {
  return {
    ...row,
    items: JSON.parse(row.items || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

function calculateTotals(items: ProposalItem[], taxRate: number, discount: number) {
  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = (subtotal - discount) * (taxRate / 100);
  const total = subtotal - discount + taxAmount;
  return { subtotal, tax_amount: taxAmount, total };
}

// --- Proposal Templates ---

export interface ProposalTemplate {
  id: string;
  name: string;
  items: ProposalItem[];
  terms: string | null;
  notes: string | null;
  created_at: string;
}

interface ProposalTemplateRow {
  id: string;
  name: string;
  items: string;
  terms: string | null;
  notes: string | null;
  created_at: string;
}

function rowToTemplate(row: ProposalTemplateRow): ProposalTemplate {
  return {
    ...row,
    items: JSON.parse(row.items || "[]"),
  };
}

export interface CreateTemplateInput {
  name: string;
  items?: ProposalItem[];
  terms?: string;
  notes?: string;
}

export function createTemplate(input: CreateTemplateInput): ProposalTemplate {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO proposal_templates (id, name, items, terms, notes)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    JSON.stringify(input.items || []),
    input.terms || null,
    input.notes || null
  );

  return getTemplate(id)!;
}

export function getTemplate(id: string): ProposalTemplate | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM proposal_templates WHERE id = ?").get(id) as ProposalTemplateRow | null;
  return row ? rowToTemplate(row) : null;
}

export function listTemplates(): ProposalTemplate[] {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM proposal_templates ORDER BY name").all() as ProposalTemplateRow[];
  return rows.map(rowToTemplate);
}

export function deleteTemplate(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM proposal_templates WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Proposal CRUD ---

export interface CreateProposalInput {
  title: string;
  client_name: string;
  client_email?: string;
  items?: ProposalItem[];
  tax_rate?: number;
  discount?: number;
  currency?: string;
  valid_until?: string;
  notes?: string;
  terms?: string;
  metadata?: Record<string, unknown>;
}

export function createProposal(input: CreateProposalInput): Proposal {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const items = input.items || [];
  const taxRate = input.tax_rate || 0;
  const discount = input.discount || 0;
  const { subtotal, tax_amount, total } = calculateTotals(items, taxRate, discount);
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO proposals (id, title, client_name, client_email, items, subtotal, tax_rate, tax_amount, discount, total, currency, valid_until, notes, terms, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.title,
    input.client_name,
    input.client_email || null,
    JSON.stringify(items),
    subtotal,
    taxRate,
    tax_amount,
    discount,
    total,
    input.currency || "USD",
    input.valid_until || null,
    input.notes || null,
    input.terms || null,
    metadata
  );

  return getProposal(id)!;
}

export function getProposal(id: string): Proposal | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM proposals WHERE id = ?").get(id) as ProposalRow | null;
  return row ? rowToProposal(row) : null;
}

export interface ListProposalsOptions {
  status?: ProposalStatus;
  client_name?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listProposals(options: ListProposalsOptions = {}): Proposal[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.client_name) {
    conditions.push("client_name = ?");
    params.push(options.client_name);
  }

  if (options.search) {
    conditions.push(
      "(title LIKE ? OR client_name LIKE ? OR client_email LIKE ? OR notes LIKE ?)"
    );
    const q = `%${options.search}%`;
    params.push(q, q, q, q);
  }

  let sql = "SELECT * FROM proposals";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as ProposalRow[];
  return rows.map(rowToProposal);
}

export interface UpdateProposalInput {
  title?: string;
  client_name?: string;
  client_email?: string;
  items?: ProposalItem[];
  tax_rate?: number;
  discount?: number;
  currency?: string;
  valid_until?: string;
  notes?: string;
  terms?: string;
  metadata?: Record<string, unknown>;
}

export function updateProposal(
  id: string,
  input: UpdateProposalInput
): Proposal | null {
  const db = getDatabase();
  const existing = getProposal(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.title !== undefined) {
    sets.push("title = ?");
    params.push(input.title);
  }
  if (input.client_name !== undefined) {
    sets.push("client_name = ?");
    params.push(input.client_name);
  }
  if (input.client_email !== undefined) {
    sets.push("client_email = ?");
    params.push(input.client_email);
  }
  if (input.currency !== undefined) {
    sets.push("currency = ?");
    params.push(input.currency);
  }
  if (input.valid_until !== undefined) {
    sets.push("valid_until = ?");
    params.push(input.valid_until);
  }
  if (input.notes !== undefined) {
    sets.push("notes = ?");
    params.push(input.notes);
  }
  if (input.terms !== undefined) {
    sets.push("terms = ?");
    params.push(input.terms);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  // Recalculate totals if items, tax_rate, or discount changed
  const items = input.items !== undefined ? input.items : existing.items;
  const taxRate = input.tax_rate !== undefined ? input.tax_rate : existing.tax_rate;
  const discount = input.discount !== undefined ? input.discount : existing.discount;

  if (input.items !== undefined || input.tax_rate !== undefined || input.discount !== undefined) {
    const { subtotal, tax_amount, total } = calculateTotals(items, taxRate, discount);
    sets.push("items = ?");
    params.push(JSON.stringify(items));
    sets.push("subtotal = ?");
    params.push(subtotal);
    sets.push("tax_rate = ?");
    params.push(taxRate);
    sets.push("tax_amount = ?");
    params.push(tax_amount);
    sets.push("discount = ?");
    params.push(discount);
    sets.push("total = ?");
    params.push(total);
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE proposals SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getProposal(id);
}

export function deleteProposal(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM proposals WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Business Logic ---

export function sendProposal(id: string): Proposal | null {
  const db = getDatabase();
  const existing = getProposal(id);
  if (!existing) return null;

  db.prepare(
    `UPDATE proposals SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(id);

  return getProposal(id);
}

export function markViewed(id: string): Proposal | null {
  const db = getDatabase();
  const existing = getProposal(id);
  if (!existing) return null;

  db.prepare(
    `UPDATE proposals SET status = 'viewed', viewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(id);

  return getProposal(id);
}

export function acceptProposal(id: string): Proposal | null {
  const db = getDatabase();
  const existing = getProposal(id);
  if (!existing) return null;

  db.prepare(
    `UPDATE proposals SET status = 'accepted', responded_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(id);

  return getProposal(id);
}

export function declineProposal(id: string, reason?: string): Proposal | null {
  const db = getDatabase();
  const existing = getProposal(id);
  if (!existing) return null;

  const metadata = { ...existing.metadata, decline_reason: reason || null };

  db.prepare(
    `UPDATE proposals SET status = 'declined', responded_at = datetime('now'), metadata = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(metadata), id);

  return getProposal(id);
}

export interface InvoiceData {
  client_name: string;
  client_email: string | null;
  items: ProposalItem[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  discount: number;
  total: number;
  currency: string;
  notes: string | null;
  terms: string | null;
  proposal_id: string;
}

export function convertToInvoice(id: string): InvoiceData | null {
  const proposal = getProposal(id);
  if (!proposal) return null;

  return {
    client_name: proposal.client_name,
    client_email: proposal.client_email,
    items: proposal.items,
    subtotal: proposal.subtotal,
    tax_rate: proposal.tax_rate,
    tax_amount: proposal.tax_amount,
    discount: proposal.discount,
    total: proposal.total,
    currency: proposal.currency,
    notes: proposal.notes,
    terms: proposal.terms,
    proposal_id: proposal.id,
  };
}

export function listExpiring(days: number): Proposal[] {
  const db = getDatabase();
  const rows = db.prepare(
    `SELECT * FROM proposals
     WHERE status IN ('draft', 'sent', 'viewed')
       AND valid_until IS NOT NULL
       AND valid_until <= datetime('now', '+' || ? || ' days')
       AND valid_until >= datetime('now')
     ORDER BY valid_until ASC`
  ).all(days) as ProposalRow[];
  return rows.map(rowToProposal);
}

export interface ProposalStats {
  total: number;
  by_status: Record<ProposalStatus, number>;
  total_value: number;
  average_value: number;
  conversion_rate: number;
  accepted_value: number;
}

export function getProposalStats(): ProposalStats {
  const db = getDatabase();

  const totalRow = db.prepare("SELECT COUNT(*) as count FROM proposals").get() as { count: number };
  const total = totalRow.count;

  const statusRows = db.prepare(
    "SELECT status, COUNT(*) as count FROM proposals GROUP BY status"
  ).all() as { status: ProposalStatus; count: number }[];

  const byStatus: Record<ProposalStatus, number> = {
    draft: 0,
    sent: 0,
    viewed: 0,
    accepted: 0,
    declined: 0,
    expired: 0,
  };
  for (const row of statusRows) {
    byStatus[row.status] = row.count;
  }

  const valueRow = db.prepare(
    "SELECT COALESCE(SUM(total), 0) as total_value, COALESCE(AVG(total), 0) as avg_value FROM proposals"
  ).get() as { total_value: number; avg_value: number };

  const acceptedValueRow = db.prepare(
    "SELECT COALESCE(SUM(total), 0) as accepted_value FROM proposals WHERE status = 'accepted'"
  ).get() as { accepted_value: number };

  // Conversion rate: accepted / (accepted + declined)
  const decided = byStatus.accepted + byStatus.declined;
  const conversionRate = decided > 0 ? (byStatus.accepted / decided) * 100 : 0;

  return {
    total,
    by_status: byStatus,
    total_value: valueRow.total_value,
    average_value: valueRow.avg_value,
    conversion_rate: conversionRate,
    accepted_value: acceptedValueRow.accepted_value,
  };
}

export function searchProposals(query: string): Proposal[] {
  return listProposals({ search: query });
}

export function useTemplate(
  templateId: string,
  overrides: { title: string; client_name: string; client_email?: string; valid_until?: string }
): Proposal | null {
  const template = getTemplate(templateId);
  if (!template) return null;

  return createProposal({
    title: overrides.title,
    client_name: overrides.client_name,
    client_email: overrides.client_email,
    items: template.items,
    notes: template.notes || undefined,
    terms: template.terms || undefined,
    valid_until: overrides.valid_until,
  });
}

export function countProposals(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM proposals").get() as { count: number };
  return row.count;
}
