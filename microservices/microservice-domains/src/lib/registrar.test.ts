import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-domains-registrar-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  getProvider,
  getAvailableProviders,
  syncAll,
  autoDetectRegistrar,
  type DbFunctions,
  type ProviderSyncResult,
} from "./registrar";
import type { Domain } from "../db/domains";
import { closeDatabase } from "../db/database";
import { _setFetch as setGoDaddyFetch } from "./godaddy";

afterAll(() => {
  closeDatabase();
  setGoDaddyFetch(null);
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================
// getProvider
// ============================================================

describe("registrar — getProvider", () => {
  test("returns a namecheap provider", () => {
    const provider = getProvider("namecheap");
    expect(provider.name).toBe("namecheap");
  });

  test("returns a godaddy provider", () => {
    const provider = getProvider("godaddy");
    expect(provider.name).toBe("godaddy");
  });

  test("throws for unknown provider", () => {
    expect(() => getProvider("unknown" as any)).toThrow("Unknown registrar provider");
  });
});

// ============================================================
// getAvailableProviders
// ============================================================

describe("registrar — getAvailableProviders", () => {
  test("returns all three providers", () => {
    const providers = getAvailableProviders();
    expect(providers).toHaveLength(3);
    expect(providers.map((p) => p.name)).toEqual(["namecheap", "godaddy", "brandsight"]);
  });

  test("detects namecheap as configured when env vars are set", () => {
    const saved = {
      key: process.env["NAMECHEAP_API_KEY"],
      user: process.env["NAMECHEAP_USERNAME"],
      ip: process.env["NAMECHEAP_CLIENT_IP"],
    };
    process.env["NAMECHEAP_API_KEY"] = "test";
    process.env["NAMECHEAP_USERNAME"] = "test";
    process.env["NAMECHEAP_CLIENT_IP"] = "1.2.3.4";

    const providers = getAvailableProviders();
    const nc = providers.find((p) => p.name === "namecheap")!;
    expect(nc.configured).toBe(true);

    // Restore
    if (saved.key) process.env["NAMECHEAP_API_KEY"] = saved.key;
    else delete process.env["NAMECHEAP_API_KEY"];
    if (saved.user) process.env["NAMECHEAP_USERNAME"] = saved.user;
    else delete process.env["NAMECHEAP_USERNAME"];
    if (saved.ip) process.env["NAMECHEAP_CLIENT_IP"] = saved.ip;
    else delete process.env["NAMECHEAP_CLIENT_IP"];
  });

  test("detects godaddy as configured when env vars are set", () => {
    const saved = {
      key: process.env["GODADDY_API_KEY"],
      secret: process.env["GODADDY_API_SECRET"],
    };
    process.env["GODADDY_API_KEY"] = "test";
    process.env["GODADDY_API_SECRET"] = "test";

    const providers = getAvailableProviders();
    const gd = providers.find((p) => p.name === "godaddy")!;
    expect(gd.configured).toBe(true);

    if (saved.key) process.env["GODADDY_API_KEY"] = saved.key;
    else delete process.env["GODADDY_API_KEY"];
    if (saved.secret) process.env["GODADDY_API_SECRET"] = saved.secret;
    else delete process.env["GODADDY_API_SECRET"];
  });

  test("detects brandsight as configured when env var is set", () => {
    const saved = process.env["BRANDSIGHT_API_KEY"];
    process.env["BRANDSIGHT_API_KEY"] = "test";

    const providers = getAvailableProviders();
    const bs = providers.find((p) => p.name === "brandsight")!;
    expect(bs.configured).toBe(true);

    if (saved) process.env["BRANDSIGHT_API_KEY"] = saved;
    else delete process.env["BRANDSIGHT_API_KEY"];
  });

  test("reports unconfigured when env vars missing", () => {
    const saved = {
      ncKey: process.env["NAMECHEAP_API_KEY"],
      ncUser: process.env["NAMECHEAP_USERNAME"],
      ncIp: process.env["NAMECHEAP_CLIENT_IP"],
      gdKey: process.env["GODADDY_API_KEY"],
      gdSecret: process.env["GODADDY_API_SECRET"],
      bsKey: process.env["BRANDSIGHT_API_KEY"],
    };

    delete process.env["NAMECHEAP_API_KEY"];
    delete process.env["NAMECHEAP_USERNAME"];
    delete process.env["NAMECHEAP_CLIENT_IP"];
    delete process.env["GODADDY_API_KEY"];
    delete process.env["GODADDY_API_SECRET"];
    delete process.env["BRANDSIGHT_API_KEY"];

    const providers = getAvailableProviders();
    for (const p of providers) {
      expect(p.configured).toBe(false);
    }

    // Restore
    if (saved.ncKey) process.env["NAMECHEAP_API_KEY"] = saved.ncKey;
    if (saved.ncUser) process.env["NAMECHEAP_USERNAME"] = saved.ncUser;
    if (saved.ncIp) process.env["NAMECHEAP_CLIENT_IP"] = saved.ncIp;
    if (saved.gdKey) process.env["GODADDY_API_KEY"] = saved.gdKey;
    if (saved.gdSecret) process.env["GODADDY_API_SECRET"] = saved.gdSecret;
    if (saved.bsKey) process.env["BRANDSIGHT_API_KEY"] = saved.bsKey;
  });
});

// ============================================================
// autoDetectRegistrar
// ============================================================

describe("registrar — autoDetectRegistrar", () => {
  const fakeDomain = (registrar: string | null): Domain => ({
    id: "test-id",
    name: "example.com",
    registrar,
    status: "active",
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
  });

  test("detects namecheap from registrar field", () => {
    const result = autoDetectRegistrar("example.com", () => fakeDomain("Namecheap"));
    expect(result).toBe("namecheap");
  });

  test("detects godaddy from registrar field", () => {
    const result = autoDetectRegistrar("example.com", () => fakeDomain("GoDaddy"));
    expect(result).toBe("godaddy");
  });

  test("detects godaddy case-insensitively", () => {
    const result = autoDetectRegistrar("example.com", () => fakeDomain("GODADDY INC."));
    expect(result).toBe("godaddy");
  });

  test("returns null for unknown registrar", () => {
    const result = autoDetectRegistrar("example.com", () => fakeDomain("SomeOtherRegistrar"));
    expect(result).toBeNull();
  });

  test("returns null when domain not in DB", () => {
    const result = autoDetectRegistrar("unknown.com", () => null);
    expect(result).toBeNull();
  });

  test("returns null when registrar field is null", () => {
    const result = autoDetectRegistrar("example.com", () => fakeDomain(null));
    expect(result).toBeNull();
  });
});

// ============================================================
// syncAll
// ============================================================

describe("registrar — syncAll", () => {
  test("returns empty result when no providers are configured", async () => {
    const saved = {
      ncKey: process.env["NAMECHEAP_API_KEY"],
      ncUser: process.env["NAMECHEAP_USERNAME"],
      ncIp: process.env["NAMECHEAP_CLIENT_IP"],
      gdKey: process.env["GODADDY_API_KEY"],
      gdSecret: process.env["GODADDY_API_SECRET"],
    };

    delete process.env["NAMECHEAP_API_KEY"];
    delete process.env["NAMECHEAP_USERNAME"];
    delete process.env["NAMECHEAP_CLIENT_IP"];
    delete process.env["GODADDY_API_KEY"];
    delete process.env["GODADDY_API_SECRET"];

    const mockDbFns: DbFunctions = {
      getDomainByName: () => null,
      createDomain: (input) => ({
        id: "new-id",
        name: input.name,
        registrar: input.registrar || null,
        status: (input.status as any) || "active",
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
      }),
      updateDomain: () => null,
    };

    const result = await syncAll(mockDbFns);
    expect(result.totalSynced).toBe(0);
    expect(result.providers).toHaveLength(0);

    // Restore
    if (saved.ncKey) process.env["NAMECHEAP_API_KEY"] = saved.ncKey;
    if (saved.ncUser) process.env["NAMECHEAP_USERNAME"] = saved.ncUser;
    if (saved.ncIp) process.env["NAMECHEAP_CLIENT_IP"] = saved.ncIp;
    if (saved.gdKey) process.env["GODADDY_API_KEY"] = saved.gdKey;
    if (saved.gdSecret) process.env["GODADDY_API_SECRET"] = saved.gdSecret;
  });

  test("syncs from godaddy when configured", async () => {
    const saved = {
      ncKey: process.env["NAMECHEAP_API_KEY"],
      ncUser: process.env["NAMECHEAP_USERNAME"],
      ncIp: process.env["NAMECHEAP_CLIENT_IP"],
      gdKey: process.env["GODADDY_API_KEY"],
      gdSecret: process.env["GODADDY_API_SECRET"],
    };

    // Only configure GoDaddy
    delete process.env["NAMECHEAP_API_KEY"];
    delete process.env["NAMECHEAP_USERNAME"];
    delete process.env["NAMECHEAP_CLIENT_IP"];
    process.env["GODADDY_API_KEY"] = "test-key";
    process.env["GODADDY_API_SECRET"] = "test-secret";

    // Mock GoDaddy API to return a domain list
    setGoDaddyFetch((async (url: RequestInfo | URL, _init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.endsWith("/v1/domains")) {
        return new Response(
          JSON.stringify([
            {
              domain: "synced.com",
              status: "ACTIVE",
              expires: "2028-01-01T00:00:00Z",
              renewAuto: true,
              nameServers: ["ns1.example.com"],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      // Detail endpoint — 404 to fall back
      return new Response('{"code":"NOT_FOUND"}', { status: 404 });
    }) as typeof globalThis.fetch);

    const created: string[] = [];
    const mockDbFns: DbFunctions = {
      getDomainByName: () => null,
      createDomain: (input) => {
        created.push(input.name);
        return {
          id: crypto.randomUUID(),
          name: input.name,
          registrar: input.registrar || null,
          status: (input.status as any) || "active",
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
      },
      updateDomain: () => null,
    };

    const result = await syncAll(mockDbFns);
    expect(result.totalSynced).toBe(1);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].name).toBe("godaddy");
    expect(created).toContain("synced.com");

    // Restore
    if (saved.ncKey) process.env["NAMECHEAP_API_KEY"] = saved.ncKey;
    if (saved.ncUser) process.env["NAMECHEAP_USERNAME"] = saved.ncUser;
    if (saved.ncIp) process.env["NAMECHEAP_CLIENT_IP"] = saved.ncIp;
    if (saved.gdKey) process.env["GODADDY_API_KEY"] = saved.gdKey;
    else delete process.env["GODADDY_API_KEY"];
    if (saved.gdSecret) process.env["GODADDY_API_SECRET"] = saved.gdSecret;
    else delete process.env["GODADDY_API_SECRET"];

    setGoDaddyFetch(null);
  });
});
