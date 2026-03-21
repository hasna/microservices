/**
 * GoDaddy API integration for microservice-domains
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

// ============================================================
// Types
// ============================================================

export interface GoDaddyDomain {
  domain: string;
  status: string;
  expires: string;
  renewAuto: boolean;
  nameServers: string[];
}

export interface GoDaddyDomainDetail extends GoDaddyDomain {
  domainId: number;
  createdAt: string;
  expirationProtected: boolean;
  holdRegistrar: boolean;
  locked: boolean;
  privacy: boolean;
  registrarCreatedAt: string;
  renewDeadline: string;
  transferProtected: boolean;
  contactAdmin?: Record<string, unknown>;
  contactBilling?: Record<string, unknown>;
  contactRegistrant?: Record<string, unknown>;
  contactTech?: Record<string, unknown>;
}

export interface GoDaddyDnsRecord {
  type: string;
  name: string;
  data: string;
  ttl: number;
  priority?: number;
}

export interface GoDaddyAvailability {
  available: boolean;
  domain: string;
  definitive: boolean;
  price: number;
  currency: string;
  period: number;
}

export interface GoDaddySyncResult {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}

export class GoDaddyApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: string
  ) {
    super(message);
    this.name = "GoDaddyApiError";
  }
}

// ============================================================
// Configuration
// ============================================================

const GODADDY_API_BASE = "https://api.godaddy.com";

function getCredentials(): { key: string; secret: string } {
  const key = process.env["GODADDY_API_KEY"];
  const secret = process.env["GODADDY_API_SECRET"];

  if (!key || !secret) {
    throw new Error(
      "GoDaddy API credentials not configured. Set GODADDY_API_KEY and GODADDY_API_SECRET environment variables."
    );
  }

  return { key, secret };
}

function getHeaders(): Record<string, string> {
  const { key, secret } = getCredentials();
  return {
    Authorization: `sso-key ${key}:${secret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// ============================================================
// Internal fetch helper (allows test injection)
// ============================================================

type FetchFn = typeof globalThis.fetch;

let _fetchFn: FetchFn = globalThis.fetch;

/**
 * Override the fetch implementation (for testing).
 * Pass `null` to restore the default.
 */
export function _setFetch(fn: FetchFn | null): void {
  _fetchFn = fn ?? globalThis.fetch;
}

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${GODADDY_API_BASE}${path}`;
  const headers = getHeaders();

  const options: RequestInit = { method, headers };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await _fetchFn(url, options);

  if (!response.ok) {
    const text = await response.text();
    throw new GoDaddyApiError(
      `GoDaddy API ${method} ${path} failed with status ${response.status}: ${text}`,
      response.status,
      text
    );
  }

  // Some endpoints return 204 No Content
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return (await response.json()) as T;
}

// ============================================================
// API Functions
// ============================================================

/**
 * List all domains in the GoDaddy account.
 */
export async function listGoDaddyDomains(): Promise<GoDaddyDomain[]> {
  return apiRequest<GoDaddyDomain[]>("GET", "/v1/domains");
}

/**
 * Get detailed info for a single domain.
 */
export async function getDomainInfo(
  domain: string
): Promise<GoDaddyDomainDetail> {
  return apiRequest<GoDaddyDomainDetail>(
    "GET",
    `/v1/domains/${encodeURIComponent(domain)}`
  );
}

/**
 * Renew a domain for 1 year.
 */
export async function renewDomain(
  domain: string
): Promise<{ orderId: number; itemCount: number; total: number }> {
  return apiRequest(
    "POST",
    `/v1/domains/${encodeURIComponent(domain)}/renew`,
    { period: 1 }
  );
}

/**
 * Get DNS records for a domain, optionally filtered by type.
 */
export async function getDnsRecords(
  domain: string,
  type?: string
): Promise<GoDaddyDnsRecord[]> {
  const path = type
    ? `/v1/domains/${encodeURIComponent(domain)}/records/${encodeURIComponent(type)}`
    : `/v1/domains/${encodeURIComponent(domain)}/records`;
  return apiRequest<GoDaddyDnsRecord[]>("GET", path);
}

/**
 * Replace all DNS records for a domain.
 */
export async function setDnsRecords(
  domain: string,
  records: GoDaddyDnsRecord[]
): Promise<void> {
  await apiRequest<void>(
    "PUT",
    `/v1/domains/${encodeURIComponent(domain)}/records`,
    records
  );
}

/**
 * Check domain availability for purchase.
 */
export async function checkAvailability(
  domain: string
): Promise<GoDaddyAvailability> {
  return apiRequest<GoDaddyAvailability>(
    "GET",
    `/v1/domains/available?domain=${encodeURIComponent(domain)}`
  );
}

// ============================================================
// Sync to Local DB
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
      // Fetch full detail for each domain
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
