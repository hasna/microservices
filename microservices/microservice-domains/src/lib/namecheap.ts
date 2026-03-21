/**
 * Namecheap API integration for domain management
 *
 * Uses the Connector SDK pattern from connect-namecheap.
 * When @hasna/connect-namecheap is published to npm, replace the
 * relative connector import with the package import.
 *
 * Requires environment variables:
 *   NAMECHEAP_API_KEY    — API key from Namecheap
 *   NAMECHEAP_USERNAME   — Namecheap account username
 *   NAMECHEAP_CLIENT_IP  — Whitelisted client IP address
 */

// Re-export types used by consumers (CLI, MCP, registrar)
export type {
  ConnectorConfig as NamecheapConfig,
  Domain as NamecheapDomain,
  DomainInfo as NamecheapDomainInfo,
  DnsRecord as NamecheapDnsRecord,
  AvailabilityResult as NamecheapAvailability,
  RenewResult as NamecheapRenewResult,
} from "../../../../../open-connectors/connectors/connect-namecheap/src/index.js";

import {
  Connector,
  type ConnectorConfig,
  type Domain as NamecheapDomain,
  type DomainInfo as NamecheapDomainInfo,
  type DnsRecord as NamecheapDnsRecord,
} from "../../../../../open-connectors/connectors/connect-namecheap/src/index.js";

// ============================================================
// Sync Result Type (microservice-specific, not in connector)
// ============================================================

export interface NamecheapSyncResult {
  synced: number;
  errors: string[];
  domains: string[];
}

// ============================================================
// Connector Instance Management
// ============================================================

/**
 * Create a Namecheap connector from environment variables.
 * Wraps Connector.fromEnv() with the same env var validation.
 */
export function getConfig(): ConnectorConfig {
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

function createConnector(config?: ConnectorConfig): Connector {
  return new Connector(config || getConfig());
}

// ============================================================
// API Functions (thin wrappers around connector)
// ============================================================

/**
 * List all domains in the Namecheap account
 */
export async function listNamecheapDomains(config?: ConnectorConfig): Promise<NamecheapDomain[]> {
  const connector = createConnector(config);
  return connector.domains.list();
}

/**
 * Get detailed info for a specific domain
 */
export async function getDomainInfo(domain: string, config?: ConnectorConfig): Promise<NamecheapDomainInfo> {
  const connector = createConnector(config);
  return connector.domains.getInfo(domain);
}

/**
 * Renew a domain
 */
export async function renewDomain(domain: string, years: number = 1, config?: ConnectorConfig) {
  const connector = createConnector(config);
  return connector.domains.renew(domain, years);
}

/**
 * Get DNS host records for a domain
 */
export async function getDnsRecords(domain: string, sld: string, tld: string, config?: ConnectorConfig): Promise<NamecheapDnsRecord[]> {
  const connector = createConnector(config);
  return connector.dns.getHosts(sld, tld);
}

/**
 * Set DNS host records for a domain
 */
export async function setDnsRecords(
  domain: string,
  sld: string,
  tld: string,
  records: NamecheapDnsRecord[],
  config?: ConnectorConfig
): Promise<boolean> {
  const connector = createConnector(config);
  return connector.dns.setHosts(sld, tld, records);
}

/**
 * Check domain availability
 */
export async function checkAvailability(domain: string, config?: ConnectorConfig) {
  const connector = createConnector(config);
  return connector.domains.check(domain);
}

// ============================================================
// Domain Helpers (microservice-specific)
// ============================================================

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

// ============================================================
// Sync to Local DB (microservice business logic)
// ============================================================

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
}, config?: ConnectorConfig): Promise<NamecheapSyncResult> {
  const connector = createConnector(config);
  const result: NamecheapSyncResult = { synced: 0, errors: [], domains: [] };

  let ncDomains: NamecheapDomain[];
  try {
    ncDomains = await connector.domains.list();
  } catch (error) {
    throw new Error(`Failed to list Namecheap domains: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const ncDomain of ncDomains) {
    try {
      // Get detailed info via connector
      let info: NamecheapDomainInfo;
      try {
        info = await connector.domains.getInfo(ncDomain.domain);
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
