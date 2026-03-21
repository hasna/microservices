/**
 * Brandsight API integration for brand monitoring and threat detection
 *
 * Uses the Connector SDK pattern. When a connect-brandsight package
 * is published, replace the inline connector with the package import.
 *
 * Requires environment variable:
 *   BRANDSIGHT_API_KEY — API key for Brandsight
 */

// ============================================================
// Types
// ============================================================

export interface BrandsightConfig {
  apiKey: string;
  baseUrl?: string;
}

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
// Brandsight Connector Client (inline SDK pattern)
// ============================================================

class BrandsightClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private fetchFn: typeof globalThis.fetch;

  constructor(config: BrandsightConfig, fetchFn?: typeof globalThis.fetch) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.brandsight.com/v1";
    this.fetchFn = fetchFn || globalThis.fetch;
  }

  setFetch(fn: typeof globalThis.fetch): void {
    this.fetchFn = fn;
  }

  async get<T>(path: string): Promise<{ data: T; stub: false } | { data: null; stub: true }> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "microservice-domains/0.0.1",
    };

    try {
      const response = await this.fetchFn(url, {
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
}

// ============================================================
// Brandsight Connector (SDK pattern)
// ============================================================

class BrandsightConnector {
  private readonly client: BrandsightClient;

  constructor(config: BrandsightConfig, fetchFn?: typeof globalThis.fetch) {
    this.client = new BrandsightClient(config, fetchFn);
  }

  static fromEnv(fetchFn?: typeof globalThis.fetch): BrandsightConnector {
    const apiKey = process.env["BRANDSIGHT_API_KEY"];
    if (!apiKey) {
      throw new BrandsightApiError(
        "BRANDSIGHT_API_KEY environment variable is not set"
      );
    }
    return new BrandsightConnector({ apiKey }, fetchFn);
  }

  setFetch(fn: typeof globalThis.fetch): void {
    this.client.setFetch(fn);
  }

  async monitorBrand(brandName: string): Promise<{ alerts: BrandsightAlert[] } | null> {
    const result = await this.client.get<{ alerts: BrandsightAlert[] }>(
      `/brands/${encodeURIComponent(brandName)}/monitor`
    );
    return result.stub ? null : result.data;
  }

  async getSimilarDomains(domain: string): Promise<{ similar: string[] } | null> {
    const result = await this.client.get<{ similar: string[] }>(
      `/domains/${encodeURIComponent(domain)}/similar`
    );
    return result.stub ? null : result.data;
  }

  async getWhoisHistory(domain: string): Promise<{ history: WhoisHistoryEntry[] } | null> {
    const result = await this.client.get<{ history: WhoisHistoryEntry[] }>(
      `/domains/${encodeURIComponent(domain)}/whois-history`
    );
    return result.stub ? null : result.data;
  }

  async getThreatAssessment(domain: string): Promise<Omit<ThreatAssessment, "stub"> | null> {
    const result = await this.client.get<Omit<ThreatAssessment, "stub">>(
      `/domains/${encodeURIComponent(domain)}/threats`
    );
    return result.stub ? null : result.data;
  }
}

// ============================================================
// Module-level state (for test injection)
// ============================================================

type FetchFn = typeof globalThis.fetch;

let _fetchFn: FetchFn | null = null;

/**
 * Override the fetch implementation (for testing).
 * Pass `null` to restore the default.
 */
export function _setFetch(fn: FetchFn | null): void {
  _fetchFn = fn;
}

export function getApiKey(): string {
  const key = process.env["BRANDSIGHT_API_KEY"];
  if (!key) {
    throw new BrandsightApiError(
      "BRANDSIGHT_API_KEY environment variable is not set"
    );
  }
  return key;
}

function createConnector(): BrandsightConnector {
  const connector = BrandsightConnector.fromEnv(_fetchFn || undefined);
  return connector;
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
// API Functions (use connector, fall back to stubs)
// ============================================================

/**
 * Monitor a brand name for new domain registrations that are similar.
 */
export async function monitorBrand(brandName: string): Promise<BrandMonitorResult> {
  const connector = createConnector();
  const data = await connector.monitorBrand(brandName);

  if (data === null) {
    return {
      brand: brandName,
      alerts: generateStubAlerts(brandName),
      stub: true,
    };
  }

  return {
    brand: brandName,
    alerts: data.alerts,
    stub: false,
  };
}

/**
 * Find typosquat/competing domains similar to the given domain.
 */
export async function getSimilarDomains(domain: string): Promise<{ domain: string; similar: string[]; stub: boolean }> {
  const connector = createConnector();
  const data = await connector.getSimilarDomains(domain);

  if (data === null) {
    return {
      domain,
      similar: generateStubSimilarDomains(domain),
      stub: true,
    };
  }

  return {
    domain,
    similar: data.similar,
    stub: false,
  };
}

/**
 * Get historical WHOIS records for a domain.
 */
export async function getWhoisHistory(domain: string): Promise<WhoisHistoryResult> {
  const connector = createConnector();
  const data = await connector.getWhoisHistory(domain);

  if (data === null) {
    return {
      domain,
      history: generateStubWhoisHistory(domain),
      stub: true,
    };
  }

  return {
    domain,
    history: data.history,
    stub: false,
  };
}

/**
 * Get a threat assessment for a domain.
 */
export async function getThreatAssessment(domain: string): Promise<ThreatAssessment> {
  const connector = createConnector();
  const data = await connector.getThreatAssessment(domain);

  if (data === null) {
    return {
      ...generateStubThreatAssessment(domain),
      stub: true,
    };
  }

  return {
    ...data,
    stub: false,
  };
}
