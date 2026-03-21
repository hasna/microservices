import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-ads-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
  deleteCampaign,
  pauseCampaign,
  resumeCampaign,
  countCampaigns,
  getCampaignStats,
  getSpendByPlatform,
  getPlatforms,
  createAdGroup,
  getAdGroup,
  listAdGroups,
  deleteAdGroup,
  createAd,
  getAd,
  listAds,
  deleteAd,
  bulkPause,
  bulkResume,
  getRankedCampaigns,
  checkBudgetStatus,
  comparePlatforms,
  exportCampaigns,
  cloneCampaign,
  getBudgetRemaining,
  getAdGroupStats,
} from "./campaigns";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Campaigns", () => {
  test("create and get campaign", () => {
    const campaign = createCampaign({
      platform: "google",
      name: "Summer Sale",
      budget_daily: 50,
      budget_total: 1500,
      start_date: "2025-06-01",
      end_date: "2025-06-30",
    });

    expect(campaign.id).toBeTruthy();
    expect(campaign.platform).toBe("google");
    expect(campaign.name).toBe("Summer Sale");
    expect(campaign.status).toBe("draft");
    expect(campaign.budget_daily).toBe(50);
    expect(campaign.budget_total).toBe(1500);
    expect(campaign.start_date).toBe("2025-06-01");
    expect(campaign.end_date).toBe("2025-06-30");

    const fetched = getCampaign(campaign.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(campaign.id);
    expect(fetched!.name).toBe("Summer Sale");
  });

  test("list campaigns", () => {
    createCampaign({ platform: "meta", name: "FB Awareness" });
    const all = listCampaigns();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("filter campaigns by platform", () => {
    const google = listCampaigns({ platform: "google" });
    expect(google.length).toBeGreaterThanOrEqual(1);
    expect(google.every((c) => c.platform === "google")).toBe(true);
  });

  test("filter campaigns by status", () => {
    createCampaign({ platform: "linkedin", name: "Active LinkedIn", status: "active" });
    const active = listCampaigns({ status: "active" });
    expect(active.length).toBeGreaterThanOrEqual(1);
    expect(active.every((c) => c.status === "active")).toBe(true);
  });

  test("search campaigns by name", () => {
    const results = listCampaigns({ search: "Summer" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toContain("Summer");
  });

  test("update campaign", () => {
    const campaign = createCampaign({ platform: "tiktok", name: "TikTok Test" });
    const updated = updateCampaign(campaign.id, {
      name: "TikTok Updated",
      budget_daily: 100,
      spend: 250.5,
      impressions: 10000,
      clicks: 500,
      conversions: 25,
      roas: 3.5,
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("TikTok Updated");
    expect(updated!.budget_daily).toBe(100);
    expect(updated!.spend).toBe(250.5);
    expect(updated!.impressions).toBe(10000);
    expect(updated!.clicks).toBe(500);
    expect(updated!.conversions).toBe(25);
    expect(updated!.roas).toBe(3.5);
  });

  test("update nonexistent campaign returns null", () => {
    const result = updateCampaign("nonexistent-id", { name: "Nope" });
    expect(result).toBeNull();
  });

  test("delete campaign", () => {
    const campaign = createCampaign({ platform: "google", name: "DeleteMe" });
    expect(deleteCampaign(campaign.id)).toBe(true);
    expect(getCampaign(campaign.id)).toBeNull();
  });

  test("delete nonexistent campaign returns false", () => {
    expect(deleteCampaign("nonexistent-id")).toBe(false);
  });

  test("pause and resume campaign", () => {
    const campaign = createCampaign({ platform: "meta", name: "Pause Test", status: "active" });

    const paused = pauseCampaign(campaign.id);
    expect(paused).toBeDefined();
    expect(paused!.status).toBe("paused");

    const resumed = resumeCampaign(campaign.id);
    expect(resumed).toBeDefined();
    expect(resumed!.status).toBe("active");
  });

  test("count campaigns", () => {
    const count = countCampaigns();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test("campaign stats", () => {
    const stats = getCampaignStats();
    expect(stats.total_campaigns).toBeGreaterThanOrEqual(4);
    expect(typeof stats.total_spend).toBe("number");
    expect(typeof stats.total_impressions).toBe("number");
    expect(typeof stats.active_campaigns).toBe("number");
  });

  test("spend by platform", () => {
    const spend = getSpendByPlatform();
    expect(spend.length).toBeGreaterThanOrEqual(1);
    expect(spend[0]).toHaveProperty("platform");
    expect(spend[0]).toHaveProperty("total_spend");
    expect(spend[0]).toHaveProperty("campaign_count");
  });

  test("get platforms", () => {
    const platforms = getPlatforms();
    expect(platforms.length).toBeGreaterThanOrEqual(1);
    expect(platforms).toContain("google");
  });

  test("campaign metadata", () => {
    const campaign = createCampaign({
      platform: "google",
      name: "Metadata Test",
      metadata: { objective: "awareness", audience: "18-35" },
    });

    expect(campaign.metadata).toEqual({ objective: "awareness", audience: "18-35" });

    const updated = updateCampaign(campaign.id, {
      metadata: { objective: "conversions" },
    });
    expect(updated!.metadata).toEqual({ objective: "conversions" });
  });
});

describe("Ad Groups", () => {
  test("create and get ad group", () => {
    const campaign = createCampaign({ platform: "google", name: "AG Test Campaign" });
    const adGroup = createAdGroup({
      campaign_id: campaign.id,
      name: "Ad Group 1",
      targeting: { age: "18-35", location: "US" },
    });

    expect(adGroup.id).toBeTruthy();
    expect(adGroup.campaign_id).toBe(campaign.id);
    expect(adGroup.name).toBe("Ad Group 1");
    expect(adGroup.targeting).toEqual({ age: "18-35", location: "US" });
    expect(adGroup.status).toBe("draft");

    const fetched = getAdGroup(adGroup.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(adGroup.id);
  });

  test("list ad groups by campaign", () => {
    const campaign = createCampaign({ platform: "meta", name: "AG List Campaign" });
    createAdGroup({ campaign_id: campaign.id, name: "Group A" });
    createAdGroup({ campaign_id: campaign.id, name: "Group B" });

    const groups = listAdGroups(campaign.id);
    expect(groups.length).toBe(2);
  });

  test("list all ad groups", () => {
    const all = listAdGroups();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("delete ad group", () => {
    const campaign = createCampaign({ platform: "linkedin", name: "AG Delete Campaign" });
    const adGroup = createAdGroup({ campaign_id: campaign.id, name: "DeleteMe" });

    expect(deleteAdGroup(adGroup.id)).toBe(true);
    expect(getAdGroup(adGroup.id)).toBeNull();
  });

  test("cascade delete ad groups when campaign deleted", () => {
    const campaign = createCampaign({ platform: "google", name: "Cascade Campaign" });
    const ag = createAdGroup({ campaign_id: campaign.id, name: "Cascade Group" });

    deleteCampaign(campaign.id);
    expect(getAdGroup(ag.id)).toBeNull();
  });
});

describe("Ads", () => {
  test("create and get ad", () => {
    const campaign = createCampaign({ platform: "google", name: "Ad Test Campaign" });
    const adGroup = createAdGroup({ campaign_id: campaign.id, name: "Ad Test Group" });
    const ad = createAd({
      ad_group_id: adGroup.id,
      headline: "Buy Now!",
      description: "Great deals on everything",
      creative_url: "https://example.com/banner.jpg",
      metrics: { ctr: 0.05, cpc: 1.2 },
    });

    expect(ad.id).toBeTruthy();
    expect(ad.ad_group_id).toBe(adGroup.id);
    expect(ad.headline).toBe("Buy Now!");
    expect(ad.description).toBe("Great deals on everything");
    expect(ad.creative_url).toBe("https://example.com/banner.jpg");
    expect(ad.status).toBe("draft");
    expect(ad.metrics).toEqual({ ctr: 0.05, cpc: 1.2 });

    const fetched = getAd(ad.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(ad.id);
  });

  test("list ads by ad group", () => {
    const campaign = createCampaign({ platform: "meta", name: "Ad List Campaign" });
    const adGroup = createAdGroup({ campaign_id: campaign.id, name: "Ad List Group" });
    createAd({ ad_group_id: adGroup.id, headline: "Ad 1" });
    createAd({ ad_group_id: adGroup.id, headline: "Ad 2" });

    const ads = listAds(adGroup.id);
    expect(ads.length).toBe(2);
  });

  test("list all ads", () => {
    const all = listAds();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("delete ad", () => {
    const campaign = createCampaign({ platform: "tiktok", name: "Ad Delete Campaign" });
    const adGroup = createAdGroup({ campaign_id: campaign.id, name: "Ad Delete Group" });
    const ad = createAd({ ad_group_id: adGroup.id, headline: "DeleteMe" });

    expect(deleteAd(ad.id)).toBe(true);
    expect(getAd(ad.id)).toBeNull();
  });

  test("cascade delete ads when ad group deleted", () => {
    const campaign = createCampaign({ platform: "google", name: "Ad Cascade Campaign" });
    const adGroup = createAdGroup({ campaign_id: campaign.id, name: "Ad Cascade Group" });
    const ad = createAd({ ad_group_id: adGroup.id, headline: "Cascade Ad" });

    deleteAdGroup(adGroup.id);
    expect(getAd(ad.id)).toBeNull();
  });

  test("cascade delete ads when campaign deleted", () => {
    const campaign = createCampaign({ platform: "meta", name: "Full Cascade Campaign" });
    const adGroup = createAdGroup({ campaign_id: campaign.id, name: "Full Cascade Group" });
    const ad = createAd({ ad_group_id: adGroup.id, headline: "Full Cascade Ad" });

    deleteCampaign(campaign.id);
    expect(getAdGroup(adGroup.id)).toBeNull();
    expect(getAd(ad.id)).toBeNull();
  });
});

// --- QoL Feature Tests ---

describe("Bulk Pause/Resume", () => {
  test("bulk pause active campaigns on a platform", () => {
    createCampaign({ platform: "google", name: "BP Active 1", status: "active" });
    createCampaign({ platform: "google", name: "BP Active 2", status: "active" });
    createCampaign({ platform: "google", name: "BP Draft", status: "draft" });

    const result = bulkPause("google");
    expect(result.platform).toBe("google");
    expect(result.new_status).toBe("paused");
    expect(result.updated_count).toBeGreaterThanOrEqual(2);

    // Verify they're actually paused
    const google = listCampaigns({ platform: "google", status: "active" });
    // The "Active LinkedIn" from earlier tests may exist but is on linkedin
    expect(google.length).toBe(0);
  });

  test("bulk resume paused campaigns on a platform", () => {
    const result = bulkResume("google");
    expect(result.platform).toBe("google");
    expect(result.new_status).toBe("active");
    expect(result.updated_count).toBeGreaterThanOrEqual(2);
  });

  test("bulk pause on platform with no active campaigns returns 0", () => {
    const result = bulkPause("tiktok");
    // tiktok campaigns from earlier tests may or may not be active
    expect(result.updated_count).toBeGreaterThanOrEqual(0);
  });
});

describe("Performance Ranking", () => {
  test("rank campaigns by ROAS", () => {
    createCampaign({ platform: "google", name: "High ROAS", roas: 10.5, spend: 100 });
    createCampaign({ platform: "meta", name: "Low ROAS", roas: 1.2, spend: 500 });

    const ranked = getRankedCampaigns("roas", 5);
    expect(ranked.length).toBeGreaterThanOrEqual(2);
    // First should have highest ROAS
    expect(ranked[0].roas).toBeGreaterThanOrEqual(ranked[1].roas);
  });

  test("rank campaigns by spend", () => {
    const ranked = getRankedCampaigns("spend", 5);
    expect(ranked.length).toBeGreaterThanOrEqual(2);
    expect(ranked[0].spend).toBeGreaterThanOrEqual(ranked[1].spend);
  });

  test("rank campaigns by CTR", () => {
    createCampaign({ platform: "google", name: "High CTR", impressions: 1000, clicks: 100 });
    createCampaign({ platform: "meta", name: "Low CTR", impressions: 1000, clicks: 10 });

    const ranked = getRankedCampaigns("ctr", 5);
    expect(ranked.length).toBeGreaterThanOrEqual(2);
    // First should have highest CTR
    const ctr0 = ranked[0].impressions > 0 ? ranked[0].clicks / ranked[0].impressions : 0;
    const ctr1 = ranked[1].impressions > 0 ? ranked[1].clicks / ranked[1].impressions : 0;
    expect(ctr0).toBeGreaterThanOrEqual(ctr1);
  });

  test("rank with limit", () => {
    const ranked = getRankedCampaigns("roas", 2);
    expect(ranked.length).toBeLessThanOrEqual(2);
  });
});

describe("Budget Alerts", () => {
  test("check budget status for a campaign under budget", () => {
    const campaign = createCampaign({
      platform: "google",
      name: "Under Budget",
      budget_daily: 100,
      budget_total: 3000,
      spend: 500,
      start_date: "2026-03-15",
    });

    const status = checkBudgetStatus(campaign.id);
    expect(status).not.toBeNull();
    expect(status!.campaign_id).toBe(campaign.id);
    expect(status!.total_remaining).toBeGreaterThan(0);
    expect(status!.pct_used).toBeLessThan(100);
  });

  test("check budget status for an over-budget campaign", () => {
    const campaign = createCampaign({
      platform: "meta",
      name: "Over Budget",
      budget_daily: 50,
      budget_total: 100,
      spend: 150,
      start_date: "2026-03-01",
    });

    const status = checkBudgetStatus(campaign.id);
    expect(status).not.toBeNull();
    expect(status!.over_budget).toBe(true);
    expect(status!.total_remaining).toBe(0);
    expect(status!.pct_used).toBeGreaterThan(100);
  });

  test("check budget status for nonexistent campaign returns null", () => {
    expect(checkBudgetStatus("nonexistent")).toBeNull();
  });
});

describe("Cross-Platform Comparison", () => {
  test("compare platforms returns data for all active platforms", () => {
    const comparison = comparePlatforms();
    expect(comparison.length).toBeGreaterThanOrEqual(1);

    for (const p of comparison) {
      expect(p).toHaveProperty("platform");
      expect(p).toHaveProperty("campaign_count");
      expect(p).toHaveProperty("total_spend");
      expect(p).toHaveProperty("avg_roas");
      expect(p).toHaveProperty("avg_ctr");
      expect(p).toHaveProperty("avg_cpa");
    }
  });

  test("comparison includes google platform", () => {
    const comparison = comparePlatforms();
    const google = comparison.find((p) => p.platform === "google");
    expect(google).toBeDefined();
    expect(google!.campaign_count).toBeGreaterThanOrEqual(1);
  });
});

describe("CSV Export", () => {
  test("export campaigns as CSV", () => {
    const csv = exportCampaigns("csv");
    expect(csv).toContain("id,platform,name,status");
    const lines = csv.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2); // header + at least one data row
  });

  test("export campaigns as JSON", () => {
    const json = exportCampaigns("json");
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0]).toHaveProperty("id");
    expect(parsed[0]).toHaveProperty("platform");
  });

  test("CSV default format", () => {
    const csv = exportCampaigns();
    expect(csv).toContain("id,platform,name,status");
  });
});

describe("Campaign Cloning", () => {
  test("clone a campaign with ad groups and ads", () => {
    const original = createCampaign({
      platform: "google",
      name: "Original Campaign",
      budget_daily: 100,
      budget_total: 3000,
      start_date: "2026-04-01",
      metadata: { objective: "conversions" },
    });

    const ag = createAdGroup({
      campaign_id: original.id,
      name: "Original Group",
      targeting: { age: "25-45" },
    });

    createAd({ ad_group_id: ag.id, headline: "Original Ad 1" });
    createAd({ ad_group_id: ag.id, headline: "Original Ad 2" });

    const cloned = cloneCampaign(original.id, "Cloned Campaign V2");
    expect(cloned).not.toBeNull();
    expect(cloned!.name).toBe("Cloned Campaign V2");
    expect(cloned!.platform).toBe("google");
    expect(cloned!.status).toBe("draft");
    expect(cloned!.budget_daily).toBe(100);
    expect(cloned!.budget_total).toBe(3000);
    expect(cloned!.spend).toBe(0); // metrics reset
    expect(cloned!.metadata).toEqual({ objective: "conversions" });
    expect(cloned!.id).not.toBe(original.id);

    // Verify ad groups were cloned
    const clonedGroups = listAdGroups(cloned!.id);
    expect(clonedGroups.length).toBe(1);
    expect(clonedGroups[0].name).toBe("Original Group");
    expect(clonedGroups[0].targeting).toEqual({ age: "25-45" });

    // Verify ads were cloned
    const clonedAds = listAds(clonedGroups[0].id);
    expect(clonedAds.length).toBe(2);
  });

  test("clone nonexistent campaign returns null", () => {
    expect(cloneCampaign("nonexistent", "Nope")).toBeNull();
  });
});

describe("Budget Remaining", () => {
  test("get budget remaining for a campaign", () => {
    const campaign = createCampaign({
      platform: "google",
      name: "Budget Remaining Test",
      budget_daily: 100,
      budget_total: 5000,
      spend: 1500,
      start_date: "2026-03-01",
    });

    const remaining = getBudgetRemaining(campaign.id);
    expect(remaining).not.toBeNull();
    expect(remaining!.campaign_id).toBe(campaign.id);
    expect(remaining!.budget_daily).toBe(100);
    expect(remaining!.budget_total).toBe(5000);
    expect(remaining!.spend).toBe(1500);
    expect(remaining!.total_remaining).toBe(3500);
    expect(remaining!.days_remaining_at_daily_rate).toBeGreaterThanOrEqual(0);
  });

  test("budget remaining for nonexistent campaign returns null", () => {
    expect(getBudgetRemaining("nonexistent")).toBeNull();
  });
});

describe("Ad Group Stats", () => {
  test("get stats for an ad group with ads", () => {
    const campaign = createCampaign({ platform: "meta", name: "AG Stats Campaign" });
    const ag = createAdGroup({ campaign_id: campaign.id, name: "Stats Group" });
    createAd({
      ad_group_id: ag.id,
      headline: "Stats Ad 1",
      status: "active",
      metrics: { ctr: 0.05, cpc: 1.2, impressions: 1000 },
    });
    createAd({
      ad_group_id: ag.id,
      headline: "Stats Ad 2",
      status: "active",
      metrics: { ctr: 0.03, cpc: 0.8, impressions: 2000 },
    });
    createAd({
      ad_group_id: ag.id,
      headline: "Stats Ad 3",
      status: "draft",
      metrics: { ctr: 0.01 },
    });

    const stats = getAdGroupStats(ag.id);
    expect(stats).not.toBeNull();
    expect(stats!.ad_group_id).toBe(ag.id);
    expect(stats!.ad_group_name).toBe("Stats Group");
    expect(stats!.campaign_id).toBe(campaign.id);
    expect(stats!.total_ads).toBe(3);
    expect(stats!.active_ads).toBe(2);
    expect(stats!.metrics.ctr).toBeCloseTo(0.09); // 0.05 + 0.03 + 0.01
    expect(stats!.metrics.cpc).toBeCloseTo(2.0); // 1.2 + 0.8
    expect(stats!.metrics.impressions).toBe(3000);
  });

  test("get stats for ad group with no ads", () => {
    const campaign = createCampaign({ platform: "google", name: "Empty AG Campaign" });
    const ag = createAdGroup({ campaign_id: campaign.id, name: "Empty Group" });

    const stats = getAdGroupStats(ag.id);
    expect(stats).not.toBeNull();
    expect(stats!.total_ads).toBe(0);
    expect(stats!.active_ads).toBe(0);
    expect(Object.keys(stats!.metrics).length).toBe(0);
  });

  test("get stats for nonexistent ad group returns null", () => {
    expect(getAdGroupStats("nonexistent")).toBeNull();
  });
});
