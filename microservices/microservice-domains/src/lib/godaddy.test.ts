import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-domains-godaddy-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;
process.env["GODADDY_API_KEY"] = "test-key";
process.env["GODADDY_API_SECRET"] = "test-secret";

import {
  listGoDaddyDomains,
  getDomainInfo,
  renewDomain,
  getDnsRecords,
  setDnsRecords,
  checkAvailability,
  syncToLocalDb,
  GoDaddyApiError,
  _setFetch,
  type GoDaddyDomain,
  type GoDaddyDomainDetail,
  type GoDaddyDnsRecord,
  type GoDaddyAvailability,
} from "./godaddy";
import {
  createDomain,
  getDomainByName,
  updateDomain,
} from "../db/domains";
import { closeDatabase } from "../db/database";

afterAll(() => {
  closeDatabase();
  _setFetch(null);
  rmSync(tempDir, { recursive: true, force: true });
});

// Helper to create a mock fetch that returns specific data
function mockFetch(responseData: unknown, status = 200): typeof globalThis.fetch {
  return (async (_url: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(
      status === 204 ? null : JSON.stringify(responseData),
      {
        status,
        headers: { "Content-Type": "application/json" },
      }
    );
  }) as typeof globalThis.fetch;
}

function mockFetchError(statusCode: number, body: string): typeof globalThis.fetch {
  return (async (_url: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(body, {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

// ============================================================
// Mock API responses
// ============================================================

const MOCK_DOMAINS: GoDaddyDomain[] = [
  {
    domain: "example.com",
    status: "ACTIVE",
    expires: "2027-03-15T00:00:00Z",
    renewAuto: true,
    nameServers: ["ns1.godaddy.com", "ns2.godaddy.com"],
  },
  {
    domain: "expired-domain.com",
    status: "EXPIRED",
    expires: "2025-01-01T00:00:00Z",
    renewAuto: false,
    nameServers: ["ns1.godaddy.com"],
  },
];

const MOCK_DOMAIN_DETAIL: GoDaddyDomainDetail = {
  domain: "example.com",
  domainId: 12345,
  status: "ACTIVE",
  expires: "2027-03-15T00:00:00Z",
  renewAuto: true,
  nameServers: ["ns1.godaddy.com", "ns2.godaddy.com"],
  createdAt: "2020-01-10T00:00:00Z",
  expirationProtected: false,
  holdRegistrar: false,
  locked: true,
  privacy: true,
  registrarCreatedAt: "2020-01-10T00:00:00Z",
  renewDeadline: "2027-04-14T00:00:00Z",
  transferProtected: true,
};

const MOCK_DNS_RECORDS: GoDaddyDnsRecord[] = [
  { type: "A", name: "@", data: "93.184.216.34", ttl: 3600 },
  { type: "CNAME", name: "www", data: "example.com", ttl: 3600 },
  { type: "MX", name: "@", data: "mail.example.com", ttl: 3600, priority: 10 },
];

const MOCK_AVAILABILITY: GoDaddyAvailability = {
  available: true,
  domain: "newdomain.com",
  definitive: true,
  price: 999,
  currency: "USD",
  period: 1,
};

const MOCK_RENEW_RESPONSE = {
  orderId: 99999,
  itemCount: 1,
  total: 1299,
};

// ============================================================
// Tests
// ============================================================

describe("GoDaddy API — listGoDaddyDomains", () => {
  test("parses domain list response correctly", async () => {
    _setFetch(mockFetch(MOCK_DOMAINS));

    const domains = await listGoDaddyDomains();
    expect(domains).toHaveLength(2);
    expect(domains[0].domain).toBe("example.com");
    expect(domains[0].status).toBe("ACTIVE");
    expect(domains[0].renewAuto).toBe(true);
    expect(domains[0].nameServers).toEqual(["ns1.godaddy.com", "ns2.godaddy.com"]);
    expect(domains[1].domain).toBe("expired-domain.com");
    expect(domains[1].status).toBe("EXPIRED");
  });
});

describe("GoDaddy API — getDomainInfo", () => {
  test("parses detailed domain info", async () => {
    _setFetch(mockFetch(MOCK_DOMAIN_DETAIL));

    const detail = await getDomainInfo("example.com");
    expect(detail.domain).toBe("example.com");
    expect(detail.domainId).toBe(12345);
    expect(detail.locked).toBe(true);
    expect(detail.privacy).toBe(true);
    expect(detail.createdAt).toBe("2020-01-10T00:00:00Z");
    expect(detail.renewDeadline).toBe("2027-04-14T00:00:00Z");
  });
});

describe("GoDaddy API — renewDomain", () => {
  test("sends renew request and parses response", async () => {
    let capturedBody: string | undefined;
    const fn = async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify(MOCK_RENEW_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    _setFetch(fn as typeof globalThis.fetch);

    const result = await renewDomain("example.com");
    expect(result.orderId).toBe(99999);
    expect(result.total).toBe(1299);
    expect(JSON.parse(capturedBody!)).toEqual({ period: 1 });
  });
});

describe("GoDaddy API — getDnsRecords", () => {
  test("fetches all DNS records", async () => {
    _setFetch(mockFetch(MOCK_DNS_RECORDS));

    const records = await getDnsRecords("example.com");
    expect(records).toHaveLength(3);
    expect(records[0].type).toBe("A");
    expect(records[0].data).toBe("93.184.216.34");
    expect(records[2].type).toBe("MX");
    expect(records[2].priority).toBe(10);
  });

  test("fetches DNS records filtered by type", async () => {
    let capturedUrl = "";
    const fn = async (url: RequestInfo | URL, _init?: RequestInit) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify([MOCK_DNS_RECORDS[0]]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    _setFetch(fn as typeof globalThis.fetch);

    const records = await getDnsRecords("example.com", "A");
    expect(records).toHaveLength(1);
    expect(capturedUrl).toContain("/records/A");
  });
});

describe("GoDaddy API — setDnsRecords", () => {
  test("sends PUT with records body", async () => {
    let capturedMethod = "";
    let capturedBody: string | undefined;
    const fn = async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method || "";
      capturedBody = init?.body as string;
      return new Response(null, { status: 204 });
    };
    _setFetch(fn as typeof globalThis.fetch);

    await setDnsRecords("example.com", MOCK_DNS_RECORDS);
    expect(capturedMethod).toBe("PUT");
    expect(JSON.parse(capturedBody!)).toEqual(MOCK_DNS_RECORDS);
  });
});

describe("GoDaddy API — checkAvailability", () => {
  test("parses availability response", async () => {
    _setFetch(mockFetch(MOCK_AVAILABILITY));

    const result = await checkAvailability("newdomain.com");
    expect(result.available).toBe(true);
    expect(result.domain).toBe("newdomain.com");
    expect(result.price).toBe(999);
    expect(result.currency).toBe("USD");
  });
});

describe("GoDaddy API — error handling", () => {
  test("throws GoDaddyApiError on non-OK response", async () => {
    _setFetch(mockFetchError(403, '{"code":"ACCESS_DENIED","message":"Forbidden"}'));

    try {
      await listGoDaddyDomains();
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(GoDaddyApiError);
      const apiErr = err as GoDaddyApiError;
      expect(apiErr.statusCode).toBe(403);
      expect(apiErr.responseBody).toContain("ACCESS_DENIED");
    }
  });

  test("throws GoDaddyApiError on 404 for domain info", async () => {
    _setFetch(mockFetchError(404, '{"code":"NOT_FOUND","message":"Domain not found"}'));

    try {
      await getDomainInfo("nonexistent.com");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(GoDaddyApiError);
      expect((err as GoDaddyApiError).statusCode).toBe(404);
    }
  });

  test("throws when credentials are not set", async () => {
    const savedKey = process.env["GODADDY_API_KEY"];
    const savedSecret = process.env["GODADDY_API_SECRET"];
    delete process.env["GODADDY_API_KEY"];
    delete process.env["GODADDY_API_SECRET"];

    try {
      await listGoDaddyDomains();
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("GODADDY_API_KEY");
    } finally {
      process.env["GODADDY_API_KEY"] = savedKey;
      process.env["GODADDY_API_SECRET"] = savedSecret;
    }
  });
});

describe("GoDaddy API — syncToLocalDb", () => {
  beforeEach(() => {
    // Set up mock fetch that returns both list and detail
    const fn = async (url: RequestInfo | URL, _init?: RequestInit) => {
      const urlStr = url.toString();

      // Domain detail for example.com (check before list to avoid substring match)
      if (urlStr.match(/\/v1\/domains\/example\.com$/)) {
        return new Response(JSON.stringify(MOCK_DOMAIN_DETAIL), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Domain detail for expired-domain.com
      if (urlStr.match(/\/v1\/domains\/expired-domain\.com$/)) {
        return new Response(
          JSON.stringify({
            ...MOCK_DOMAIN_DETAIL,
            domain: "expired-domain.com",
            domainId: 54321,
            status: "EXPIRED",
            expires: "2025-01-01T00:00:00Z",
            renewAuto: false,
            nameServers: ["ns1.godaddy.com"],
            createdAt: "2019-06-01T00:00:00Z",
            locked: false,
            privacy: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // List domains (exact path match)
      if (urlStr.match(/\/v1\/domains$/)) {
        return new Response(JSON.stringify(MOCK_DOMAINS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response('{"code":"NOT_FOUND"}', { status: 404 });
    };
    _setFetch(fn as typeof globalThis.fetch);
  });

  test("creates new domains when none exist locally", async () => {
    const result = await syncToLocalDb({
      getDomainByName: () => null,
      createDomain,
      updateDomain,
    });

    expect(result.synced).toBe(2);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test("updates existing domains", async () => {
    // Use fully mocked DB functions to avoid UNIQUE constraint issues from prior tests
    const createdNames: string[] = [];
    const updatedNames: string[] = [];
    const fakeDomain = {
      id: "fake-id-123",
      name: "example.com",
      registrar: "Other",
      status: "active" as const,
      registered_at: null,
      expires_at: null,
      auto_renew: true,
      nameservers: [],
      whois: {},
      ssl_expires_at: null,
      ssl_issuer: null,
      notes: null,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const result = await syncToLocalDb({
      getDomainByName: (name: string) =>
        name === "example.com" ? fakeDomain : null,
      createDomain: (input) => {
        createdNames.push(input.name);
        return { ...fakeDomain, id: crypto.randomUUID(), name: input.name };
      },
      updateDomain: (id, input) => {
        updatedNames.push(input.name || id);
        return { ...fakeDomain, id };
      },
    });

    expect(result.synced).toBe(2);
    expect(result.updated).toBe(1); // example.com was "found"
    expect(result.created).toBe(1); // expired-domain.com was new
    expect(result.errors).toHaveLength(0);
    expect(updatedNames).toContain("example.com");
    expect(createdNames).toContain("expired-domain.com");
  });

  test("handles API errors gracefully during sync", async () => {
    _setFetch(mockFetchError(500, '{"message":"Internal Server Error"}'));

    const result = await syncToLocalDb({
      getDomainByName: () => null,
      createDomain,
      updateDomain,
    });

    expect(result.synced).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Failed to list domains");
  });

  test("maps GoDaddy statuses correctly", async () => {
    const statusDomains: GoDaddyDomain[] = [
      { domain: "active.com", status: "ACTIVE", expires: "2028-01-01T00:00:00Z", renewAuto: true, nameServers: [] },
      { domain: "transferred.com", status: "TRANSFERRED_OUT", expires: "2028-01-01T00:00:00Z", renewAuto: false, nameServers: [] },
      { domain: "redemption.com", status: "PENDING_REDEMPTION", expires: "2025-01-01T00:00:00Z", renewAuto: false, nameServers: [] },
    ];

    let listCallDone = false;
    const fn = async (url: RequestInfo | URL, _init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.endsWith("/v1/domains") && !listCallDone) {
        listCallDone = true;
        return new Response(JSON.stringify(statusDomains), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Detail calls — return 404 so it falls back to list data
      return new Response('{"code":"NOT_FOUND"}', { status: 404 });
    };
    _setFetch(fn as typeof globalThis.fetch);

    const created: Array<{ name: string; status: string }> = [];
    const result = await syncToLocalDb({
      getDomainByName: () => null,
      createDomain: (input) => {
        created.push({ name: input.name, status: input.status || "active" });
        return createDomain(input);
      },
      updateDomain,
    });

    expect(result.synced).toBe(3);
    expect(created.find((d) => d.name === "active.com")?.status).toBe("active");
    expect(created.find((d) => d.name === "transferred.com")?.status).toBe("transferring");
    expect(created.find((d) => d.name === "redemption.com")?.status).toBe("redemption");
  });
});
