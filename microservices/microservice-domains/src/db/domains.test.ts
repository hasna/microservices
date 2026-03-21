import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-domains-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createDomain,
  getDomain,
  listDomains,
  updateDomain,
  deleteDomain,
  countDomains,
  searchDomains,
  getByRegistrar,
  listExpiring,
  listSslExpiring,
  getDomainStats,
  createDnsRecord,
  getDnsRecord,
  listDnsRecords,
  updateDnsRecord,
  deleteDnsRecord,
  createAlert,
  getAlert,
  listAlerts,
  deleteAlert,
} from "./domains";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Domains", () => {
  test("create and get domain", () => {
    const domain = createDomain({
      name: "example.com",
      registrar: "Namecheap",
      status: "active",
      registered_at: "2020-01-01T00:00:00Z",
      expires_at: "2030-01-01T00:00:00Z",
      nameservers: ["ns1.example.com", "ns2.example.com"],
    });

    expect(domain.id).toBeTruthy();
    expect(domain.name).toBe("example.com");
    expect(domain.registrar).toBe("Namecheap");
    expect(domain.status).toBe("active");
    expect(domain.auto_renew).toBe(true);
    expect(domain.nameservers).toEqual(["ns1.example.com", "ns2.example.com"]);

    const fetched = getDomain(domain.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(domain.id);
    expect(fetched!.name).toBe("example.com");
  });

  test("create domain with defaults", () => {
    const domain = createDomain({ name: "minimal.io" });
    expect(domain.status).toBe("active");
    expect(domain.auto_renew).toBe(true);
    expect(domain.nameservers).toEqual([]);
    expect(domain.metadata).toEqual({});
  });

  test("domain name is unique", () => {
    expect(() => createDomain({ name: "example.com" })).toThrow();
  });

  test("list domains", () => {
    createDomain({ name: "another.org", registrar: "GoDaddy" });
    const all = listDomains();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("list domains with status filter", () => {
    createDomain({ name: "transferring.net", status: "transferring" });
    const result = listDomains({ status: "transferring" });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("transferring.net");
  });

  test("list domains with registrar filter", () => {
    const result = listDomains({ registrar: "GoDaddy" });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("another.org");
  });

  test("search domains", () => {
    const results = searchDomains("example");
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("example.com");
  });

  test("get by registrar", () => {
    const results = getByRegistrar("Namecheap");
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("example.com");
  });

  test("update domain", () => {
    const domain = createDomain({ name: "update-test.com" });
    const updated = updateDomain(domain.id, {
      registrar: "Cloudflare",
      status: "expired",
      auto_renew: false,
      notes: "Updated domain",
    });

    expect(updated).toBeDefined();
    expect(updated!.registrar).toBe("Cloudflare");
    expect(updated!.status).toBe("expired");
    expect(updated!.auto_renew).toBe(false);
    expect(updated!.notes).toBe("Updated domain");
  });

  test("update domain returns null for missing", () => {
    const result = updateDomain("nonexistent-id", { registrar: "Test" });
    expect(result).toBeNull();
  });

  test("update domain with no changes returns existing", () => {
    const domain = createDomain({ name: "nochange.com" });
    const result = updateDomain(domain.id, {});
    expect(result).toBeDefined();
    expect(result!.id).toBe(domain.id);
  });

  test("delete domain", () => {
    const domain = createDomain({ name: "deleteme.com" });
    expect(deleteDomain(domain.id)).toBe(true);
    expect(getDomain(domain.id)).toBeNull();
  });

  test("delete non-existent domain returns false", () => {
    expect(deleteDomain("nonexistent-id")).toBe(false);
  });

  test("count domains", () => {
    const count = countDomains();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test("list expiring domains", () => {
    // Create a domain expiring in 10 days
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    createDomain({
      name: "expiring-soon.com",
      expires_at: futureDate.toISOString(),
    });

    const expiring = listExpiring(30);
    expect(expiring.some((d) => d.name === "expiring-soon.com")).toBe(true);

    // Shouldn't show for 5-day window
    const expiringShort = listExpiring(5);
    expect(expiringShort.some((d) => d.name === "expiring-soon.com")).toBe(false);
  });

  test("list SSL expiring domains", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    createDomain({
      name: "ssl-expiring.com",
      ssl_expires_at: futureDate.toISOString(),
      ssl_issuer: "Let's Encrypt",
    });

    const sslExpiring = listSslExpiring(30);
    expect(sslExpiring.some((d) => d.name === "ssl-expiring.com")).toBe(true);
  });

  test("get domain stats", () => {
    const stats = getDomainStats();
    expect(stats.total).toBeGreaterThanOrEqual(5);
    expect(stats.active).toBeGreaterThanOrEqual(1);
    expect(typeof stats.expired).toBe("number");
    expect(typeof stats.transferring).toBe("number");
    expect(typeof stats.redemption).toBe("number");
    expect(typeof stats.auto_renew_enabled).toBe("number");
    expect(typeof stats.expiring_30_days).toBe("number");
    expect(typeof stats.ssl_expiring_30_days).toBe("number");
  });
});

describe("DNS Records", () => {
  let domainId: string;

  test("setup: create domain for DNS tests", () => {
    const domain = createDomain({ name: "dns-test.com" });
    domainId = domain.id;
    expect(domainId).toBeTruthy();
  });

  test("create and get DNS record", () => {
    const record = createDnsRecord({
      domain_id: domainId,
      type: "A",
      name: "@",
      value: "192.168.1.1",
      ttl: 300,
    });

    expect(record.id).toBeTruthy();
    expect(record.type).toBe("A");
    expect(record.name).toBe("@");
    expect(record.value).toBe("192.168.1.1");
    expect(record.ttl).toBe(300);

    const fetched = getDnsRecord(record.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(record.id);
  });

  test("create MX record with priority", () => {
    const record = createDnsRecord({
      domain_id: domainId,
      type: "MX",
      name: "@",
      value: "mail.dns-test.com",
      priority: 10,
    });

    expect(record.priority).toBe(10);
    expect(record.type).toBe("MX");
  });

  test("list DNS records for domain", () => {
    const records = listDnsRecords(domainId);
    expect(records.length).toBeGreaterThanOrEqual(2);
  });

  test("list DNS records filtered by type", () => {
    const aRecords = listDnsRecords(domainId, "A");
    expect(aRecords.length).toBe(1);
    expect(aRecords[0].type).toBe("A");
  });

  test("update DNS record", () => {
    const record = createDnsRecord({
      domain_id: domainId,
      type: "CNAME",
      name: "www",
      value: "dns-test.com",
    });

    const updated = updateDnsRecord(record.id, {
      value: "cdn.dns-test.com",
      ttl: 600,
    });

    expect(updated).toBeDefined();
    expect(updated!.value).toBe("cdn.dns-test.com");
    expect(updated!.ttl).toBe(600);
  });

  test("update non-existent DNS record returns null", () => {
    const result = updateDnsRecord("nonexistent-id", { value: "test" });
    expect(result).toBeNull();
  });

  test("delete DNS record", () => {
    const record = createDnsRecord({
      domain_id: domainId,
      type: "TXT",
      name: "@",
      value: "v=spf1 include:_spf.google.com ~all",
    });

    expect(deleteDnsRecord(record.id)).toBe(true);
    expect(getDnsRecord(record.id)).toBeNull();
  });

  test("delete non-existent DNS record returns false", () => {
    expect(deleteDnsRecord("nonexistent-id")).toBe(false);
  });

  test("cascade delete: removing domain deletes DNS records", () => {
    const domain = createDomain({ name: "cascade-dns.com" });
    const record = createDnsRecord({
      domain_id: domain.id,
      type: "A",
      name: "@",
      value: "10.0.0.1",
    });

    deleteDomain(domain.id);
    expect(getDnsRecord(record.id)).toBeNull();
  });
});

describe("Alerts", () => {
  let domainId: string;

  test("setup: create domain for alert tests", () => {
    const domain = createDomain({ name: "alert-test.com" });
    domainId = domain.id;
    expect(domainId).toBeTruthy();
  });

  test("create and get alert", () => {
    const alert = createAlert({
      domain_id: domainId,
      type: "expiry",
      trigger_days_before: 30,
    });

    expect(alert.id).toBeTruthy();
    expect(alert.type).toBe("expiry");
    expect(alert.trigger_days_before).toBe(30);
    expect(alert.sent_at).toBeNull();

    const fetched = getAlert(alert.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(alert.id);
  });

  test("create SSL expiry alert", () => {
    const alert = createAlert({
      domain_id: domainId,
      type: "ssl_expiry",
      trigger_days_before: 14,
    });

    expect(alert.type).toBe("ssl_expiry");
    expect(alert.trigger_days_before).toBe(14);
  });

  test("list alerts for domain", () => {
    const alerts = listAlerts(domainId);
    expect(alerts.length).toBeGreaterThanOrEqual(2);
  });

  test("delete alert", () => {
    const alert = createAlert({
      domain_id: domainId,
      type: "dns_change",
    });

    expect(deleteAlert(alert.id)).toBe(true);
    expect(getAlert(alert.id)).toBeNull();
  });

  test("delete non-existent alert returns false", () => {
    expect(deleteAlert("nonexistent-id")).toBe(false);
  });

  test("cascade delete: removing domain deletes alerts", () => {
    const domain = createDomain({ name: "cascade-alert.com" });
    const alert = createAlert({
      domain_id: domain.id,
      type: "expiry",
      trigger_days_before: 7,
    });

    deleteDomain(domain.id);
    expect(getAlert(alert.id)).toBeNull();
  });
});
