/**
 * Domain, DNS record, and alert CRUD operations
 */

import { getDatabase } from "./database.js";
import { execSync } from "node:child_process";

// --- Domain types ---

export interface Domain {
  id: string;
  name: string;
  registrar: string | null;
  status: "active" | "expired" | "transferring" | "redemption";
  registered_at: string | null;
  expires_at: string | null;
  auto_renew: boolean;
  nameservers: string[];
  whois: Record<string, unknown>;
  ssl_expires_at: string | null;
  ssl_issuer: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface DomainRow {
  id: string;
  name: string;
  registrar: string | null;
  status: string;
  registered_at: string | null;
  expires_at: string | null;
  auto_renew: number;
  nameservers: string;
  whois: string;
  ssl_expires_at: string | null;
  ssl_issuer: string | null;
  notes: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToDomain(row: DomainRow): Domain {
  return {
    ...row,
    status: row.status as Domain["status"],
    auto_renew: row.auto_renew === 1,
    nameservers: JSON.parse(row.nameservers || "[]"),
    whois: JSON.parse(row.whois || "{}"),
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

// --- DNS Record types ---

export interface DnsRecord {
  id: string;
  domain_id: string;
  type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SRV";
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  created_at: string;
}

interface DnsRecordRow {
  id: string;
  domain_id: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  created_at: string;
}

function rowToDnsRecord(row: DnsRecordRow): DnsRecord {
  return {
    ...row,
    type: row.type as DnsRecord["type"],
  };
}

// --- Alert types ---

export interface Alert {
  id: string;
  domain_id: string;
  type: "expiry" | "ssl_expiry" | "dns_change";
  trigger_days_before: number | null;
  sent_at: string | null;
  created_at: string;
}

interface AlertRow {
  id: string;
  domain_id: string;
  type: string;
  trigger_days_before: number | null;
  sent_at: string | null;
  created_at: string;
}

function rowToAlert(row: AlertRow): Alert {
  return {
    ...row,
    type: row.type as Alert["type"],
  };
}

// ============================================================
// Domain CRUD
// ============================================================

export interface CreateDomainInput {
  name: string;
  registrar?: string;
  status?: Domain["status"];
  registered_at?: string;
  expires_at?: string;
  auto_renew?: boolean;
  nameservers?: string[];
  whois?: Record<string, unknown>;
  ssl_expires_at?: string;
  ssl_issuer?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export function createDomain(input: CreateDomainInput): Domain {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const nameservers = JSON.stringify(input.nameservers || []);
  const whois = JSON.stringify(input.whois || {});
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO domains (id, name, registrar, status, registered_at, expires_at, auto_renew, nameservers, whois, ssl_expires_at, ssl_issuer, notes, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.registrar || null,
    input.status || "active",
    input.registered_at || null,
    input.expires_at || null,
    input.auto_renew !== undefined ? (input.auto_renew ? 1 : 0) : 1,
    nameservers,
    whois,
    input.ssl_expires_at || null,
    input.ssl_issuer || null,
    input.notes || null,
    metadata
  );

  return getDomain(id)!;
}

export function getDomain(id: string): Domain | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM domains WHERE id = ?").get(id) as DomainRow | null;
  return row ? rowToDomain(row) : null;
}

export interface ListDomainsOptions {
  search?: string;
  status?: Domain["status"];
  registrar?: string;
  limit?: number;
  offset?: number;
}

export function listDomains(options: ListDomainsOptions = {}): Domain[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    conditions.push("(name LIKE ? OR registrar LIKE ? OR notes LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.registrar) {
    conditions.push("registrar = ?");
    params.push(options.registrar);
  }

  let sql = "SELECT * FROM domains";
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

  const rows = db.prepare(sql).all(...params) as DomainRow[];
  return rows.map(rowToDomain);
}

export interface UpdateDomainInput {
  name?: string;
  registrar?: string;
  status?: Domain["status"];
  registered_at?: string;
  expires_at?: string;
  auto_renew?: boolean;
  nameservers?: string[];
  whois?: Record<string, unknown>;
  ssl_expires_at?: string;
  ssl_issuer?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export function updateDomain(id: string, input: UpdateDomainInput): Domain | null {
  const db = getDatabase();
  const existing = getDomain(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.registrar !== undefined) {
    sets.push("registrar = ?");
    params.push(input.registrar);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.registered_at !== undefined) {
    sets.push("registered_at = ?");
    params.push(input.registered_at);
  }
  if (input.expires_at !== undefined) {
    sets.push("expires_at = ?");
    params.push(input.expires_at);
  }
  if (input.auto_renew !== undefined) {
    sets.push("auto_renew = ?");
    params.push(input.auto_renew ? 1 : 0);
  }
  if (input.nameservers !== undefined) {
    sets.push("nameservers = ?");
    params.push(JSON.stringify(input.nameservers));
  }
  if (input.whois !== undefined) {
    sets.push("whois = ?");
    params.push(JSON.stringify(input.whois));
  }
  if (input.ssl_expires_at !== undefined) {
    sets.push("ssl_expires_at = ?");
    params.push(input.ssl_expires_at);
  }
  if (input.ssl_issuer !== undefined) {
    sets.push("ssl_issuer = ?");
    params.push(input.ssl_issuer);
  }
  if (input.notes !== undefined) {
    sets.push("notes = ?");
    params.push(input.notes);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE domains SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getDomain(id);
}

export function deleteDomain(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM domains WHERE id = ?").run(id);
  return result.changes > 0;
}

export function countDomains(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM domains").get() as { count: number };
  return row.count;
}

export function searchDomains(query: string): Domain[] {
  return listDomains({ search: query });
}

export function getByRegistrar(registrar: string): Domain[] {
  return listDomains({ registrar });
}

export function listExpiring(days: number): Domain[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM domains
       WHERE expires_at IS NOT NULL
         AND expires_at <= datetime('now', '+' || ? || ' days')
         AND expires_at >= datetime('now')
         AND status = 'active'
       ORDER BY expires_at`
    )
    .all(days) as DomainRow[];
  return rows.map(rowToDomain);
}

export function listSslExpiring(days: number): Domain[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM domains
       WHERE ssl_expires_at IS NOT NULL
         AND ssl_expires_at <= datetime('now', '+' || ? || ' days')
         AND ssl_expires_at >= datetime('now')
       ORDER BY ssl_expires_at`
    )
    .all(days) as DomainRow[];
  return rows.map(rowToDomain);
}

export interface DomainStats {
  total: number;
  active: number;
  expired: number;
  transferring: number;
  redemption: number;
  auto_renew_enabled: number;
  expiring_30_days: number;
  ssl_expiring_30_days: number;
}

export function getDomainStats(): DomainStats {
  const db = getDatabase();

  const total = (
    db.prepare("SELECT COUNT(*) as count FROM domains").get() as { count: number }
  ).count;

  const active = (
    db.prepare("SELECT COUNT(*) as count FROM domains WHERE status = 'active'").get() as { count: number }
  ).count;

  const expired = (
    db.prepare("SELECT COUNT(*) as count FROM domains WHERE status = 'expired'").get() as { count: number }
  ).count;

  const transferring = (
    db.prepare("SELECT COUNT(*) as count FROM domains WHERE status = 'transferring'").get() as { count: number }
  ).count;

  const redemption = (
    db.prepare("SELECT COUNT(*) as count FROM domains WHERE status = 'redemption'").get() as { count: number }
  ).count;

  const auto_renew_enabled = (
    db.prepare("SELECT COUNT(*) as count FROM domains WHERE auto_renew = 1").get() as { count: number }
  ).count;

  const expiring_30_days = listExpiring(30).length;
  const ssl_expiring_30_days = listSslExpiring(30).length;

  return {
    total,
    active,
    expired,
    transferring,
    redemption,
    auto_renew_enabled,
    expiring_30_days,
    ssl_expiring_30_days,
  };
}

// ============================================================
// DNS Record CRUD
// ============================================================

export interface CreateDnsRecordInput {
  domain_id: string;
  type: DnsRecord["type"];
  name: string;
  value: string;
  ttl?: number;
  priority?: number;
}

export function createDnsRecord(input: CreateDnsRecordInput): DnsRecord {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO dns_records (id, domain_id, type, name, value, ttl, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.domain_id,
    input.type,
    input.name,
    input.value,
    input.ttl ?? 3600,
    input.priority ?? null
  );

  return getDnsRecord(id)!;
}

export function getDnsRecord(id: string): DnsRecord | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM dns_records WHERE id = ?").get(id) as DnsRecordRow | null;
  return row ? rowToDnsRecord(row) : null;
}

export function listDnsRecords(domainId: string, type?: DnsRecord["type"]): DnsRecord[] {
  const db = getDatabase();
  let sql = "SELECT * FROM dns_records WHERE domain_id = ?";
  const params: unknown[] = [domainId];

  if (type) {
    sql += " AND type = ?";
    params.push(type);
  }

  sql += " ORDER BY type, name";

  const rows = db.prepare(sql).all(...params) as DnsRecordRow[];
  return rows.map(rowToDnsRecord);
}

export interface UpdateDnsRecordInput {
  type?: DnsRecord["type"];
  name?: string;
  value?: string;
  ttl?: number;
  priority?: number;
}

export function updateDnsRecord(id: string, input: UpdateDnsRecordInput): DnsRecord | null {
  const db = getDatabase();
  const existing = getDnsRecord(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.type !== undefined) {
    sets.push("type = ?");
    params.push(input.type);
  }
  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.value !== undefined) {
    sets.push("value = ?");
    params.push(input.value);
  }
  if (input.ttl !== undefined) {
    sets.push("ttl = ?");
    params.push(input.ttl);
  }
  if (input.priority !== undefined) {
    sets.push("priority = ?");
    params.push(input.priority);
  }

  if (sets.length === 0) return existing;

  params.push(id);

  db.prepare(
    `UPDATE dns_records SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getDnsRecord(id);
}

export function deleteDnsRecord(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM dns_records WHERE id = ?").run(id);
  return result.changes > 0;
}

// ============================================================
// Alert CRUD
// ============================================================

export interface CreateAlertInput {
  domain_id: string;
  type: Alert["type"];
  trigger_days_before?: number;
}

export function createAlert(input: CreateAlertInput): Alert {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO alerts (id, domain_id, type, trigger_days_before)
     VALUES (?, ?, ?, ?)`
  ).run(id, input.domain_id, input.type, input.trigger_days_before ?? null);

  return getAlert(id)!;
}

export function getAlert(id: string): Alert | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM alerts WHERE id = ?").get(id) as AlertRow | null;
  return row ? rowToAlert(row) : null;
}

export function listAlerts(domainId: string): Alert[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM alerts WHERE domain_id = ? ORDER BY type, trigger_days_before")
    .all(domainId) as AlertRow[];
  return rows.map(rowToAlert);
}

export function deleteAlert(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM alerts WHERE id = ?").run(id);
  return result.changes > 0;
}

// ============================================================
// WHOIS Lookup
// ============================================================

export interface WhoisResult {
  domain: string;
  registrar: string | null;
  expires_at: string | null;
  nameservers: string[];
  raw: string;
}

export function whoisLookup(domainName: string): WhoisResult {
  let raw: string;
  try {
    raw = execSync(`whois ${domainName}`, { timeout: 15000, encoding: "utf-8" });
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string };
    raw = err.stdout || err.stderr || "";
    if (!raw) throw new Error(`whois command failed for ${domainName}`);
  }

  const registrarMatch = raw.match(/Registrar:\s*(.+)/i) || raw.match(/registrar:\s*(.+)/i);
  const registrar = registrarMatch ? registrarMatch[1].trim() : null;

  const expiresMatch =
    raw.match(/Registry Expiry Date:\s*(.+)/i) ||
    raw.match(/Expir(?:y|ation) Date:\s*(.+)/i) ||
    raw.match(/paid-till:\s*(.+)/i);
  let expires_at: string | null = null;
  if (expiresMatch) {
    try {
      expires_at = new Date(expiresMatch[1].trim()).toISOString();
    } catch {
      expires_at = expiresMatch[1].trim();
    }
  }

  const nsMatches = raw.matchAll(/Name Server:\s*(.+)/gi);
  const nameservers: string[] = [];
  for (const m of nsMatches) {
    const ns = m[1].trim().toLowerCase();
    if (ns && !nameservers.includes(ns)) nameservers.push(ns);
  }

  // Update the DB record if a domain with this name exists
  const db = getDatabase();
  const row = db.prepare("SELECT id FROM domains WHERE name = ?").get(domainName) as { id: string } | null;
  if (row) {
    const updates: UpdateDomainInput = { whois: { raw } };
    if (registrar) updates.registrar = registrar;
    if (expires_at) updates.expires_at = expires_at;
    if (nameservers.length > 0) updates.nameservers = nameservers;
    updateDomain(row.id, updates);
  }

  return { domain: domainName, registrar, expires_at, nameservers, raw };
}

// ============================================================
// DNS Propagation Check
// ============================================================

const DNS_SERVERS = ["8.8.8.8", "1.1.1.1", "9.9.9.9", "208.67.222.222"];
const DNS_SERVER_NAMES: Record<string, string> = {
  "8.8.8.8": "Google",
  "1.1.1.1": "Cloudflare",
  "9.9.9.9": "Quad9",
  "208.67.222.222": "OpenDNS",
};

export interface DnsPropagationResult {
  domain: string;
  record_type: string;
  servers: {
    server: string;
    name: string;
    values: string[];
    status: "ok" | "error";
    error?: string;
  }[];
  consistent: boolean;
}

export function checkDnsPropagation(
  domain: string,
  recordType: string = "A"
): DnsPropagationResult {
  const servers: DnsPropagationResult["servers"] = [];

  for (const server of DNS_SERVERS) {
    try {
      const output = execSync(
        `dig @${server} ${domain} ${recordType} +short +time=5 +tries=1`,
        { timeout: 10000, encoding: "utf-8" }
      );
      const values = output
        .trim()
        .split("\n")
        .filter((l) => l.length > 0);
      servers.push({
        server,
        name: DNS_SERVER_NAMES[server] || server,
        values,
        status: "ok",
      });
    } catch (error: unknown) {
      servers.push({
        server,
        name: DNS_SERVER_NAMES[server] || server,
        values: [],
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Check consistency: all servers with "ok" should have the same sorted values
  const okServers = servers.filter((s) => s.status === "ok");
  const consistent =
    okServers.length > 0 &&
    okServers.every(
      (s) => JSON.stringify(s.values.sort()) === JSON.stringify(okServers[0].values.sort())
    );

  return { domain, record_type: recordType, servers, consistent };
}

// ============================================================
// SSL Certificate Check
// ============================================================

export interface SslCheckResult {
  domain: string;
  issuer: string | null;
  expires_at: string | null;
  subject: string | null;
  error?: string;
}

export function checkSsl(domainName: string): SslCheckResult {
  try {
    const output = execSync(
      `echo | openssl s_client -servername ${domainName} -connect ${domainName}:443 2>/dev/null | openssl x509 -noout -issuer -dates -subject 2>/dev/null`,
      { timeout: 15000, encoding: "utf-8" }
    );

    const issuerMatch = output.match(/issuer\s*=\s*(.+)/i);
    const notAfterMatch = output.match(/notAfter\s*=\s*(.+)/i);
    const subjectMatch = output.match(/subject\s*=\s*(.+)/i);

    const issuer = issuerMatch ? issuerMatch[1].trim() : null;
    const subject = subjectMatch ? subjectMatch[1].trim() : null;
    let expires_at: string | null = null;

    if (notAfterMatch) {
      try {
        expires_at = new Date(notAfterMatch[1].trim()).toISOString();
      } catch {
        expires_at = notAfterMatch[1].trim();
      }
    }

    // Update the DB record if exists
    const db = getDatabase();
    const row = db.prepare("SELECT id FROM domains WHERE name = ?").get(domainName) as { id: string } | null;
    if (row) {
      const updates: UpdateDomainInput = {};
      if (expires_at) updates.ssl_expires_at = expires_at;
      if (issuer) updates.ssl_issuer = issuer;
      updateDomain(row.id, updates);
    }

    return { domain: domainName, issuer, expires_at, subject };
  } catch (error: unknown) {
    return {
      domain: domainName,
      issuer: null,
      expires_at: null,
      subject: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================
// Zone File Export / Import
// ============================================================

export function exportZoneFile(domainId: string): string | null {
  const domain = getDomain(domainId);
  if (!domain) return null;

  const records = listDnsRecords(domainId);
  const lines: string[] = [];

  lines.push(`; Zone file for ${domain.name}`);
  lines.push(`; Exported at ${new Date().toISOString()}`);
  lines.push(`$ORIGIN ${domain.name}.`);
  lines.push(`$TTL 3600`);
  lines.push("");

  for (const r of records) {
    const name = r.name === "@" ? domain.name + "." : r.name;
    if (r.type === "MX" || r.type === "SRV") {
      const priority = r.priority ?? 10;
      lines.push(`${name}\t${r.ttl}\tIN\t${r.type}\t${priority}\t${r.value}`);
    } else {
      lines.push(`${name}\t${r.ttl}\tIN\t${r.type}\t${r.value}`);
    }
  }

  return lines.join("\n") + "\n";
}

export interface ZoneImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  records: DnsRecord[];
}

export function importZoneFile(domainId: string, content: string): ZoneImportResult | null {
  const domain = getDomain(domainId);
  if (!domain) return null;

  const result: ZoneImportResult = { imported: 0, skipped: 0, errors: [], records: [] };
  const lines = content.split("\n");
  const validTypes = new Set(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV"]);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("$")) {
      continue;
    }

    // Parse zone file line: name ttl class type [priority] value
    const parts = line.split(/\s+/);
    if (parts.length < 4) {
      result.errors.push(`Could not parse line: ${line}`);
      result.skipped++;
      continue;
    }

    let name = parts[0];
    let idx = 1;

    // Skip optional TTL (numeric)
    let ttl = 3600;
    if (/^\d+$/.test(parts[idx])) {
      ttl = parseInt(parts[idx]);
      idx++;
    }

    // Skip class (IN)
    if (parts[idx] && parts[idx].toUpperCase() === "IN") {
      idx++;
    }

    const type = parts[idx]?.toUpperCase();
    idx++;

    if (!type || !validTypes.has(type)) {
      result.errors.push(`Unknown record type '${type}' in: ${line}`);
      result.skipped++;
      continue;
    }

    let priority: number | undefined;
    if (type === "MX" || type === "SRV") {
      if (parts[idx] && /^\d+$/.test(parts[idx])) {
        priority = parseInt(parts[idx]);
        idx++;
      }
    }

    const value = parts.slice(idx).join(" ");
    if (!value) {
      result.errors.push(`Missing value in: ${line}`);
      result.skipped++;
      continue;
    }

    // Normalize name: remove trailing dot, replace domain name with @
    if (name.endsWith(".")) name = name.slice(0, -1);
    if (name === domain.name || name === "") name = "@";

    try {
      const record = createDnsRecord({
        domain_id: domainId,
        type: type as DnsRecord["type"],
        name,
        value,
        ttl,
        priority,
      });
      result.records.push(record);
      result.imported++;
    } catch (error: unknown) {
      result.errors.push(
        `Failed to create record: ${error instanceof Error ? error.message : String(error)}`
      );
      result.skipped++;
    }
  }

  return result;
}

// ============================================================
// Subdomain Discovery (crt.sh)
// ============================================================

export interface SubdomainResult {
  domain: string;
  subdomains: string[];
  source: string;
  error?: string;
}

export async function discoverSubdomains(domain: string): Promise<SubdomainResult> {
  try {
    const url = `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "microservice-domains/0.0.1" },
    });

    if (!response.ok) {
      return {
        domain,
        subdomains: [],
        source: "crt.sh",
        error: `crt.sh returned ${response.status}`,
      };
    }

    const data = (await response.json()) as { common_name?: string; name_value?: string }[];
    const subdomainSet = new Set<string>();

    for (const entry of data) {
      for (const field of [entry.common_name, entry.name_value]) {
        if (!field) continue;
        for (const name of field.split("\n")) {
          const cleaned = name.trim().toLowerCase().replace(/^\*\./, "");
          if (cleaned.endsWith(domain.toLowerCase()) && cleaned !== domain.toLowerCase()) {
            subdomainSet.add(cleaned);
          }
        }
      }
    }

    const subdomains = [...subdomainSet].sort();
    return { domain, subdomains, source: "crt.sh" };
  } catch (error: unknown) {
    return {
      domain,
      subdomains: [],
      source: "crt.sh",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================
// DNS Validation
// ============================================================

export interface DnsValidationIssue {
  type: "error" | "warning";
  record_id?: string;
  message: string;
}

export interface DnsValidationResult {
  domain_id: string;
  domain_name: string;
  issues: DnsValidationIssue[];
  valid: boolean;
}

export function validateDns(domainId: string): DnsValidationResult | null {
  const domain = getDomain(domainId);
  if (!domain) return null;

  const records = listDnsRecords(domainId);
  const issues: DnsValidationIssue[] = [];

  // Group records by name
  const byName = new Map<string, DnsRecord[]>();
  for (const r of records) {
    const key = r.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(r);
  }

  // Check: CNAME should not coexist with A or MX at the same name
  for (const [name, recs] of byName) {
    const hasCname = recs.some((r) => r.type === "CNAME");
    const hasA = recs.some((r) => r.type === "A" || r.type === "AAAA");
    const hasMx = recs.some((r) => r.type === "MX");
    const hasNs = recs.some((r) => r.type === "NS");

    if (hasCname && hasA) {
      issues.push({
        type: "error",
        message: `CNAME record at '${name}' conflicts with A/AAAA record — CNAME cannot coexist with other record types`,
      });
    }
    if (hasCname && hasMx) {
      issues.push({
        type: "error",
        message: `CNAME record at '${name}' conflicts with MX record — CNAME cannot coexist with other record types`,
      });
    }
    if (hasCname && hasNs) {
      issues.push({
        type: "error",
        message: `CNAME record at '${name}' conflicts with NS record — CNAME cannot coexist with other record types`,
      });
    }
    if (hasCname && recs.filter((r) => r.type === "CNAME").length > 1) {
      issues.push({
        type: "error",
        message: `Multiple CNAME records at '${name}' — only one CNAME is allowed per name`,
      });
    }
  }

  // Check: Missing MX records for root domain (warning)
  const rootRecords = byName.get("@") || [];
  const hasMxAtRoot = rootRecords.some((r) => r.type === "MX");
  if (!hasMxAtRoot && records.length > 0) {
    issues.push({
      type: "warning",
      message: `No MX record found at root (@) — email delivery may not work for ${domain.name}`,
    });
  }

  // Check: Orphan records — records pointing to names with no A/AAAA resolution
  for (const r of records) {
    if (r.type === "CNAME") {
      const target = r.value.toLowerCase().replace(/\.$/, "");
      // Check if target is within this domain and has no records
      if (target.endsWith(domain.name.toLowerCase())) {
        const targetName = target === domain.name.toLowerCase() ? "@" : target.replace(`.${domain.name.toLowerCase()}`, "");
        const targetRecords = byName.get(targetName.toLowerCase());
        if (!targetRecords || targetRecords.length === 0) {
          issues.push({
            type: "warning",
            record_id: r.id,
            message: `CNAME '${r.name}' points to '${r.value}' which has no records in this zone`,
          });
        }
      }
    }
  }

  // Check: MX records should have priority
  for (const r of records) {
    if (r.type === "MX" && r.priority === null) {
      issues.push({
        type: "warning",
        record_id: r.id,
        message: `MX record '${r.name}' -> '${r.value}' has no priority set`,
      });
    }
  }

  return {
    domain_id: domainId,
    domain_name: domain.name,
    issues,
    valid: issues.filter((i) => i.type === "error").length === 0,
  };
}

// ============================================================
// Portfolio Export
// ============================================================

export function exportPortfolio(format: "csv" | "json" = "json"): string {
  const domains = listDomains();

  if (format === "json") {
    return JSON.stringify(
      domains.map((d) => ({
        name: d.name,
        registrar: d.registrar,
        status: d.status,
        registered_at: d.registered_at,
        expires_at: d.expires_at,
        auto_renew: d.auto_renew,
        nameservers: d.nameservers,
        ssl_expires_at: d.ssl_expires_at,
        ssl_issuer: d.ssl_issuer,
        notes: d.notes,
      })),
      null,
      2
    );
  }

  // CSV format
  const headers = [
    "name",
    "registrar",
    "status",
    "registered_at",
    "expires_at",
    "auto_renew",
    "nameservers",
    "ssl_expires_at",
    "ssl_issuer",
    "notes",
  ];
  const rows = domains.map((d) =>
    [
      csvEscape(d.name),
      csvEscape(d.registrar || ""),
      csvEscape(d.status),
      csvEscape(d.registered_at || ""),
      csvEscape(d.expires_at || ""),
      d.auto_renew ? "true" : "false",
      csvEscape(d.nameservers.join("; ")),
      csvEscape(d.ssl_expires_at || ""),
      csvEscape(d.ssl_issuer || ""),
      csvEscape(d.notes || ""),
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n") + "\n";
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ============================================================
// Bulk Domain Check
// ============================================================

export interface BulkCheckResult {
  domain: string;
  domain_id: string;
  whois?: { registrar: string | null; expires_at: string | null; error?: string };
  ssl?: { issuer: string | null; expires_at: string | null; error?: string };
  dns_validation?: { valid: boolean; issue_count: number; errors: string[] };
}

export function checkAllDomains(): BulkCheckResult[] {
  const domains = listDomains();
  const results: BulkCheckResult[] = [];

  for (const domain of domains) {
    const result: BulkCheckResult = {
      domain: domain.name,
      domain_id: domain.id,
    };

    // WHOIS check
    try {
      const whois = whoisLookup(domain.name);
      result.whois = {
        registrar: whois.registrar,
        expires_at: whois.expires_at,
      };
    } catch (error: unknown) {
      result.whois = {
        registrar: null,
        expires_at: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // SSL check
    const ssl = checkSsl(domain.name);
    result.ssl = {
      issuer: ssl.issuer,
      expires_at: ssl.expires_at,
      error: ssl.error,
    };

    // DNS validation
    const validation = validateDns(domain.id);
    if (validation) {
      result.dns_validation = {
        valid: validation.valid,
        issue_count: validation.issues.length,
        errors: validation.issues.map((i) => `[${i.type}] ${i.message}`),
      };
    }

    results.push(result);
  }

  return results;
}

// ============================================================
// Helper: find domain by name (used by CLI to resolve names to IDs)
// ============================================================

export function getDomainByName(name: string): Domain | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM domains WHERE name = ?").get(name) as DomainRow | null;
  return row ? rowToDomain(row) : null;
}
