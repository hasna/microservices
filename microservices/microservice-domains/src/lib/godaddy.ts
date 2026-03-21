/**
 * GoDaddy API integration for microservice-domains
 *
 * Uses the Connector SDK pattern from connect-godaddy.
 * When @hasna/connect-godaddy is published to npm, replace the
 * relative connector import with the package import.
 *
 * Environment variables:
 *   GODADDY_API_KEY    — GoDaddy API key
 *   GODADDY_API_SECRET — GoDaddy API secret
 */

import type {
  CreateDomainInput,
  UpdateDomainInput,
  Domain,
} from "../db/domains.js";

// Re-export types used by consumers
export type {
  GoDaddyDomain,
  GoDaddyDomainDetail,
  GoDaddyDnsRecord,
  GoDaddyAvailability,
  GoDaddyRenewResponse,
} from "../../../../../open-connectors/connectors/connect-godaddy/src/index.js";

import {
  GoDaddy,
  GoDaddyApiError,
  type GoDaddyDomain,
  type GoDaddyDomainDetail,
  type GoDaddyDnsRecord,
  type GoDaddyAvailability,
  type GoDaddyConfig,
} from "../../../../../open-connectors/connectors/connect-godaddy/src/index.js";

export { GoDaddyApiError };

// ============================================================
// Sync Result Type (microservice-specific)
// ============================================================

export interface GoDaddySyncResult {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}

// ============================================================
// Internal fetch override (allows test injection)
// ============================================================

type FetchFn = typeof globalThis.fetch;

let _overriddenFetch: FetchFn | null = null;

/**
 * Override the fetch implementation (for testing).
 * Pass `null` to restore the default.
 */
export function _setFetch(fn: FetchFn | null): void {
  _overriddenFetch = fn;
}

// ============================================================
// Connector Instance Management
// ============================================================

function createConnector(): GoDaddy {
  // Use fromEnv() which reads GODADDY_API_KEY and GODADDY_API_SECRET
  return GoDaddy.fromEnv();
}

// ============================================================
// API Functions (thin wrappers around connector)
// ============================================================

/**
 * List all domains in the GoDaddy account.
 */
export async function listGoDaddyDomains(): Promise<GoDaddyDomain[]> {
  if (_overriddenFetch) {
    return _legacyApiRequest<GoDaddyDomain[]>("GET", "/v1/domains");
  }
  const connector = createConnector();
  return connector.domains.list();
}

/**
 * Get detailed info for a single domain.
 */
export async function getDomainInfo(
  domain: string
): Promise<GoDaddyDomainDetail> {
  if (_overriddenFetch) {
    return _legacyApiRequest<GoDaddyDomainDetail>(
      "GET",
      `/v1/domains/${encodeURIComponent(domain)}`
    );
  }
  const connector = createConnector();
  return connector.domains.getInfo(domain);
}

/**
 * Renew a domain for 1 year.
 */
export async function renewDomain(
  domain: string
): Promise<{ orderId: number; itemCount: number; total: number }> {
  if (_overriddenFetch) {
    return _legacyApiRequest(
      "POST",
      `/v1/domains/${encodeURIComponent(domain)}/renew`,
      { period: 1 }
    );
  }
  const connector = createConnector();
  return connector.domains.renew(domain);
}

/**
 * Get DNS records for a domain, optionally filtered by type.
 */
export async function getDnsRecords(
  domain: string,
  type?: string
): Promise<GoDaddyDnsRecord[]> {
  if (_overriddenFetch) {
    const path = type
      ? `/v1/domains/${encodeURIComponent(domain)}/records/${encodeURIComponent(type)}`
      : `/v1/domains/${encodeURIComponent(domain)}/records`;
    return _legacyApiRequest<GoDaddyDnsRecord[]>("GET", path);
  }
  const connector = createConnector();
  return type
    ? connector.dns.getRecords(domain, type)
    : connector.dns.getRecords(domain);
}

/**
 * Replace all DNS records for a domain.
 */
export async function setDnsRecords(
  domain: string,
  records: GoDaddyDnsRecord[]
): Promise<void> {
  if (_overriddenFetch) {
    await _legacyApiRequest<void>(
      "PUT",
      `/v1/domains/${encodeURIComponent(domain)}/records`,
      records
    );
    return;
  }
  const connector = createConnector();
  await connector.dns.replaceAllRecords(domain, records);
}

/**
 * Check domain availability for purchase.
 */
export async function checkAvailability(
  domain: string
): Promise<GoDaddyAvailability> {
  if (_overriddenFetch) {
    return _legacyApiRequest<GoDaddyAvailability>(
      "GET",
      `/v1/domains/available?domain=${encodeURIComponent(domain)}`
    );
  }
  const connector = createConnector();
  return connector.domains.checkAvailability(domain);
}

// ============================================================
// Legacy fetch helper (for test injection compatibility)
// ============================================================

const GODADDY_API_BASE = "https://api.godaddy.com";

function _getCredentials(): { key: string; secret: string } {
  const key = process.env["GODADDY_API_KEY"];
  const secret = process.env["GODADDY_API_SECRET"];

  if (!key || !secret) {
    throw new Error(
      "GoDaddy API credentials not configured. Set GODADDY_API_KEY and GODADDY_API_SECRET environment variables."
    );
  }

  return { key, secret };
}

function _getHeaders(): Record<string, string> {
  const { key, secret } = _getCredentials();
  return {
    Authorization: `sso-key ${key}:${secret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function _legacyApiRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const fetchFn = _overriddenFetch || globalThis.fetch;
  const url = `${GODADDY_API_BASE}${path}`;
  const headers = _getHeaders();

  const options: RequestInit = { method, headers };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetchFn(url, options);

  if (!response.ok) {
    const text = await response.text();
    throw new GoDaddyApiError(
      `GoDaddy API ${method} ${path} failed with status ${response.status}: ${text}`,
      response.status,
      { responseBody: text }
    );
  }

  // Some endpoints return 204 No Content
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return (await response.json()) as T;
}

// ============================================================
// Sync to Local DB (microservice business logic)
// ============================================================

/**
 * Maps GoDaddy status strings to local domain statuses.
 */
function mapGoDaddyStatus(
  gdStatus: string
): "active" | "expired" | "transferring" | "redemption" {
  const s = gdStatus.toUpperCase();
  if (s === "ACTIVE") return "active";
  if (s === "EXPIRED") return "expired";
  if (
    s === "TRANSFERRED_OUT" ||
    s === "TRANSFERRING" ||
    s === "PENDING_TRANSFER"
  )
    return "transferring";
  if (s === "REDEMPTION" || s === "PENDING_REDEMPTION") return "redemption";
  return "active";
}

/**
 * Sync all GoDaddy domains into the local database.
 *
 * Accepts DB helpers so the caller can inject the actual CRUD functions.
 */
export async function syncToLocalDb(dbFns: {
  getDomainByName: (name: string) => Domain | null;
  createDomain: (input: CreateDomainInput) => Domain;
  updateDomain: (id: string, input: UpdateDomainInput) => Domain | null;
}): Promise<GoDaddySyncResult> {
  const result: GoDaddySyncResult = {
    synced: 0,
    created: 0,
    updated: 0,
    errors: [],
  };

  let gdDomains: GoDaddyDomain[];
  try {
    gdDomains = await listGoDaddyDomains();
  } catch (err) {
    result.errors.push(
      `Failed to list domains: ${err instanceof Error ? err.message : String(err)}`
    );
    return result;
  }

  for (const gd of gdDomains) {
    try {
      // Fetch full detail for each domain via connector
      let detail: GoDaddyDomainDetail;
      try {
        detail = await getDomainInfo(gd.domain);
      } catch {
        // Fall back to list-level data if detail fetch fails
        detail = gd as GoDaddyDomainDetail;
      }

      const existing = dbFns.getDomainByName(gd.domain);

      const domainData = {
        name: gd.domain,
        registrar: "GoDaddy",
        status: mapGoDaddyStatus(gd.status),
        expires_at: gd.expires
          ? new Date(gd.expires).toISOString()
          : undefined,
        auto_renew: gd.renewAuto,
        nameservers: gd.nameServers || [],
        registered_at: detail.createdAt
          ? new Date(detail.createdAt).toISOString()
          : undefined,
        metadata: {
          godaddy_domain_id: (detail as GoDaddyDomainDetail).domainId,
          provider: "godaddy",
          locked: (detail as GoDaddyDomainDetail).locked,
          privacy: (detail as GoDaddyDomainDetail).privacy,
        },
      };

      if (existing) {
        dbFns.updateDomain(existing.id, domainData);
        result.updated++;
      } else {
        dbFns.createDomain(domainData);
        result.created++;
      }
      result.synced++;
    } catch (err) {
      result.errors.push(
        `Failed to sync ${gd.domain}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}
