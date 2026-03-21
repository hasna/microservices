/**
 * Lead enrichment — AI-powered data enrichment from email and domain
 */

import { getDatabase } from "../db/database.js";
import { getLead, updateLead, addActivity } from "../db/leads.js";

export interface EnrichmentData {
  company?: string;
  title?: string;
  industry?: string;
  location?: string;
  company_size?: string;
  revenue_range?: string;
  tech_stack?: string[];
  social_profiles?: Record<string, string>;
  person_data?: Record<string, unknown>;
  company_data?: Record<string, unknown>;
}

export interface CachedEnrichment {
  id: string;
  email: string;
  company_data: Record<string, unknown>;
  person_data: Record<string, unknown>;
  social_profiles: Record<string, string>;
  tech_stack: string[];
  company_size: string | null;
  industry: string | null;
  location: string | null;
  revenue_range: string | null;
  fetched_at: string | null;
  source: string | null;
}

interface CacheRow {
  id: string;
  email: string;
  company_data: string;
  person_data: string;
  social_profiles: string;
  tech_stack: string;
  company_size: string | null;
  industry: string | null;
  location: string | null;
  revenue_range: string | null;
  fetched_at: string | null;
  source: string | null;
}

function rowToCache(row: CacheRow): CachedEnrichment {
  return {
    ...row,
    company_data: JSON.parse(row.company_data || "{}"),
    person_data: JSON.parse(row.person_data || "{}"),
    social_profiles: JSON.parse(row.social_profiles || "{}"),
    tech_stack: JSON.parse(row.tech_stack || "[]"),
  };
}

export function getCachedEnrichment(email: string): CachedEnrichment | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM enrichment_cache WHERE email = ?")
    .get(email) as CacheRow | null;
  return row ? rowToCache(row) : null;
}

export function cacheEnrichment(email: string, data: EnrichmentData): CachedEnrichment {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT OR REPLACE INTO enrichment_cache
     (id, email, company_data, person_data, social_profiles, tech_stack, company_size, industry, location, revenue_range, fetched_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'ai')`
  ).run(
    id,
    email,
    JSON.stringify(data.company_data || {}),
    JSON.stringify(data.person_data || {}),
    JSON.stringify(data.social_profiles || {}),
    JSON.stringify(data.tech_stack || []),
    data.company_size || null,
    data.industry || null,
    data.location || null,
    data.revenue_range || null
  );

  return getCachedEnrichment(email)!;
}

/**
 * Enrich a lead from email — uses AI to research the person based on email domain.
 * Returns enrichment data. In a production setup, this would call OpenAI/Anthropic.
 * For now, returns domain-based heuristics.
 */
export function enrichFromEmail(email: string): EnrichmentData {
  const domain = email.split("@")[1];
  if (!domain) return {};

  // Check cache first
  const cached = getCachedEnrichment(email);
  if (cached) {
    return {
      company: cached.company_data?.name as string | undefined,
      industry: cached.industry || undefined,
      location: cached.location || undefined,
      company_size: cached.company_size || undefined,
      revenue_range: cached.revenue_range || undefined,
      tech_stack: cached.tech_stack,
      social_profiles: cached.social_profiles,
      person_data: cached.person_data,
      company_data: cached.company_data,
    };
  }

  // Domain-based heuristic enrichment (production would call AI APIs)
  const data: EnrichmentData = {};

  // Detect company from email domain
  const freeEmailDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "protonmail.com"];
  if (!freeEmailDomains.includes(domain)) {
    data.company = domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1);
    data.company_data = { domain, name: data.company };
  }

  // Cache the result
  cacheEnrichment(email, data);

  return data;
}

/**
 * Enrich from domain — AI researches company info.
 * Returns company data. Production would call AI APIs.
 */
export function enrichFromDomain(domain: string): EnrichmentData {
  const data: EnrichmentData = {};
  const companyName = domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1);
  data.company = companyName;
  data.company_data = { domain, name: companyName };
  return data;
}

/**
 * Enrich a single lead by ID
 */
export function enrichLead(leadId: string): Lead | null {
  const lead = getLead(leadId);
  if (!lead) return null;

  let enrichmentData: EnrichmentData = {};

  if (lead.email) {
    enrichmentData = enrichFromEmail(lead.email);
  } else if (lead.website) {
    try {
      const domain = new URL(lead.website.startsWith("http") ? lead.website : `https://${lead.website}`).hostname;
      enrichmentData = enrichFromDomain(domain);
    } catch {
      // Invalid URL, skip
    }
  }

  // Update lead with enriched data
  const updates: Record<string, unknown> = { enriched: true, enriched_at: new Date().toISOString() };
  if (enrichmentData.company && !lead.company) updates.company = enrichmentData.company;
  if (enrichmentData.title && !lead.title) updates.title = enrichmentData.title;
  if (enrichmentData.industry) {
    const meta = { ...lead.metadata, industry: enrichmentData.industry };
    updates.metadata = meta;
  }

  updateLead(leadId, updates as any);
  addActivity(leadId, "enriched", `Enriched from ${lead.email || lead.website || "unknown"}`);

  return getLead(leadId);
}

// Import Lead type for return
import type { Lead } from "../db/leads.js";

/**
 * Bulk enrich multiple leads
 */
export function bulkEnrich(leadIds: string[]): { enriched: number; failed: number } {
  let enriched = 0;
  let failed = 0;

  for (const id of leadIds) {
    try {
      const result = enrichLead(id);
      if (result) enriched++;
      else failed++;
    } catch {
      failed++;
    }
  }

  return { enriched, failed };
}
