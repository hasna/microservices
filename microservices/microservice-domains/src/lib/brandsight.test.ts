import { describe, test, expect, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-domains-brandsight-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;
process.env["BRANDSIGHT_API_KEY"] = "test-brandsight-key";

import {
  monitorBrand,
  getSimilarDomains,
  getWhoisHistory,
  getThreatAssessment,
  getApiKey,
  BrandsightApiError,
  _setFetch,
} from "./brandsight";
import { closeDatabase } from "../db/database";

afterAll(() => {
  closeDatabase();
  _setFetch(null);
  rmSync(tempDir, { recursive: true, force: true });
});

// Helper: mock fetch returning JSON data
function mockFetch(responseData: unknown, status = 200): typeof globalThis.fetch {
  return (async (_url: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify(responseData), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

// Helper: mock fetch that throws (simulating network unreachable)
function mockFetchUnreachable(): typeof globalThis.fetch {
  return (async (_url: RequestInfo | URL, _init?: RequestInit) => {
    throw new Error("fetch failed: ECONNREFUSED");
  }) as typeof globalThis.fetch;
}

// ============================================================
// getApiKey
// ============================================================

describe("Brandsight — getApiKey", () => {
  test("returns API key when set", () => {
    expect(getApiKey()).toBe("test-brandsight-key");
  });

  test("throws BrandsightApiError when not set", () => {
    const saved = process.env["BRANDSIGHT_API_KEY"];
    delete process.env["BRANDSIGHT_API_KEY"];
    try {
      expect(() => getApiKey()).toThrow(BrandsightApiError);
    } finally {
      process.env["BRANDSIGHT_API_KEY"] = saved;
    }
  });
});

// ============================================================
// monitorBrand
// ============================================================

describe("Brandsight — monitorBrand", () => {
  test("returns live data when API responds", async () => {
    const mockAlerts = [
      { domain: "acme-deals.com", type: "keyword", registered_at: "2026-01-01T00:00:00Z" },
    ];
    _setFetch(mockFetch({ alerts: mockAlerts }));

    const result = await monitorBrand("acme");
    expect(result.brand).toBe("acme");
    expect(result.stub).toBe(false);
    expect(result.alerts).toEqual(mockAlerts);
  });

  test("returns stub data when API is unreachable", async () => {
    _setFetch(mockFetchUnreachable());

    const result = await monitorBrand("acme");
    expect(result.brand).toBe("acme");
    expect(result.stub).toBe(true);
    expect(result.alerts.length).toBeGreaterThan(0);
    // Stub alerts should reference the brand name
    expect(result.alerts.some((a) => a.domain.includes("acme"))).toBe(true);
  });

  test("throws when API returns error status", async () => {
    _setFetch(mockFetch({ error: "forbidden" }, 403));

    try {
      await monitorBrand("acme");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(BrandsightApiError);
      expect((err as BrandsightApiError).statusCode).toBe(403);
    }
  });
});

// ============================================================
// getSimilarDomains
// ============================================================

describe("Brandsight — getSimilarDomains", () => {
  test("returns live similar domains when API responds", async () => {
    _setFetch(mockFetch({ similar: ["examp1e.com", "exampl3.com"] }));

    const result = await getSimilarDomains("example.com");
    expect(result.domain).toBe("example.com");
    expect(result.stub).toBe(false);
    expect(result.similar).toEqual(["examp1e.com", "exampl3.com"]);
  });

  test("returns stub similar domains when API is unreachable", async () => {
    _setFetch(mockFetchUnreachable());

    const result = await getSimilarDomains("example.com");
    expect(result.domain).toBe("example.com");
    expect(result.stub).toBe(true);
    expect(result.similar.length).toBeGreaterThan(0);
  });
});

// ============================================================
// getWhoisHistory
// ============================================================

describe("Brandsight — getWhoisHistory", () => {
  test("returns live WHOIS history when API responds", async () => {
    const mockHistory = [
      { registrant: "New Owner", date: "2025-06-01T00:00:00Z", changes: ["registrant_changed"] },
    ];
    _setFetch(mockFetch({ history: mockHistory }));

    const result = await getWhoisHistory("example.com");
    expect(result.domain).toBe("example.com");
    expect(result.stub).toBe(false);
    expect(result.history).toEqual(mockHistory);
  });

  test("returns stub WHOIS history when API is unreachable", async () => {
    _setFetch(mockFetchUnreachable());

    const result = await getWhoisHistory("example.com");
    expect(result.domain).toBe("example.com");
    expect(result.stub).toBe(true);
    expect(result.history.length).toBeGreaterThan(0);
    expect(result.history[0]).toHaveProperty("registrant");
    expect(result.history[0]).toHaveProperty("date");
    expect(result.history[0]).toHaveProperty("changes");
  });
});

// ============================================================
// getThreatAssessment
// ============================================================

describe("Brandsight — getThreatAssessment", () => {
  test("returns live threat assessment when API responds", async () => {
    const mockThreat = {
      domain: "evil-example.com",
      risk_level: "high",
      threats: ["phishing", "brand_impersonation"],
      recommendation: "Take down immediately",
    };
    _setFetch(mockFetch(mockThreat));

    const result = await getThreatAssessment("evil-example.com");
    expect(result.domain).toBe("evil-example.com");
    expect(result.stub).toBe(false);
    expect(result.risk_level).toBe("high");
    expect(result.threats).toEqual(["phishing", "brand_impersonation"]);
    expect(result.recommendation).toBe("Take down immediately");
  });

  test("returns stub threat assessment when API is unreachable", async () => {
    _setFetch(mockFetchUnreachable());

    const result = await getThreatAssessment("example.com");
    expect(result.domain).toBe("example.com");
    expect(result.stub).toBe(true);
    expect(result.risk_level).toBe("low");
    expect(result.threats).toEqual([]);
    expect(result.recommendation).toBeTruthy();
  });

  test("throws when API key is not set", async () => {
    const saved = process.env["BRANDSIGHT_API_KEY"];
    delete process.env["BRANDSIGHT_API_KEY"];
    _setFetch(mockFetch({}));

    try {
      await getThreatAssessment("example.com");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(BrandsightApiError);
      expect((err as Error).message).toContain("BRANDSIGHT_API_KEY");
    } finally {
      process.env["BRANDSIGHT_API_KEY"] = saved;
    }
  });
});
