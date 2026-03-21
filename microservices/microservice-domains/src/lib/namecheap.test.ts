import { describe, test, expect, afterAll, beforeAll, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "namecheap-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  extractTag,
  extractAttribute,
  extractAllTags,
  extractAttributeFromElement,
  checkApiError,
  buildUrl,
  splitDomain,
  getConfig,
  listNamecheapDomains,
  getDomainInfo,
  renewDomain,
  getDnsRecords,
  setDnsRecords,
  checkAvailability,
  syncToLocalDb,
  type NamecheapConfig,
} from "./namecheap";

import {
  createDomain,
  getDomainByName,
  updateDomain,
} from "../db/domains";
import { closeDatabase } from "../db/database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================
// Mock XML Responses
// ============================================================

const DOMAIN_LIST_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response">
  <Errors/>
  <Warnings/>
  <RequestedCommand>namecheap.domains.getList</RequestedCommand>
  <CommandResponse Type="namecheap.domains.getList">
    <DomainListResult>
      <Domain ID="12345" Name="example.com" User="testuser" Created="01/01/2020" Expires="01/01/2025" IsExpired="false" IsLocked="true" AutoRenew="true" WhoisGuard="ENABLED"/>
      <Domain ID="12346" Name="mysite.org" User="testuser" Created="06/15/2019" Expires="06/15/2024" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="DISABLED"/>
    </DomainListResult>
    <Paging><TotalItems>2</TotalItems><CurrentPage>1</CurrentPage><PageSize>100</PageSize></Paging>
  </CommandResponse>
  <Server>API01</Server>
  <GMTTimeDifference>--5:00</GMTTimeDifference>
  <ExecutionTime>0.5</ExecutionTime>
</ApiResponse>`;

const DOMAIN_INFO_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response">
  <Errors/>
  <CommandResponse Type="namecheap.domains.getInfo">
    <DomainGetInfoResult Status="Ok" ID="12345" DomainName="example.com" OwnerName="testuser" IsOwner="true">
      <DomainDetails>
        <CreatedDate>01/01/2020</CreatedDate>
        <ExpiredDate>01/01/2025</ExpiredDate>
        <NumYears>0</NumYears>
      </DomainDetails>
      <Modificationrights All="true"/>
      <DnsDetails ProviderType="CUSTOM" IsUsingOurDNS="false">
        <Nameserver>ns1.cloudflare.com</Nameserver>
        <Nameserver>ns2.cloudflare.com</Nameserver>
      </DnsDetails>
    </DomainGetInfoResult>
  </CommandResponse>
</ApiResponse>`;

const RENEW_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response">
  <Errors/>
  <CommandResponse Type="namecheap.domains.renew">
    <DomainRenewResult DomainName="example.com" DomainID="12345" Renew="true" OrderID="98765" TransactionID="55555" ChargedAmount="10.87"/>
  </CommandResponse>
</ApiResponse>`;

const DNS_HOSTS_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response">
  <Errors/>
  <CommandResponse Type="namecheap.domains.dns.getHosts">
    <DomainDNSGetHostsResult Domain="example.com" IsUsingOurDNS="true">
      <host HostId="1" Name="@" Type="A" Address="1.2.3.4" MXPref="0" TTL="1800"/>
      <host HostId="2" Name="www" Type="CNAME" Address="example.com." MXPref="0" TTL="1800"/>
      <host HostId="3" Name="@" Type="MX" Address="mail.example.com." MXPref="10" TTL="1800"/>
    </DomainDNSGetHostsResult>
  </CommandResponse>
</ApiResponse>`;

const SET_HOSTS_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response">
  <Errors/>
  <CommandResponse Type="namecheap.domains.dns.setHosts">
    <DomainDNSSetHostsResult Domain="example.com" IsSuccess="true"/>
  </CommandResponse>
</ApiResponse>`;

const CHECK_AVAILABILITY_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response">
  <Errors/>
  <CommandResponse Type="namecheap.domains.check">
    <DomainCheckResult Domain="newdomain.com" Available="true" IsPremiumName="false"/>
  </CommandResponse>
</ApiResponse>`;

const CHECK_UNAVAILABLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response">
  <Errors/>
  <CommandResponse Type="namecheap.domains.check">
    <DomainCheckResult Domain="google.com" Available="false" IsPremiumName="false"/>
  </CommandResponse>
</ApiResponse>`;

const ERROR_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="ERROR" xmlns="http://api.namecheap.com/xml.response">
  <Errors>
    <Error Number="2030166">Domain name not found</Error>
  </Errors>
  <CommandResponse/>
</ApiResponse>`;

const ERROR_XML_WITH_MESSAGE = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="ERROR" xmlns="http://api.namecheap.com/xml.response">
  <Errors>
    <Err Number="1010101"><Message>Authentication failed</Message></Err>
  </Errors>
  <CommandResponse/>
</ApiResponse>`;

// ============================================================
// Test config
// ============================================================

const testConfig: NamecheapConfig = {
  apiKey: "test-api-key",
  username: "testuser",
  clientIp: "1.2.3.4",
  sandbox: false,
};

// ============================================================
// Tests
// ============================================================

describe("XML Parsing", () => {
  test("extractTag extracts inner text", () => {
    expect(extractTag(DOMAIN_INFO_XML, "CreatedDate")).toBe("01/01/2020");
    expect(extractTag(DOMAIN_INFO_XML, "ExpiredDate")).toBe("01/01/2025");
    expect(extractTag(DOMAIN_INFO_XML, "NumYears")).toBe("0");
  });

  test("extractTag returns null for missing tags", () => {
    expect(extractTag(DOMAIN_INFO_XML, "NonExistentTag")).toBeNull();
  });

  test("extractAttribute extracts attribute values", () => {
    expect(extractAttribute(DOMAIN_LIST_XML, "ApiResponse", "Status")).toBe("OK");
    expect(extractAttribute(RENEW_XML, "DomainRenewResult", "OrderID")).toBe("98765");
    expect(extractAttribute(RENEW_XML, "DomainRenewResult", "ChargedAmount")).toBe("10.87");
    expect(extractAttribute(RENEW_XML, "DomainRenewResult", "TransactionID")).toBe("55555");
  });

  test("extractAttribute returns null for missing attributes", () => {
    expect(extractAttribute(DOMAIN_LIST_XML, "ApiResponse", "FakeAttr")).toBeNull();
    expect(extractAttribute(DOMAIN_LIST_XML, "FakeTag", "Status")).toBeNull();
  });

  test("extractAllTags finds all matching elements", () => {
    const domains = extractAllTags(DOMAIN_LIST_XML, "Domain");
    expect(domains.length).toBe(2);

    const hosts = extractAllTags(DNS_HOSTS_XML, "host");
    expect(hosts.length).toBe(3);
  });

  test("extractAttributeFromElement extracts from a single element string", () => {
    const element = '<Domain ID="12345" Name="example.com" AutoRenew="true" IsLocked="true"/>';
    expect(extractAttributeFromElement(element, "Name")).toBe("example.com");
    expect(extractAttributeFromElement(element, "ID")).toBe("12345");
    expect(extractAttributeFromElement(element, "AutoRenew")).toBe("true");
    expect(extractAttributeFromElement(element, "IsLocked")).toBe("true");
    expect(extractAttributeFromElement(element, "FakeAttr")).toBeNull();
  });

  test("checkApiError throws on ERROR status", () => {
    expect(() => checkApiError(ERROR_XML)).toThrow("Namecheap API error");
    expect(() => checkApiError(DOMAIN_LIST_XML)).not.toThrow();
  });

  test("checkApiError includes error number", () => {
    try {
      checkApiError(ERROR_XML);
    } catch (e) {
      expect((e as Error).message).toContain("2030166");
    }
  });

  test("checkApiError extracts Message tag from Err element", () => {
    expect(() => checkApiError(ERROR_XML_WITH_MESSAGE)).toThrow("Authentication failed");
  });
});

describe("URL Building", () => {
  test("buildUrl constructs correct URL with required params", () => {
    const url = buildUrl("namecheap.domains.getList", testConfig);
    expect(url).toContain("api.namecheap.com/xml.response");
    expect(url).toContain("ApiUser=testuser");
    expect(url).toContain("ApiKey=test-api-key");
    expect(url).toContain("UserName=testuser");
    expect(url).toContain("ClientIp=1.2.3.4");
    expect(url).toContain("Command=namecheap.domains.getList");
  });

  test("buildUrl includes extra params", () => {
    const url = buildUrl("namecheap.domains.getList", testConfig, { PageSize: "50", Page: "2" });
    expect(url).toContain("PageSize=50");
    expect(url).toContain("Page=2");
  });

  test("buildUrl uses sandbox URL when sandbox is true", () => {
    const sandboxConfig = { ...testConfig, sandbox: true };
    const url = buildUrl("namecheap.domains.getList", sandboxConfig);
    expect(url).toContain("api.sandbox.namecheap.com");
  });
});

describe("splitDomain", () => {
  test("splits standard domains", () => {
    expect(splitDomain("example.com")).toEqual({ sld: "example", tld: "com" });
    expect(splitDomain("mysite.org")).toEqual({ sld: "mysite", tld: "org" });
  });

  test("splits multi-part TLDs", () => {
    expect(splitDomain("example.co.uk")).toEqual({ sld: "example", tld: "co.uk" });
  });

  test("splits subdomain-like domains", () => {
    expect(splitDomain("sub.example.com")).toEqual({ sld: "sub.example", tld: "com" });
  });

  test("throws on invalid domain", () => {
    expect(() => splitDomain("nodots")).toThrow("Invalid domain");
  });
});

describe("getConfig", () => {
  test("throws when NAMECHEAP_API_KEY is missing", () => {
    const origKey = process.env["NAMECHEAP_API_KEY"];
    const origUser = process.env["NAMECHEAP_USERNAME"];
    const origIp = process.env["NAMECHEAP_CLIENT_IP"];
    delete process.env["NAMECHEAP_API_KEY"];
    delete process.env["NAMECHEAP_USERNAME"];
    delete process.env["NAMECHEAP_CLIENT_IP"];

    expect(() => getConfig()).toThrow("NAMECHEAP_API_KEY");

    // Restore
    if (origKey) process.env["NAMECHEAP_API_KEY"] = origKey;
    if (origUser) process.env["NAMECHEAP_USERNAME"] = origUser;
    if (origIp) process.env["NAMECHEAP_CLIENT_IP"] = origIp;
  });

  test("throws when NAMECHEAP_USERNAME is missing", () => {
    process.env["NAMECHEAP_API_KEY"] = "test";
    const origUser = process.env["NAMECHEAP_USERNAME"];
    delete process.env["NAMECHEAP_USERNAME"];

    expect(() => getConfig()).toThrow("NAMECHEAP_USERNAME");

    delete process.env["NAMECHEAP_API_KEY"];
    if (origUser) process.env["NAMECHEAP_USERNAME"] = origUser;
  });

  test("throws when NAMECHEAP_CLIENT_IP is missing", () => {
    process.env["NAMECHEAP_API_KEY"] = "test";
    process.env["NAMECHEAP_USERNAME"] = "test";
    const origIp = process.env["NAMECHEAP_CLIENT_IP"];
    delete process.env["NAMECHEAP_CLIENT_IP"];

    expect(() => getConfig()).toThrow("NAMECHEAP_CLIENT_IP");

    delete process.env["NAMECHEAP_API_KEY"];
    delete process.env["NAMECHEAP_USERNAME"];
    if (origIp) process.env["NAMECHEAP_CLIENT_IP"] = origIp;
  });
});

describe("API Functions with mocked fetch", () => {
  const originalFetch = globalThis.fetch;

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("listNamecheapDomains parses domain list", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(DOMAIN_LIST_XML, { status: 200 }))
    ) as typeof fetch;

    const domains = await listNamecheapDomains(testConfig);
    expect(domains).toHaveLength(2);
    expect(domains[0].domain).toBe("example.com");
    expect(domains[0].expiry).toBe("01/01/2025");
    expect(domains[0].autoRenew).toBe(true);
    expect(domains[0].isLocked).toBe(true);
    expect(domains[1].domain).toBe("mysite.org");
    expect(domains[1].autoRenew).toBe(false);
    expect(domains[1].isLocked).toBe(false);
  });

  test("getDomainInfo parses domain info with nameservers", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(DOMAIN_INFO_XML, { status: 200 }))
    ) as typeof fetch;

    const info = await getDomainInfo("example.com", testConfig);
    expect(info.domain).toBe("example.com");
    expect(info.registrar).toBe("Namecheap");
    expect(info.created).toBe("01/01/2020");
    expect(info.expires).toBe("01/01/2025");
    expect(info.nameservers).toEqual(["ns1.cloudflare.com", "ns2.cloudflare.com"]);
  });

  test("renewDomain parses renewal result", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(RENEW_XML, { status: 200 }))
    ) as typeof fetch;

    const result = await renewDomain("example.com", 1, testConfig);
    expect(result.domain).toBe("example.com");
    expect(result.success).toBe(true);
    expect(result.orderId).toBe("98765");
    expect(result.transactionId).toBe("55555");
    expect(result.chargedAmount).toBe("10.87");
  });

  test("getDnsRecords parses host records", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(DNS_HOSTS_XML, { status: 200 }))
    ) as typeof fetch;

    const records = await getDnsRecords("example.com", "example", "com", testConfig);
    expect(records).toHaveLength(3);
    expect(records[0]).toEqual({
      hostId: "1",
      type: "A",
      name: "@",
      address: "1.2.3.4",
      mxPref: 0,
      ttl: 1800,
    });
    expect(records[1].type).toBe("CNAME");
    expect(records[1].name).toBe("www");
    expect(records[2].type).toBe("MX");
    expect(records[2].mxPref).toBe(10);
  });

  test("setDnsRecords sends correct params and parses success", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock((url: string | URL | Request) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return Promise.resolve(new Response(SET_HOSTS_XML, { status: 200 }));
    }) as typeof fetch;

    const result = await setDnsRecords("example.com", "example", "com", [
      { type: "A", name: "@", address: "5.6.7.8", ttl: 1800 },
      { type: "CNAME", name: "www", address: "example.com.", ttl: 1800 },
    ], testConfig);

    expect(result).toBe(true);
    expect(capturedUrl).toContain("HostName1=%40");
    expect(capturedUrl).toContain("RecordType1=A");
    expect(capturedUrl).toContain("Address1=5.6.7.8");
    expect(capturedUrl).toContain("HostName2=www");
    expect(capturedUrl).toContain("RecordType2=CNAME");
  });

  test("checkAvailability returns available=true", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(CHECK_AVAILABILITY_XML, { status: 200 }))
    ) as typeof fetch;

    const result = await checkAvailability("newdomain.com", testConfig);
    expect(result.domain).toBe("newdomain.com");
    expect(result.available).toBe(true);
  });

  test("checkAvailability returns available=false", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(CHECK_UNAVAILABLE_XML, { status: 200 }))
    ) as typeof fetch;

    const result = await checkAvailability("google.com", testConfig);
    expect(result.domain).toBe("google.com");
    expect(result.available).toBe(false);
  });

  test("API error XML throws descriptive error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(ERROR_XML, { status: 200 }))
    ) as typeof fetch;

    await expect(listNamecheapDomains(testConfig)).rejects.toThrow("Namecheap API error");
  });

  test("HTTP error throws", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }))
    ) as typeof fetch;

    await expect(listNamecheapDomains(testConfig)).rejects.toThrow("HTTP error: 500");
  });
});

describe("syncToLocalDb", () => {
  const originalFetch = globalThis.fetch;

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("syncs domains: creates new and updates existing", async () => {
    // Create an existing domain that should be updated
    createDomain({ name: "example.com", registrar: "OldRegistrar", status: "active" });

    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      // First call = getList, subsequent = getInfo
      if (callCount === 1) {
        return Promise.resolve(new Response(DOMAIN_LIST_XML, { status: 200 }));
      }
      return Promise.resolve(new Response(DOMAIN_INFO_XML, { status: 200 }));
    }) as typeof fetch;

    const result = await syncToLocalDb(
      { getDomainByName, createDomain, updateDomain },
      testConfig
    );

    expect(result.synced).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(result.domains).toContain("example.com");
    expect(result.domains).toContain("mysite.org");

    // Verify updated domain
    const updated = getDomainByName("example.com");
    expect(updated).not.toBeNull();
    expect(updated!.registrar).toBe("Namecheap");

    // Verify created domain
    const created = getDomainByName("mysite.org");
    expect(created).not.toBeNull();
    expect(created!.registrar).toBe("Namecheap");
  });

  test("syncToLocalDb handles list failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(ERROR_XML, { status: 200 }))
    ) as typeof fetch;

    await expect(
      syncToLocalDb({ getDomainByName, createDomain, updateDomain }, testConfig)
    ).rejects.toThrow("Failed to list Namecheap domains");
  });

  test("syncToLocalDb handles per-domain errors gracefully", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response(DOMAIN_LIST_XML, { status: 200 }));
      }
      // All getInfo calls fail
      return Promise.resolve(new Response("", { status: 500, statusText: "Server Error" }));
    }) as typeof fetch;

    // syncToLocalDb falls back to basic info when getInfo fails,
    // but updating still proceeds with the basic info from the list
    // The update itself shouldn't throw because we have name/expiry from list
    const result = await syncToLocalDb(
      { getDomainByName, createDomain, updateDomain },
      testConfig
    );

    // Domains should still sync with basic info from the list
    expect(result.synced).toBe(2);
  });
});
