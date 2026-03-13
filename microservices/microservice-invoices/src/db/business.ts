/**
 * Business profiles and tax rules
 */

import { getDatabase } from "./database.js";

// --- Business Profiles ---

export interface BusinessProfile {
  id: string;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  tax_id: string | null;
  vat_number: string | null;
  registration_number: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  bank_name: string | null;
  bank_iban: string | null;
  bank_swift: string | null;
  bank_account: string | null;
  logo_url: string | null;
  is_default: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface BusinessRow extends Omit<BusinessProfile, "is_default" | "metadata"> {
  is_default: number;
  metadata: string;
}

function rowToBusiness(row: BusinessRow): BusinessProfile {
  return {
    ...row,
    is_default: row.is_default === 1,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreateBusinessInput {
  name: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  tax_id?: string;
  vat_number?: string;
  registration_number?: string;
  email?: string;
  phone?: string;
  website?: string;
  bank_name?: string;
  bank_iban?: string;
  bank_swift?: string;
  bank_account?: string;
  logo_url?: string;
  is_default?: boolean;
}

export function createBusinessProfile(input: CreateBusinessInput): BusinessProfile {
  const db = getDatabase();
  const id = crypto.randomUUID();

  // If setting as default, clear other defaults
  if (input.is_default) {
    db.prepare("UPDATE business_profiles SET is_default = 0").run();
  }

  db.prepare(
    `INSERT INTO business_profiles (id, name, address_line1, address_line2, city, state, postal_code, country, tax_id, vat_number, registration_number, email, phone, website, bank_name, bank_iban, bank_swift, bank_account, logo_url, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, input.name,
    input.address_line1 || null, input.address_line2 || null,
    input.city || null, input.state || null, input.postal_code || null,
    input.country || "US",
    input.tax_id || null, input.vat_number || null, input.registration_number || null,
    input.email || null, input.phone || null, input.website || null,
    input.bank_name || null, input.bank_iban || null, input.bank_swift || null, input.bank_account || null,
    input.logo_url || null,
    input.is_default ? 1 : 0
  );

  return getBusinessProfile(id)!;
}

export function getBusinessProfile(id: string): BusinessProfile | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM business_profiles WHERE id = ?").get(id) as BusinessRow | null;
  return row ? rowToBusiness(row) : null;
}

export function getDefaultBusinessProfile(): BusinessProfile | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM business_profiles WHERE is_default = 1").get() as BusinessRow | null;
  return row ? rowToBusiness(row) : null;
}

export function listBusinessProfiles(): BusinessProfile[] {
  const db = getDatabase();
  return (db.prepare("SELECT * FROM business_profiles ORDER BY is_default DESC, name").all() as BusinessRow[]).map(rowToBusiness);
}

export function updateBusinessProfile(id: string, input: Partial<CreateBusinessInput>): BusinessProfile | null {
  const db = getDatabase();
  if (!getBusinessProfile(id)) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key === "is_default") {
      if (value) db.prepare("UPDATE business_profiles SET is_default = 0").run();
      sets.push("is_default = ?");
      params.push(value ? 1 : 0);
    } else {
      sets.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (sets.length === 0) return getBusinessProfile(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  db.prepare(`UPDATE business_profiles SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getBusinessProfile(id);
}

export function deleteBusinessProfile(id: string): boolean {
  return getDatabase().prepare("DELETE FROM business_profiles WHERE id = ?").run(id).changes > 0;
}

// --- Tax Rules ---

export interface TaxRule {
  id: string;
  country: string;
  region: string | null;
  tax_name: string;
  rate: number;
  type: "vat" | "sales_tax" | "gst" | "other";
  is_default: boolean;
  reverse_charge: boolean;
  description: string | null;
  created_at: string;
}

interface TaxRuleRow extends Omit<TaxRule, "is_default" | "reverse_charge"> {
  is_default: number;
  reverse_charge: number;
}

function rowToTaxRule(row: TaxRuleRow): TaxRule {
  return { ...row, is_default: row.is_default === 1, reverse_charge: row.reverse_charge === 1 } as TaxRule;
}

export function getTaxRulesForCountry(country: string): TaxRule[] {
  const db = getDatabase();
  return (db.prepare("SELECT * FROM tax_rules WHERE country = ? ORDER BY is_default DESC, rate DESC").all(country) as TaxRuleRow[]).map(rowToTaxRule);
}

export function getDefaultTaxRule(country: string): TaxRule | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM tax_rules WHERE country = ? AND is_default = 1").get(country) as TaxRuleRow | null;
  return row ? rowToTaxRule(row) : null;
}

export function getTaxRule(id: string): TaxRule | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM tax_rules WHERE id = ?").get(id) as TaxRuleRow | null;
  return row ? rowToTaxRule(row) : null;
}

export function listAllTaxRules(): TaxRule[] {
  const db = getDatabase();
  return (db.prepare("SELECT * FROM tax_rules ORDER BY country, is_default DESC, rate DESC").all() as TaxRuleRow[]).map(rowToTaxRule);
}

export interface CreateTaxRuleInput {
  country: string;
  region?: string;
  tax_name: string;
  rate: number;
  type?: "vat" | "sales_tax" | "gst" | "other";
  is_default?: boolean;
  reverse_charge?: boolean;
  description?: string;
}

export function createTaxRule(input: CreateTaxRuleInput): TaxRule {
  const db = getDatabase();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO tax_rules (id, country, region, tax_name, rate, type, is_default, reverse_charge, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.country, input.region || null, input.tax_name, input.rate, input.type || "vat", input.is_default ? 1 : 0, input.reverse_charge ? 1 : 0, input.description || null);
  return getTaxRule(id)!;
}

export function deleteTaxRule(id: string): boolean {
  return getDatabase().prepare("DELETE FROM tax_rules WHERE id = ?").run(id).changes > 0;
}

/**
 * Determine tax for an invoice based on issuer and client countries.
 * Applies EU reverse charge when both parties are in EU and client has VAT number.
 */
export function determineTax(issuerCountry: string, clientCountry: string, clientVatNumber?: string | null): {
  tax_rate: number;
  tax_name: string;
  reverse_charge: boolean;
} {
  const EU_COUNTRIES = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];

  const issuerInEU = EU_COUNTRIES.includes(issuerCountry);
  const clientInEU = EU_COUNTRIES.includes(clientCountry);

  // EU B2B reverse charge: different EU countries, client has VAT number
  if (issuerInEU && clientInEU && issuerCountry !== clientCountry && clientVatNumber) {
    return { tax_rate: 0, tax_name: "Reverse Charge", reverse_charge: true };
  }

  // Same country or non-EU: use issuer's default tax
  const defaultRule = getDefaultTaxRule(issuerCountry);
  if (defaultRule) {
    return { tax_rate: defaultRule.rate, tax_name: defaultRule.tax_name, reverse_charge: false };
  }

  return { tax_rate: 0, tax_name: "Tax", reverse_charge: false };
}
