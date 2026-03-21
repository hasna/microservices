/**
 * Namecheap API integration for domain management
 *
 * Requires environment variables:
 *   NAMECHEAP_API_KEY    — API key from Namecheap
 *   NAMECHEAP_USERNAME   — Namecheap account username
 *   NAMECHEAP_CLIENT_IP  — Whitelisted client IP address
 */

// ============================================================
// Types
// ============================================================

export interface NamecheapConfig {
  apiKey: string;
  username: string;
  clientIp: string;
  sandbox?: boolean;
}

export interface NamecheapDomain {
  domain: string;
  expiry: string;
  autoRenew: boolean;
  isLocked: boolean;
}

export interface NamecheapDomainInfo {
  domain: string;
  registrar: string;
  created: string;
  expires: string;
  nameservers: string[];
}

export interface NamecheapDnsRecord {
  hostId?: string;
  type: string;
  name: string;
  address: string;
  mxPref?: number;
  ttl: number;
}

export interface NamecheapAvailability {
  domain: string;
  available: boolean;
}

export interface NamecheapRenewResult {
  domain: string;
  success: boolean;
  transactionId?: string;
  chargedAmount?: string;
  orderId?: string;
}

export interface NamecheapSyncResult {
  synced: number;
  errors: string[];
  domains: string[];
}

// ============================================================
// Configuration
// ============================================================

const API_BASE = "https://api.namecheap.com/xml.response";
const SANDBOX_BASE = "https://api.sandbox.namecheap.com/xml.response";

export function getConfig(): NamecheapConfig {
  const apiKey = process.env["NAMECHEAP_API_KEY"];
  const username = process.env["NAMECHEAP_USERNAME"];
  const clientIp = process.env["NAMECHEAP_CLIENT_IP"];

  if (!apiKey) throw new Error("NAMECHEAP_API_KEY environment variable is not set");
  if (!username) throw new Error("NAMECHEAP_USERNAME environment variable is not set");
  if (!clientIp) throw new Error("NAMECHEAP_CLIENT_IP environment variable is not set");

  return {
    apiKey,
    username,
    clientIp,
    sandbox: process.env["NAMECHEAP_SANDBOX"] === "true",
  };
}

// ============================================================
// XML Parsing Helpers (regex-based, no dependencies)
// ============================================================

export function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

export function extractAttribute(xml: string, tag: string, attr: string): string | null {
  const regex = new RegExp(`<${tag}\\s[^>]*${attr}="([^"]*)"`, "i");
  const match = xml.match(regex);
  return match ? match[1] : null;
}

export function extractAllTags(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?\\/?>(?:([^<]*)<\\/${tag}>)?`, "gi");
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    // Only match exact tag name — skip tags like <DomainListResult> when searching for <Domain>
    const fullMatch = match[0];
    const tagNameCheck = new RegExp(`^<${tag}(?:\\s|\\/>|>)`, "i");
    if (tagNameCheck.test(fullMatch)) {
      results.push(fullMatch);
    }
  }
  return results;
}

export function extractAttributeFromElement(element: string, attr: string): string | null {
  const regex = new RegExp(`${attr}="([^"]*)"`, "i");
  const match = element.match(regex);
  return match ? match[1] : null;
}

export function checkApiError(xml: string): void {
  const status = extractAttribute(xml, "ApiResponse", "Status");
  if (status === "ERROR") {
    const errorMsg = extractTag(xml, "Message") || extractTag(xml, "Err") || "Unknown Namecheap API error";
    const errorNumber = extractAttribute(xml, "Error", "Number") || extractAttribute(xml, "Err", "Number");
    throw new Error(`Namecheap API error${errorNumber ? ` (${errorNumber})` : ""}: ${errorMsg}`);
  }
}

// ============================================================
// HTTP Layer
// ============================================================

export function buildUrl(command: string, config: NamecheapConfig, extraParams?: Record<string, string>): string {
  const base = config.sandbox ? SANDBOX_BASE : API_BASE;
  const params = new URLSearchParams({
    ApiUser: config.username,
    ApiKey: config.apiKey,
    UserName: config.username,
    ClientIp: config.clientIp,
    Command: command,
    ...extraParams,
  });
  return `${base}?${params.toString()}`;
}

export async function apiRequest(command: string, config: NamecheapConfig, extraParams?: Record<string, string>): Promise<string> {
  const url = buildUrl(command, config, extraParams);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: { "User-Agent": "microservice-domains/0.0.1" },
  });

  if (!response.ok) {
    throw new Error(`Namecheap API HTTP error: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  checkApiError(xml);
  return xml;
}

// ============================================================
// API Functions
// ============================================================

/**
 * List all domains in the Namecheap account
 * Command: namecheap.domains.getList
 */
export async function listNamecheapDomains(config?: NamecheapConfig): Promise<NamecheapDomain[]> {
  const cfg = config || getConfig();
  const xml = await apiRequest("namecheap.domains.getList", cfg, {
    PageSize: "100",
    Page: "1",
  });

  const domainElements = extractAllTags(xml, "Domain");
  const domains: NamecheapDomain[] = [];

  for (const el of domainElements) {
    const name = extractAttributeFromElement(el, "Name");
    const expires = extractAttributeFromElement(el, "Expires");
    const autoRenew = extractAttributeFromElement(el, "AutoRenew");
    const isLocked = extractAttributeFromElement(el, "IsLocked");

    if (name) {
      domains.push({
        domain: name,
        expiry: expires || "",
        autoRenew: autoRenew === "true",
        isLocked: isLocked === "true",
      });
    }
  }

  return domains;
}

/**
 * Get detailed info for a specific domain
 * Command: namecheap.domains.getInfo
 */
export async function getDomainInfo(domain: string, config?: NamecheapConfig): Promise<NamecheapDomainInfo> {
  const cfg = config || getConfig();
  const xml = await apiRequest("namecheap.domains.getInfo", cfg, {
    DomainName: domain,
  });

  // Parse creation and expiry dates
  const createdDate = extractTag(xml, "CreatedDate") || extractAttribute(xml, "DomainGetInfoResult", "CreatedDate") || "";
  const expiresDate = extractTag(xml, "ExpiredDate") || extractAttribute(xml, "DomainGetInfoResult", "ExpiredDate") || "";

  // Parse nameservers
  const nsSection = xml.match(/<DnsDetails[^>]*>([\s\S]*?)<\/DnsDetails>/i);
  const nameservers: string[] = [];
  if (nsSection) {
    const nsElements = nsSection[1].matchAll(/<Nameserver[^>]*>([^<]*)<\/Nameserver>/gi);
    for (const m of nsElements) {
      if (m[1]) nameservers.push(m[1].trim().toLowerCase());
    }
  }

  return {
    domain,
    registrar: "Namecheap",
    created: createdDate,
    expires: expiresDate,
    nameservers,
  };
}

/**
 * Renew a domain
 * Command: namecheap.domains.renew
 */
export async function renewDomain(domain: string, years: number = 1, config?: NamecheapConfig): Promise<NamecheapRenewResult> {
  const cfg = config || getConfig();
  const xml = await apiRequest("namecheap.domains.renew", cfg, {
    DomainName: domain,
    Years: String(years),
  });

  const transactionId = extractAttribute(xml, "DomainRenewResult", "TransactionID") || undefined;
  const chargedAmount = extractAttribute(xml, "DomainRenewResult", "ChargedAmount") || undefined;
  const orderId = extractAttribute(xml, "DomainRenewResult", "OrderID") || undefined;

  return {
    domain,
    success: true,
    transactionId,
    chargedAmount,
    orderId,
  };
}

/**
 * Get DNS host records for a domain
 * Command: namecheap.domains.dns.getHosts
 */
export async function getDnsRecords(domain: string, sld: string, tld: string, config?: NamecheapConfig): Promise<NamecheapDnsRecord[]> {
  const cfg = config || getConfig();
  const xml = await apiRequest("namecheap.domains.dns.getHosts", cfg, {
    SLD: sld,
    TLD: tld,
  });

  const hostElements = extractAllTags(xml, "host");
  const records: NamecheapDnsRecord[] = [];

  for (const el of hostElements) {
    const type = extractAttributeFromElement(el, "Type");
    const name = extractAttributeFromElement(el, "Name");
    const address = extractAttributeFromElement(el, "Address");
    const hostId = extractAttributeFromElement(el, "HostId");
    const mxPref = extractAttributeFromElement(el, "MXPref");
    const ttl = extractAttributeFromElement(el, "TTL");

    if (type && name && address) {
      records.push({
        hostId: hostId || undefined,
        type,
        name,
        address,
        mxPref: mxPref ? parseInt(mxPref) : undefined,
        ttl: ttl ? parseInt(ttl) : 1800,
      });
    }
  }

  return records;
}

/**
 * Set DNS host records for a domain
 * Command: namecheap.domains.dns.setHosts
 */
export async function setDnsRecords(
  domain: string,
  sld: string,
  tld: string,
  records: NamecheapDnsRecord[],
  config?: NamecheapConfig
): Promise<boolean> {
  const cfg = config || getConfig();
  const params: Record<string, string> = {
    SLD: sld,
    TLD: tld,
  };

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const idx = i + 1;
    params[`HostName${idx}`] = r.name;
    params[`RecordType${idx}`] = r.type;
    params[`Address${idx}`] = r.address;
    params[`TTL${idx}`] = String(r.ttl);
    if (r.mxPref !== undefined) {
      params[`MXPref${idx}`] = String(r.mxPref);
    }
  }

  await apiRequest("namecheap.domains.dns.setHosts", cfg, params);
  return true;
}

/**
 * Check domain availability
 * Command: namecheap.domains.check
 */
export async function checkAvailability(domain: string, config?: NamecheapConfig): Promise<NamecheapAvailability> {
  const cfg = config || getConfig();
  const xml = await apiRequest("namecheap.domains.check", cfg, {
    DomainList: domain,
  });

  const available = extractAttribute(xml, "DomainCheckResult", "Available");

  return {
    domain,
    available: available === "true",
  };
}

/**
 * Split a domain name into SLD (second-level domain) and TLD (top-level domain)
 */
export function splitDomain(domain: string): { sld: string; tld: string } {
  const parts = domain.split(".");
  if (parts.length < 2) {
    throw new Error(`Invalid domain: ${domain}`);
  }
  // Handle multi-part TLDs like .co.uk
  if (parts.length >= 3 && ["co", "com", "org", "net", "ac", "gov"].includes(parts[parts.length - 2])) {
    return {
      sld: parts.slice(0, -2).join("."),
      tld: parts.slice(-2).join("."),
    };
  }
  return {
    sld: parts.slice(0, -1).join("."),
    tld: parts[parts.length - 1],
  };
}

/**
 * Sync domains from Namecheap to local database
 * Calls listDomains + getDomainInfo for each, upserts into local domains table
 */
export async function syncToLocalDb(dbFunctions: {
  getDomainByName: (name: string) => { id: string } | null;
  createDomain: (input: {
    name: string;
    registrar?: string;
    status?: string;
    registered_at?: string;
    expires_at?: string;
    auto_renew?: boolean;
    nameservers?: string[];
  }) => { id: string; name: string };
  updateDomain: (
    id: string,
    input: {
      registrar?: string;
      status?: string;
      registered_at?: string;
      expires_at?: string;
      auto_renew?: boolean;
      nameservers?: string[];
    }
  ) => unknown;
}, config?: NamecheapConfig): Promise<NamecheapSyncResult> {
  const cfg = config || getConfig();
  const result: NamecheapSyncResult = { synced: 0, errors: [], domains: [] };

  let ncDomains: NamecheapDomain[];
  try {
    ncDomains = await listNamecheapDomains(cfg);
  } catch (error) {
    throw new Error(`Failed to list Namecheap domains: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const ncDomain of ncDomains) {
    try {
      // Get detailed info
      let info: NamecheapDomainInfo;
      try {
        info = await getDomainInfo(ncDomain.domain, cfg);
      } catch {
        // Fall back to basic info if getInfo fails
        info = {
          domain: ncDomain.domain,
          registrar: "Namecheap",
          created: "",
          expires: ncDomain.expiry,
          nameservers: [],
        };
      }

      // Normalize dates to ISO format
      const expiresAt = normalizeDate(info.expires || ncDomain.expiry);
      const createdAt = normalizeDate(info.created);

      // Upsert into local DB
      const existing = dbFunctions.getDomainByName(ncDomain.domain);
      if (existing) {
        dbFunctions.updateDomain(existing.id, {
          registrar: "Namecheap",
          status: "active",
          registered_at: createdAt || undefined,
          expires_at: expiresAt || undefined,
          auto_renew: ncDomain.autoRenew,
          nameservers: info.nameservers.length > 0 ? info.nameservers : undefined,
        });
      } else {
        dbFunctions.createDomain({
          name: ncDomain.domain,
          registrar: "Namecheap",
          status: "active",
          registered_at: createdAt || undefined,
          expires_at: expiresAt || undefined,
          auto_renew: ncDomain.autoRenew,
          nameservers: info.nameservers,
        });
      }

      result.synced++;
      result.domains.push(ncDomain.domain);
    } catch (error) {
      result.errors.push(`${ncDomain.domain}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}

// ============================================================
// Helpers
// ============================================================

function normalizeDate(dateStr: string): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}
