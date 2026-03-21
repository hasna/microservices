import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-leads-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createLead,
  getLead,
  listLeads,
  updateLead,
  deleteLead,
  searchLeads,
  findByEmail,
  bulkImportLeads,
  exportLeads,
  addActivity,
  getActivities,
  getLeadTimeline,
  getLeadStats,
  getPipeline,
  deduplicateLeads,
  mergeLeads,
} from "./leads";
import {
  createList,
  getList,
  listLists,
  deleteList,
  addToList,
  removeFromList,
  getListMembers,
  getSmartListMembers,
} from "./lists";
import { closeDatabase } from "./database";
import { enrichLead, enrichFromEmail, enrichFromDomain, getCachedEnrichment, cacheEnrichment, bulkEnrich } from "../lib/enrichment";
import { scoreLead, autoScoreAll, getScoreDistribution } from "../lib/scoring";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// --- Lead CRUD ---

describe("Leads - CRUD", () => {
  test("create and get lead", () => {
    const lead = createLead({
      name: "Alice Smith",
      email: "alice@acme.com",
      company: "Acme Corp",
      title: "CTO",
      tags: ["enterprise", "tech"],
    });

    expect(lead.id).toBeTruthy();
    expect(lead.name).toBe("Alice Smith");
    expect(lead.email).toBe("alice@acme.com");
    expect(lead.company).toBe("Acme Corp");
    expect(lead.status).toBe("new");
    expect(lead.score).toBe(0);
    expect(lead.tags).toEqual(["enterprise", "tech"]);
    expect(lead.enriched).toBe(false);

    const fetched = getLead(lead.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(lead.id);
  });

  test("create lead with minimal data", () => {
    const lead = createLead({ name: "Minimal Lead" });
    expect(lead.id).toBeTruthy();
    expect(lead.name).toBe("Minimal Lead");
    expect(lead.email).toBeNull();
    expect(lead.source).toBe("manual");
  });

  test("get non-existent lead returns null", () => {
    expect(getLead("non-existent-id")).toBeNull();
  });

  test("update lead", () => {
    const lead = createLead({ name: "Bob Jones" });
    const updated = updateLead(lead.id, {
      email: "bob@example.com",
      status: "contacted",
      tags: ["hot"],
    });

    expect(updated).toBeDefined();
    expect(updated!.email).toBe("bob@example.com");
    expect(updated!.status).toBe("contacted");
    expect(updated!.tags).toEqual(["hot"]);
  });

  test("update non-existent lead returns null", () => {
    expect(updateLead("fake-id", { name: "X" })).toBeNull();
  });

  test("update lead with empty input returns existing", () => {
    const lead = createLead({ name: "NoChange" });
    const result = updateLead(lead.id, {});
    expect(result).toBeDefined();
    expect(result!.name).toBe("NoChange");
  });

  test("delete lead", () => {
    const lead = createLead({ name: "DeleteMe" });
    expect(deleteLead(lead.id)).toBe(true);
    expect(getLead(lead.id)).toBeNull();
  });

  test("delete non-existent lead returns false", () => {
    expect(deleteLead("non-existent")).toBe(false);
  });
});

// --- Listing & Searching ---

describe("Leads - Listing & Search", () => {
  test("list leads with no filters", () => {
    const all = listLeads();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  test("list leads by status", () => {
    createLead({ name: "Qualified Lead", status: "qualified" });
    const results = listLeads({ status: "qualified" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((l) => l.status === "qualified")).toBe(true);
  });

  test("list leads by source", () => {
    createLead({ name: "Web Lead", source: "website" });
    const results = listLeads({ source: "website" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((l) => l.source === "website")).toBe(true);
  });

  test("list leads by score range", () => {
    const lead = createLead({ name: "High Scorer" });
    updateLead(lead.id, { score: 85 });
    const results = listLeads({ score_min: 80, score_max: 100 });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("list leads with limit", () => {
    const results = listLeads({ limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("search leads by name", () => {
    createLead({ name: "Unique Searchable Name" });
    const results = searchLeads("Unique Searchable");
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Unique Searchable Name");
  });

  test("search leads by email", () => {
    createLead({ name: "Email Search", email: "searchtest@unique.com" });
    const results = searchLeads("searchtest@unique");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("search leads by company", () => {
    createLead({ name: "Company Search", company: "UniqueSearchCorp" });
    const results = searchLeads("UniqueSearchCorp");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("findByEmail returns lead", () => {
    createLead({ name: "Find By Email", email: "findme@test.com" });
    const found = findByEmail("findme@test.com");
    expect(found).toBeDefined();
    expect(found!.email).toBe("findme@test.com");
  });

  test("findByEmail returns null for unknown", () => {
    expect(findByEmail("nonexistent@nowhere.com")).toBeNull();
  });
});

// --- Bulk Import & Export ---

describe("Leads - Import/Export", () => {
  test("bulk import with dedup", () => {
    const result = bulkImportLeads([
      { name: "Import1", email: "import1@test.com" },
      { name: "Import2", email: "import2@test.com" },
      { name: "Import1 Dup", email: "import1@test.com" }, // duplicate
    ]);

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors.length).toBe(0);
  });

  test("export as JSON", () => {
    const output = exportLeads("json");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
  });

  test("export as CSV", () => {
    const output = exportLeads("csv");
    const lines = output.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2); // header + at least 1 row
    expect(lines[0]).toContain("id,name,email");
  });
});

// --- Activities ---

describe("Leads - Activities", () => {
  test("add and get activities", () => {
    const lead = createLead({ name: "Activity Lead" });
    const activity = addActivity(lead.id, "note", "First contact made");

    expect(activity.id).toBeTruthy();
    expect(activity.type).toBe("note");
    expect(activity.description).toBe("First contact made");

    const activities = getActivities(lead.id);
    expect(activities.length).toBe(1);
  });

  test("get activities with limit", () => {
    const lead = createLead({ name: "Multi Activity" });
    addActivity(lead.id, "note", "Note 1");
    addActivity(lead.id, "call", "Called");
    addActivity(lead.id, "meeting", "Met");

    const limited = getActivities(lead.id, 2);
    expect(limited.length).toBe(2);
  });

  test("get lead timeline in chronological order", () => {
    const lead = createLead({ name: "Timeline Lead" });
    addActivity(lead.id, "note", "First");
    addActivity(lead.id, "call", "Second");

    const timeline = getLeadTimeline(lead.id);
    expect(timeline.length).toBe(2);
    // Timeline is ascending (oldest first)
    expect(timeline[0].description).toBe("First");
    expect(timeline[1].description).toBe("Second");
  });
});

// --- Stats & Pipeline ---

describe("Leads - Stats & Pipeline", () => {
  test("getLeadStats returns valid stats", () => {
    const stats = getLeadStats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(typeof stats.by_status).toBe("object");
    expect(typeof stats.by_source).toBe("object");
    expect(typeof stats.avg_score).toBe("number");
    expect(typeof stats.conversion_rate).toBe("number");
  });

  test("getPipeline returns all stages", () => {
    const pipeline = getPipeline();
    expect(pipeline.length).toBe(6);
    const statuses = pipeline.map((p) => p.status);
    expect(statuses).toContain("new");
    expect(statuses).toContain("converted");
    expect(statuses).toContain("lost");
  });
});

// --- Dedup & Merge ---

describe("Leads - Dedup & Merge", () => {
  test("mergeLeads combines data", () => {
    // Create two leads — one with phone, one with linkedin
    const lead1 = createLead({ name: "Keep Lead", email: "merge@test.com", phone: "123" });
    // Force a second lead with same purpose but different email to avoid unique constraint
    const lead2 = createLead({ name: "Merge Lead", linkedin_url: "https://linkedin.com/in/merge", company: "MergeCorp", tags: ["vip"] });

    const merged = mergeLeads(lead1.id, lead2.id);
    expect(merged).toBeDefined();
    expect(merged!.name).toBe("Keep Lead"); // kept from lead1
    expect(merged!.phone).toBe("123"); // kept from lead1
    expect(merged!.linkedin_url).toBe("https://linkedin.com/in/merge"); // filled from lead2
    expect(merged!.company).toBe("MergeCorp"); // filled from lead2
    expect(merged!.tags).toContain("vip");

    // Merged lead should be deleted
    expect(getLead(lead2.id)).toBeNull();
  });

  test("mergeLeads returns null for invalid ids", () => {
    expect(mergeLeads("fake1", "fake2")).toBeNull();
  });
});

// --- Enrichment ---

describe("Leads - Enrichment", () => {
  test("enrichFromEmail returns data for company email", () => {
    const data = enrichFromEmail("john@acmecorp.com");
    expect(data.company).toBeDefined();
  });

  test("enrichFromEmail returns empty for free email", () => {
    const data = enrichFromEmail("john@gmail.com");
    expect(data.company).toBeUndefined();
  });

  test("enrichFromDomain returns company data", () => {
    const data = enrichFromDomain("stripe.com");
    expect(data.company).toBe("Stripe");
  });

  test("cacheEnrichment and getCachedEnrichment", () => {
    cacheEnrichment("cached@example.com", { company: "CachedCo", industry: "Tech" });
    const cached = getCachedEnrichment("cached@example.com");
    expect(cached).toBeDefined();
    expect(cached!.industry).toBe("Tech");
  });

  test("getCachedEnrichment returns null for unknown", () => {
    expect(getCachedEnrichment("unknown@nowhere.com")).toBeNull();
  });

  test("enrichLead updates lead data", () => {
    const lead = createLead({ name: "Enrich Me", email: "enrich@enrichcorp.com" });
    const enriched = enrichLead(lead.id);
    expect(enriched).toBeDefined();
    expect(enriched!.enriched).toBe(true);
    expect(enriched!.company).toBe("Enrichcorp");
  });

  test("enrichLead returns null for invalid id", () => {
    expect(enrichLead("fake-id")).toBeNull();
  });

  test("bulkEnrich enriches multiple leads", () => {
    const l1 = createLead({ name: "Bulk1", email: "bulk1@bulkcorp.com" });
    const l2 = createLead({ name: "Bulk2", email: "bulk2@bulkcorp2.com" });
    const result = bulkEnrich([l1.id, l2.id]);
    expect(result.enriched).toBe(2);
    expect(result.failed).toBe(0);
  });
});

// --- Scoring ---

describe("Leads - Scoring", () => {
  test("scoreLead returns score and reason", () => {
    const lead = createLead({
      name: "Score Test",
      email: "score@company.com",
      title: "CEO",
      phone: "555-0100",
      linkedin_url: "https://linkedin.com/in/scoretest",
      company: "ScoreCorp",
    });

    const result = scoreLead(lead.id);
    expect(result).toBeDefined();
    expect(result!.score).toBeGreaterThan(0);
    expect(result!.reason).toContain("company email");
    expect(result!.reason).toContain("has title");
    expect(result!.reason).toContain("decision maker");
  });

  test("scoreLead returns null for invalid id", () => {
    expect(scoreLead("fake-id")).toBeNull();
  });

  test("autoScoreAll scores unscored leads", () => {
    createLead({ name: "Unsored1", email: "unscore1@corp.com" });
    const result = autoScoreAll();
    expect(result.scored).toBeGreaterThanOrEqual(1);
  });

  test("getScoreDistribution returns 5 ranges", () => {
    const dist = getScoreDistribution();
    expect(dist.length).toBe(5);
    expect(dist[0].range).toBe("0-20");
    expect(dist[4].range).toBe("81-100");
  });
});

// --- Lists ---

describe("Leads - Lists", () => {
  test("create and get list", () => {
    const list = createList({ name: "Hot Leads", description: "High priority" });
    expect(list.id).toBeTruthy();
    expect(list.name).toBe("Hot Leads");

    const fetched = getList(list.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Hot Leads");
  });

  test("list all lists", () => {
    const lists = listLists();
    expect(lists.length).toBeGreaterThanOrEqual(1);
  });

  test("add and remove lead from list", () => {
    const list = createList({ name: "Test List" });
    const lead = createLead({ name: "List Lead" });

    expect(addToList(list.id, lead.id)).toBe(true);

    const members = getListMembers(list.id);
    expect(members.length).toBe(1);
    expect(members[0].id).toBe(lead.id);

    expect(removeFromList(list.id, lead.id)).toBe(true);
    expect(getListMembers(list.id).length).toBe(0);
  });

  test("delete list", () => {
    const list = createList({ name: "Delete List" });
    expect(deleteList(list.id)).toBe(true);
    expect(getList(list.id)).toBeNull();
  });

  test("smart list with filter query", () => {
    createLead({ name: "Smart Qualified", status: "qualified", score: 60 });
    const list = createList({
      name: "Smart List",
      filter_query: "status=qualified",
    });

    const members = getSmartListMembers(list.id);
    expect(members.length).toBeGreaterThanOrEqual(1);
    expect(members.every((m) => m.status === "qualified")).toBe(true);
  });
});
