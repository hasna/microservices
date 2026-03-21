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
