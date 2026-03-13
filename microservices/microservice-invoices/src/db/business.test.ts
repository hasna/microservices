import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDir = mkdtempSync(join(tmpdir(), "ms-invoices-biz-test-" + Date.now() + "-"));
process.env["MICROSERVICES_DIR"] = tempDir;

// Reset DB singleton so it picks up new MICROSERVICES_DIR
import { closeDatabase } from "./database";
closeDatabase();

import {
  createBusinessProfile,
  getBusinessProfile,
  getDefaultBusinessProfile,
  listBusinessProfiles,
  updateBusinessProfile,
  deleteBusinessProfile,
  getTaxRulesForCountry,
  getDefaultTaxRule,
  listAllTaxRules,
  createTaxRule,
  determineTax,
} from "./business";
import { createInvoice, getInvoice } from "./invoices";
import { createClient } from "./clients";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Business Profiles", () => {
  test("create Romanian company", () => {
    const biz = createBusinessProfile({
      name: "SC Test SRL",
      address_line1: "Str. Victoriei 10",
      city: "Bucharest",
      country: "RO",
      tax_id: "RO12345678",
      vat_number: "RO12345678",
      bank_iban: "RO49AAAA1B31007593840000",
      is_default: true,
    });
    expect(biz.name).toBe("SC Test SRL");
    expect(biz.country).toBe("RO");
    expect(biz.vat_number).toBe("RO12345678");
    expect(biz.is_default).toBe(true);
  });

  test("create US company", () => {
    const biz = createBusinessProfile({
      name: "Acme Inc",
      address_line1: "123 Main St",
      city: "San Francisco",
      state: "CA",
      postal_code: "94105",
      country: "US",
      tax_id: "12-3456789",
    });
    expect(biz.country).toBe("US");
    expect(biz.state).toBe("CA");
  });

  test("create UK company", () => {
    const biz = createBusinessProfile({
      name: "London Ltd",
      country: "GB",
      vat_number: "GB123456789",
    });
    expect(biz.country).toBe("GB");
  });

  test("get default business profile", () => {
    const def = getDefaultBusinessProfile();
    expect(def).toBeDefined();
    expect(def!.name).toBe("SC Test SRL");
  });

  test("list all profiles", () => {
    const all = listBusinessProfiles();
    expect(all.length).toBe(3);
  });

  test("update business profile", () => {
    const all = listBusinessProfiles();
    const updated = updateBusinessProfile(all[0].id, { phone: "+40754013776" });
    expect(updated!.phone).toBe("+40754013776");
  });
});

describe("Tax Rules", () => {
  test("seeded Romanian TVA rules", () => {
    const rules = getTaxRulesForCountry("RO");
    expect(rules.length).toBeGreaterThanOrEqual(3);
    const standard = rules.find(r => r.rate === 19);
    expect(standard).toBeDefined();
    expect(standard!.tax_name).toBe("TVA");
  });

  test("seeded UK VAT rules", () => {
    const rules = getTaxRulesForCountry("GB");
    expect(rules.length).toBeGreaterThanOrEqual(3);
    const standard = getDefaultTaxRule("GB");
    expect(standard!.rate).toBe(20);
  });

  test("seeded German MwSt rules", () => {
    const def = getDefaultTaxRule("DE");
    expect(def!.rate).toBe(19);
    expect(def!.tax_name).toBe("MwSt");
  });

  test("seeded French TVA rules", () => {
    const def = getDefaultTaxRule("FR");
    expect(def!.rate).toBe(20);
  });

  test("seeded Hungarian AFA (highest EU at 27%)", () => {
    const def = getDefaultTaxRule("HU");
    expect(def!.rate).toBe(27);
  });

  test("list all tax rules", () => {
    const all = listAllTaxRules();
    expect(all.length).toBeGreaterThanOrEqual(25);
  });

  test("create custom tax rule", () => {
    const rule = createTaxRule({
      country: "US",
      region: "FL",
      tax_name: "Florida Sales Tax",
      rate: 6,
      type: "sales_tax",
    });
    expect(rule.rate).toBe(6);
    expect(rule.region).toBe("FL");
  });
});

describe("Tax Determination", () => {
  test("Romanian domestic invoice gets 19% TVA", () => {
    const tax = determineTax("RO", "RO");
    expect(tax.tax_rate).toBe(19);
    expect(tax.tax_name).toBe("TVA");
    expect(tax.reverse_charge).toBe(false);
  });

  test("UK domestic invoice gets 20% VAT", () => {
    const tax = determineTax("GB", "GB");
    expect(tax.tax_rate).toBe(20);
    expect(tax.reverse_charge).toBe(false);
  });

  test("EU B2B cross-border with VAT number triggers reverse charge", () => {
    const tax = determineTax("RO", "DE", "DE123456789");
    expect(tax.tax_rate).toBe(0);
    expect(tax.tax_name).toBe("Reverse Charge");
    expect(tax.reverse_charge).toBe(true);
  });

  test("EU B2B same country does NOT trigger reverse charge", () => {
    const tax = determineTax("RO", "RO", "RO12345678");
    expect(tax.tax_rate).toBe(19);
    expect(tax.reverse_charge).toBe(false);
  });

  test("EU B2C cross-border without VAT number uses issuer rate", () => {
    const tax = determineTax("RO", "DE");
    expect(tax.tax_rate).toBe(19);
    expect(tax.reverse_charge).toBe(false);
  });

  test("US invoice uses US tax rules", () => {
    const tax = determineTax("US", "US");
    expect(tax.tax_rate).toBe(0); // no federal sales tax
    expect(tax.reverse_charge).toBe(false);
  });
});

describe("International Invoices", () => {
  test("create invoice with business profile and Romanian client", () => {
    const profiles = listBusinessProfiles();
    const roBiz = profiles.find(p => p.country === "RO")!;

    const client = createClient({
      name: "Client SRL",
      country: "RO",
      vat_number: "RO87654321",
    });

    const tax = determineTax(roBiz.country, client.country!, client.vat_number);

    const inv = createInvoice({
      business_profile_id: roBiz.id,
      client_id: client.id,
      currency: "RON",
      tax_rate: tax.tax_rate,
      tax_name: tax.tax_name,
      reverse_charge: tax.reverse_charge,
      language: "ro",
    });

    expect(inv.currency).toBe("RON");
    expect(inv.tax_rate).toBe(19);
    expect(inv.tax_name).toBe("TVA");
    expect(inv.reverse_charge).toBe(false);
    expect(inv.language).toBe("ro");
    expect(inv.business_profile_id).toBe(roBiz.id);
  });

  test("create EU reverse charge invoice", () => {
    const profiles = listBusinessProfiles();
    const roBiz = profiles.find(p => p.country === "RO")!;

    const client = createClient({
      name: "German GmbH",
      country: "DE",
      vat_number: "DE123456789",
    });

    const tax = determineTax(roBiz.country, client.country!, client.vat_number);

    const inv = createInvoice({
      business_profile_id: roBiz.id,
      client_id: client.id,
      currency: "EUR",
      tax_rate: tax.tax_rate,
      tax_name: tax.tax_name,
      reverse_charge: tax.reverse_charge,
      footer_text: "VAT reverse charge applies per EU Directive 2006/112/EC",
    });

    expect(inv.tax_rate).toBe(0);
    expect(inv.tax_name).toBe("Reverse Charge");
    expect(inv.reverse_charge).toBe(true);
    expect(inv.footer_text).toContain("reverse charge");
  });
});
