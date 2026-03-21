/**
 * Brandsight API integration for brand monitoring and threat detection
 *
 * Requires environment variable:
 *   BRANDSIGHT_API_KEY — API key for Brandsight
 */

// ============================================================
// Types
// ============================================================

export interface BrandsightAlert {
  domain: string;
  type: "typosquat" | "homoglyph" | "keyword" | "tld_variation";
  registered_at: string;
}

export interface BrandMonitorResult {
  brand: string;
  alerts: BrandsightAlert[];
  stub: boolean;
}

export interface WhoisHistoryEntry {
  registrant: string;
  date: string;
  changes: string[];
}

export interface WhoisHistoryResult {
  domain: string;
  history: WhoisHistoryEntry[];
  stub: boolean;
}

export interface ThreatAssessment {
  domain: string;
  risk_level: "low" | "medium" | "high" | "critical";
  threats: string[];
  recommendation: string;
  stub: boolean;
}

export class BrandsightApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseBody?: string
  ) {
    super(message);
    this.name = "BrandsightApiError";
  }
}

// ============================================================
// Configuration
// ============================================================

const API_BASE = "https://api.brandsight.com/v1";

export function getApiKey(): string {
  const key = process.env["BRANDSIGHT_API_KEY"];
  if (!key) {
    throw new BrandsightApiError(
      "BRANDSIGHT_API_KEY environment variable is not set"
    );
  }
  return key;
}

function getHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "microservice-domains/0.0.1",
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

async function apiRequest<T>(path: string, apiKey: string): Promise<{ data: T; stub: false } | { data: null; stub: true }> {
  const url = `${API_BASE}${path}`;
  const headers = getHeaders(apiKey);

  try {
    const response = await _fetchFn(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new BrandsightApiError(
        `Brandsight API GET ${path} failed with status ${response.status}`,
        response.status,
        await response.text()
      );
    }

    const data = (await response.json()) as T;
    return { data, stub: false };
  } catch (error) {
    if (error instanceof BrandsightApiError) throw error;
    // API unreachable — return stub indicator
    return { data: null, stub: true };
  }
}

// ============================================================
// Stub Data Generators
// ============================================================

function generateStubAlerts(brandName: string): BrandsightAlert[] {
  const now = new Date().toISOString();
  return [
    {
      domain: `${brandName}-deals.com`,
      type: "keyword",
      registered_at: now,
    },
    {
      domain: `${brandName.replace(/a/gi, "4").replace(/e/gi, "3")}.com`,
      type: "homoglyph",
      registered_at: now,
    },
    {
      domain: `${brandName}s.com`,
      type: "typosquat",
      registered_at: now,
    },
  ];
}

function generateStubSimilarDomains(domain: string): string[] {
  const base = domain.replace(/\.[^.]+$/, "");
  const tld = domain.slice(base.length);
  return [
    `${base}-online${tld}`,
    `${base}s${tld}`,
    `${base.replace(/a/gi, "4")}${tld}`,
    `${base}-app${tld}`,
    `get${base}${tld}`,
  ];
}

function generateStubWhoisHistory(domain: string): WhoisHistoryEntry[] {
  return [
    {
      registrant: "Privacy Proxy Service",
      date: "2023-01-15T00:00:00Z",
      changes: ["registrant_changed", "nameserver_changed"],
    },
    {
      registrant: "Original Owner LLC",
      date: "2020-06-01T00:00:00Z",
      changes: ["initial_registration"],
    },
  ];
}

function generateStubThreatAssessment(domain: string): Omit<ThreatAssessment, "stub"> {
  return {
    domain,
    risk_level: "low",
    threats: [],
    recommendation: "No immediate threats detected. Continue routine monitoring.",
  };
}

// ============================================================
// API Functions
// ============================================================

/**
 * Monitor a brand name for new domain registrations that are similar.
 */
export async function monitorBrand(brandName: string): Promise<BrandMonitorResult> {
  const apiKey = getApiKey();
  const result = await apiRequest<{ alerts: BrandsightAlert[] }>(
    `/brands/${encodeURIComponent(brandName)}/monitor`,
    apiKey
  );

  if (result.stub) {
    return {
      brand: brandName,
      alerts: generateStubAlerts(brandName),
      stub: true,
    };
  }

  return {
    brand: brandName,
    alerts: result.data!.alerts,
    stub: false,
  };
}

/**
 * Find typosquat/competing domains similar to the given domain.
 */
export async function getSimilarDomains(domain: string): Promise<{ domain: string; similar: string[]; stub: boolean }> {
  const apiKey = getApiKey();
  const result = await apiRequest<{ similar: string[] }>(
    `/domains/${encodeURIComponent(domain)}/similar`,
    apiKey
  );

  if (result.stub) {
    return {
      domain,
      similar: generateStubSimilarDomains(domain),
      stub: true,
    };
  }

  return {
    domain,
    similar: result.data!.similar,
    stub: false,
  };
}

/**
 * Get historical WHOIS records for a domain.
 */
export async function getWhoisHistory(domain: string): Promise<WhoisHistoryResult> {
  const apiKey = getApiKey();
  const result = await apiRequest<{ history: WhoisHistoryEntry[] }>(
    `/domains/${encodeURIComponent(domain)}/whois-history`,
    apiKey
  );

  if (result.stub) {
    return {
      domain,
      history: generateStubWhoisHistory(domain),
      stub: true,
    };
  }

  return {
    domain,
    history: result.data!.history,
    stub: false,
  };
}

/**
 * Get a threat assessment for a domain.
 */
export async function getThreatAssessment(domain: string): Promise<ThreatAssessment> {
  const apiKey = getApiKey();
  const result = await apiRequest<Omit<ThreatAssessment, "stub">>(
    `/domains/${encodeURIComponent(domain)}/threats`,
    apiKey
  );

  if (result.stub) {
    return {
      ...generateStubThreatAssessment(domain),
      stub: true,
    };
  }

  return {
    ...result.data!,
    stub: false,
  };
}
