/**
 * Company CRUD operations — organizations, teams, members, customers, vendors
 */

import { getDatabase } from "./database.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  address: Record<string, unknown>;
  phone: string | null;
  email: string | null;
  website: string | null;
  industry: string | null;
  currency: string;
  fiscal_year_start: string;
  timezone: string;
  branding: Record<string, unknown>;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface OrgRow {
  id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  address: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  industry: string | null;
  currency: string;
  fiscal_year_start: string;
  timezone: string;
  branding: string;
  settings: string;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  org_id: string;
  name: string;
  parent_id: string | null;
  department: string | null;
  cost_center: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface TeamRow {
  id: string;
  org_id: string;
  name: string;
  parent_id: string | null;
  department: string | null;
  cost_center: string | null;
  metadata: string;
  created_at: string;
}

export interface Member {
  id: string;
  org_id: string;
  team_id: string | null;
  name: string;
  email: string | null;
  role: "owner" | "admin" | "manager" | "member" | "viewer";
  title: string | null;
  permissions: Record<string, unknown>;
  status: string;
  created_at: string;
}

interface MemberRow {
  id: string;
  org_id: string;
  team_id: string | null;
  name: string;
  email: string | null;
  role: string;
  title: string | null;
  permissions: string;
  status: string;
  created_at: string;
}

export interface Customer {
  id: string;
  org_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: Record<string, unknown>;
  source: string | null;
  source_ids: Record<string, unknown>;
  tags: string[];
  lifetime_value: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface CustomerRow {
  id: string;
  org_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string;
  source: string | null;
  source_ids: string;
  tags: string;
  lifetime_value: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface Vendor {
  id: string;
  org_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  category: "supplier" | "contractor" | "partner" | "agency" | null;
  payment_terms: string | null;
  address: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface VendorRow {
  id: string;
  org_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  category: string | null;
  payment_terms: string | null;
  address: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

// ─── Row converters ──────────────────────────────────────────────────────────

function rowToOrg(row: OrgRow): Organization {
  return {
    ...row,
    address: JSON.parse(row.address || "{}"),
    branding: JSON.parse(row.branding || "{}"),
    settings: JSON.parse(row.settings || "{}"),
  };
}

function rowToTeam(row: TeamRow): Team {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

function rowToMember(row: MemberRow): Member {
  return {
    ...row,
    role: row.role as Member["role"],
    permissions: JSON.parse(row.permissions || "{}"),
  };
}

function rowToCustomer(row: CustomerRow): Customer {
  return {
    ...row,
    address: JSON.parse(row.address || "{}"),
    source_ids: JSON.parse(row.source_ids || "{}"),
    tags: JSON.parse(row.tags || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

function rowToVendor(row: VendorRow): Vendor {
  return {
    ...row,
    category: row.category as Vendor["category"],
    address: JSON.parse(row.address || "{}"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

// ─── Organizations ───────────────────────────────────────────────────────────

export interface CreateOrgInput {
  name: string;
  legal_name?: string;
  tax_id?: string;
  address?: Record<string, unknown>;
  phone?: string;
  email?: string;
  website?: string;
  industry?: string;
  currency?: string;
  fiscal_year_start?: string;
  timezone?: string;
  branding?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export function createOrg(input: CreateOrgInput): Organization {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO organizations (id, name, legal_name, tax_id, address, phone, email, website, industry, currency, fiscal_year_start, timezone, branding, settings)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.legal_name || null,
    input.tax_id || null,
    JSON.stringify(input.address || {}),
    input.phone || null,
    input.email || null,
    input.website || null,
    input.industry || null,
    input.currency || "USD",
    input.fiscal_year_start || "01-01",
    input.timezone || "UTC",
    JSON.stringify(input.branding || {}),
    JSON.stringify(input.settings || {})
  );

  return getOrg(id)!;
}

export function getOrg(id: string): Organization | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM organizations WHERE id = ?").get(id) as OrgRow | null;
  return row ? rowToOrg(row) : null;
}

export interface UpdateOrgInput {
  name?: string;
  legal_name?: string;
  tax_id?: string;
  address?: Record<string, unknown>;
  phone?: string;
  email?: string;
  website?: string;
  industry?: string;
  currency?: string;
  fiscal_year_start?: string;
  timezone?: string;
  branding?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export function updateOrg(id: string, input: UpdateOrgInput): Organization | null {
  const db = getDatabase();
  const existing = getOrg(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.legal_name !== undefined) { sets.push("legal_name = ?"); params.push(input.legal_name); }
  if (input.tax_id !== undefined) { sets.push("tax_id = ?"); params.push(input.tax_id); }
  if (input.address !== undefined) { sets.push("address = ?"); params.push(JSON.stringify(input.address)); }
  if (input.phone !== undefined) { sets.push("phone = ?"); params.push(input.phone); }
  if (input.email !== undefined) { sets.push("email = ?"); params.push(input.email); }
  if (input.website !== undefined) { sets.push("website = ?"); params.push(input.website); }
  if (input.industry !== undefined) { sets.push("industry = ?"); params.push(input.industry); }
  if (input.currency !== undefined) { sets.push("currency = ?"); params.push(input.currency); }
  if (input.fiscal_year_start !== undefined) { sets.push("fiscal_year_start = ?"); params.push(input.fiscal_year_start); }
  if (input.timezone !== undefined) { sets.push("timezone = ?"); params.push(input.timezone); }
  if (input.branding !== undefined) { sets.push("branding = ?"); params.push(JSON.stringify(input.branding)); }
  if (input.settings !== undefined) { sets.push("settings = ?"); params.push(JSON.stringify(input.settings)); }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE organizations SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getOrg(id);
}

// ─── Teams ───────────────────────────────────────────────────────────────────

export interface CreateTeamInput {
  org_id: string;
  name: string;
  parent_id?: string;
  department?: string;
  cost_center?: string;
  metadata?: Record<string, unknown>;
}

export function createTeam(input: CreateTeamInput): Team {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO teams (id, org_id, name, parent_id, department, cost_center, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.org_id,
    input.name,
    input.parent_id || null,
    input.department || null,
    input.cost_center || null,
    JSON.stringify(input.metadata || {})
  );

  return getTeam(id)!;
}

export function getTeam(id: string): Team | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM teams WHERE id = ?").get(id) as TeamRow | null;
  return row ? rowToTeam(row) : null;
}

export interface ListTeamsOptions {
  org_id?: string;
  department?: string;
  parent_id?: string | null;
  limit?: number;
  offset?: number;
}

export function listTeams(options: ListTeamsOptions = {}): Team[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.org_id) { conditions.push("org_id = ?"); params.push(options.org_id); }
  if (options.department) { conditions.push("department = ?"); params.push(options.department); }
  if (options.parent_id !== undefined) {
    if (options.parent_id === null) {
      conditions.push("parent_id IS NULL");
    } else {
      conditions.push("parent_id = ?");
      params.push(options.parent_id);
    }
  }

  let sql = "SELECT * FROM teams";
  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY name";

  if (options.limit) { sql += " LIMIT ?"; params.push(options.limit); }
  if (options.offset) { sql += " OFFSET ?"; params.push(options.offset); }

  const rows = db.prepare(sql).all(...params) as TeamRow[];
  return rows.map(rowToTeam);
}

export interface UpdateTeamInput {
  name?: string;
  parent_id?: string | null;
  department?: string;
  cost_center?: string;
  metadata?: Record<string, unknown>;
}

export function updateTeam(id: string, input: UpdateTeamInput): Team | null {
  const db = getDatabase();
  const existing = getTeam(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.parent_id !== undefined) { sets.push("parent_id = ?"); params.push(input.parent_id); }
  if (input.department !== undefined) { sets.push("department = ?"); params.push(input.department); }
  if (input.cost_center !== undefined) { sets.push("cost_center = ?"); params.push(input.cost_center); }
  if (input.metadata !== undefined) { sets.push("metadata = ?"); params.push(JSON.stringify(input.metadata)); }

  if (sets.length === 0) return existing;

  params.push(id);
  db.prepare(`UPDATE teams SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getTeam(id);
}

export function deleteTeam(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM teams WHERE id = ?").run(id);
  return result.changes > 0;
}

export interface TeamTreeNode extends Team {
  children: TeamTreeNode[];
}

export function getTeamTree(orgId: string): TeamTreeNode[] {
  const allTeams = listTeams({ org_id: orgId });
  const map = new Map<string, TeamTreeNode>();

  // Create nodes
  for (const team of allTeams) {
    map.set(team.id, { ...team, children: [] });
  }

  // Build tree
  const roots: TeamTreeNode[] = [];
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function getTeamMembers(teamId: string): Member[] {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM members WHERE team_id = ? ORDER BY name").all(teamId) as MemberRow[];
  return rows.map(rowToMember);
}

// ─── Members ─────────────────────────────────────────────────────────────────

export interface AddMemberInput {
  org_id: string;
  team_id?: string;
  name: string;
  email?: string;
  role?: "owner" | "admin" | "manager" | "member" | "viewer";
  title?: string;
  permissions?: Record<string, unknown>;
  status?: string;
}

export function addMember(input: AddMemberInput): Member {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO members (id, org_id, team_id, name, email, role, title, permissions, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.org_id,
    input.team_id || null,
    input.name,
    input.email || null,
    input.role || "member",
    input.title || null,
    JSON.stringify(input.permissions || {}),
    input.status || "active"
  );

  return getMember(id)!;
}

export function getMember(id: string): Member | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM members WHERE id = ?").get(id) as MemberRow | null;
  return row ? rowToMember(row) : null;
}

export interface ListMembersOptions {
  org_id?: string;
  team_id?: string;
  role?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function listMembers(options: ListMembersOptions = {}): Member[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.org_id) { conditions.push("org_id = ?"); params.push(options.org_id); }
  if (options.team_id) { conditions.push("team_id = ?"); params.push(options.team_id); }
  if (options.role) { conditions.push("role = ?"); params.push(options.role); }
  if (options.status) { conditions.push("status = ?"); params.push(options.status); }

  let sql = "SELECT * FROM members";
  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY name";

  if (options.limit) { sql += " LIMIT ?"; params.push(options.limit); }
  if (options.offset) { sql += " OFFSET ?"; params.push(options.offset); }

  const rows = db.prepare(sql).all(...params) as MemberRow[];
  return rows.map(rowToMember);
}

export interface UpdateMemberInput {
  team_id?: string | null;
  name?: string;
  email?: string;
  role?: "owner" | "admin" | "manager" | "member" | "viewer";
  title?: string;
  permissions?: Record<string, unknown>;
  status?: string;
}

export function updateMember(id: string, input: UpdateMemberInput): Member | null {
  const db = getDatabase();
  const existing = getMember(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.team_id !== undefined) { sets.push("team_id = ?"); params.push(input.team_id); }
  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.email !== undefined) { sets.push("email = ?"); params.push(input.email); }
  if (input.role !== undefined) { sets.push("role = ?"); params.push(input.role); }
  if (input.title !== undefined) { sets.push("title = ?"); params.push(input.title); }
  if (input.permissions !== undefined) { sets.push("permissions = ?"); params.push(JSON.stringify(input.permissions)); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }

  if (sets.length === 0) return existing;

  params.push(id);
  db.prepare(`UPDATE members SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getMember(id);
}

export function removeMember(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM members WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getMembersByRole(orgId: string, role: string): Member[] {
  return listMembers({ org_id: orgId, role });
}

export function getMembersByTeam(teamId: string): Member[] {
  return listMembers({ team_id: teamId });
}

// ─── Customers ───────────────────────────────────────────────────────────────

export interface CreateCustomerInput {
  org_id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: Record<string, unknown>;
  source?: string;
  source_ids?: Record<string, unknown>;
  tags?: string[];
  lifetime_value?: number;
  metadata?: Record<string, unknown>;
}

export function createCustomer(input: CreateCustomerInput): Customer {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO customers (id, org_id, name, email, phone, company, address, source, source_ids, tags, lifetime_value, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.org_id,
    input.name,
    input.email || null,
    input.phone || null,
    input.company || null,
    JSON.stringify(input.address || {}),
    input.source || null,
    JSON.stringify(input.source_ids || {}),
    JSON.stringify(input.tags || []),
    input.lifetime_value ?? 0,
    JSON.stringify(input.metadata || {})
  );

  return getCustomer(id)!;
}

export function getCustomer(id: string): Customer | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as CustomerRow | null;
  return row ? rowToCustomer(row) : null;
}

export interface ListCustomersOptions {
  org_id?: string;
  search?: string;
  source?: string;
  limit?: number;
  offset?: number;
}

export function listCustomers(options: ListCustomersOptions = {}): Customer[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.org_id) { conditions.push("org_id = ?"); params.push(options.org_id); }
  if (options.search) {
    conditions.push("(name LIKE ? OR email LIKE ? OR phone LIKE ? OR company LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q, q);
  }
  if (options.source) { conditions.push("source = ?"); params.push(options.source); }

  let sql = "SELECT * FROM customers";
  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY name";

  if (options.limit) { sql += " LIMIT ?"; params.push(options.limit); }
  if (options.offset) { sql += " OFFSET ?"; params.push(options.offset); }

  const rows = db.prepare(sql).all(...params) as CustomerRow[];
  return rows.map(rowToCustomer);
}

export interface UpdateCustomerInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: Record<string, unknown>;
  source?: string;
  source_ids?: Record<string, unknown>;
  tags?: string[];
  lifetime_value?: number;
  metadata?: Record<string, unknown>;
}

export function updateCustomer(id: string, input: UpdateCustomerInput): Customer | null {
  const db = getDatabase();
  const existing = getCustomer(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.email !== undefined) { sets.push("email = ?"); params.push(input.email); }
  if (input.phone !== undefined) { sets.push("phone = ?"); params.push(input.phone); }
  if (input.company !== undefined) { sets.push("company = ?"); params.push(input.company); }
  if (input.address !== undefined) { sets.push("address = ?"); params.push(JSON.stringify(input.address)); }
  if (input.source !== undefined) { sets.push("source = ?"); params.push(input.source); }
  if (input.source_ids !== undefined) { sets.push("source_ids = ?"); params.push(JSON.stringify(input.source_ids)); }
  if (input.tags !== undefined) { sets.push("tags = ?"); params.push(JSON.stringify(input.tags)); }
  if (input.lifetime_value !== undefined) { sets.push("lifetime_value = ?"); params.push(input.lifetime_value); }
  if (input.metadata !== undefined) { sets.push("metadata = ?"); params.push(JSON.stringify(input.metadata)); }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE customers SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getCustomer(id);
}

export function deleteCustomer(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM customers WHERE id = ?").run(id);
  return result.changes > 0;
}

export function searchCustomers(orgId: string, query: string): Customer[] {
  return listCustomers({ org_id: orgId, search: query });
}

export function getCustomerByEmail(orgId: string, email: string): Customer | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM customers WHERE org_id = ? AND email = ?").get(orgId, email) as CustomerRow | null;
  return row ? rowToCustomer(row) : null;
}

export function mergeCustomers(id1: string, id2: string): Customer | null {
  const db = getDatabase();
  const primary = getCustomer(id1);
  const secondary = getCustomer(id2);
  if (!primary || !secondary) return null;

  // Merge: keep primary, fill blanks from secondary, combine tags and lifetime_value
  const mergedTags = [...new Set([...primary.tags, ...secondary.tags])];
  const mergedLifetimeValue = primary.lifetime_value + secondary.lifetime_value;
  const mergedSourceIds = { ...secondary.source_ids, ...primary.source_ids };
  const mergedMetadata = { ...secondary.metadata, ...primary.metadata, merged_from: id2 };

  updateCustomer(id1, {
    email: primary.email || secondary.email || undefined,
    phone: primary.phone || secondary.phone || undefined,
    company: primary.company || secondary.company || undefined,
    address: Object.keys(primary.address).length > 0 ? primary.address : secondary.address,
    source: primary.source || secondary.source || undefined,
    source_ids: mergedSourceIds,
    tags: mergedTags,
    lifetime_value: mergedLifetimeValue,
    metadata: mergedMetadata,
  });

  // Delete the secondary customer
  deleteCustomer(id2);

  return getCustomer(id1);
}

// ─── Vendors ─────────────────────────────────────────────────────────────────

export interface CreateVendorInput {
  org_id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  category?: "supplier" | "contractor" | "partner" | "agency";
  payment_terms?: string;
  address?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export function createVendor(input: CreateVendorInput): Vendor {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO vendors (id, org_id, name, email, phone, company, category, payment_terms, address, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.org_id,
    input.name,
    input.email || null,
    input.phone || null,
    input.company || null,
    input.category || null,
    input.payment_terms || null,
    JSON.stringify(input.address || {}),
    JSON.stringify(input.metadata || {})
  );

  return getVendor(id)!;
}

export function getVendor(id: string): Vendor | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM vendors WHERE id = ?").get(id) as VendorRow | null;
  return row ? rowToVendor(row) : null;
}

export interface ListVendorsOptions {
  org_id?: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listVendors(options: ListVendorsOptions = {}): Vendor[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.org_id) { conditions.push("org_id = ?"); params.push(options.org_id); }
  if (options.category) { conditions.push("category = ?"); params.push(options.category); }
  if (options.search) {
    conditions.push("(name LIKE ? OR email LIKE ? OR phone LIKE ? OR company LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q, q);
  }

  let sql = "SELECT * FROM vendors";
  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY name";

  if (options.limit) { sql += " LIMIT ?"; params.push(options.limit); }
  if (options.offset) { sql += " OFFSET ?"; params.push(options.offset); }

  const rows = db.prepare(sql).all(...params) as VendorRow[];
  return rows.map(rowToVendor);
}

export interface UpdateVendorInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  category?: "supplier" | "contractor" | "partner" | "agency";
  payment_terms?: string;
  address?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export function updateVendor(id: string, input: UpdateVendorInput): Vendor | null {
  const db = getDatabase();
  const existing = getVendor(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.email !== undefined) { sets.push("email = ?"); params.push(input.email); }
  if (input.phone !== undefined) { sets.push("phone = ?"); params.push(input.phone); }
  if (input.company !== undefined) { sets.push("company = ?"); params.push(input.company); }
  if (input.category !== undefined) { sets.push("category = ?"); params.push(input.category); }
  if (input.payment_terms !== undefined) { sets.push("payment_terms = ?"); params.push(input.payment_terms); }
  if (input.address !== undefined) { sets.push("address = ?"); params.push(JSON.stringify(input.address)); }
  if (input.metadata !== undefined) { sets.push("metadata = ?"); params.push(JSON.stringify(input.metadata)); }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE vendors SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getVendor(id);
}

export function deleteVendor(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM vendors WHERE id = ?").run(id);
  return result.changes > 0;
}

export function searchVendors(orgId: string, query: string): Vendor[] {
  return listVendors({ org_id: orgId, search: query });
}

export function getVendorsByCategory(orgId: string, category: string): Vendor[] {
  return listVendors({ org_id: orgId, category });
}
