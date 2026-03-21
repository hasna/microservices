/**
 * Campaign, Ad Group, and Ad CRUD operations
 */

import { getDatabase } from "./database.js";

// --- Types ---

export type Platform = "google" | "meta" | "linkedin" | "tiktok";
export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export interface Campaign {
  id: string;
  platform: Platform;
  name: string;
  status: CampaignStatus;
  budget_daily: number;
  budget_total: number;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  roas: number;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

interface CampaignRow {
  id: string;
  platform: Platform;
  name: string;
  status: CampaignStatus;
  budget_daily: number;
  budget_total: number;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  roas: number;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  metadata: string;
}

function rowToCampaign(row: CampaignRow): Campaign {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface AdGroup {
  id: string;
  campaign_id: string;
  name: string;
  targeting: Record<string, unknown>;
  status: CampaignStatus;
  created_at: string;
}

interface AdGroupRow {
  id: string;
  campaign_id: string;
  name: string;
  targeting: string;
  status: CampaignStatus;
  created_at: string;
}

function rowToAdGroup(row: AdGroupRow): AdGroup {
  return {
    ...row,
    targeting: JSON.parse(row.targeting || "{}"),
  };
}

export interface Ad {
  id: string;
  ad_group_id: string;
  headline: string;
  description: string | null;
  creative_url: string | null;
  status: CampaignStatus;
  metrics: Record<string, unknown>;
  created_at: string;
}

interface AdRow {
  id: string;
  ad_group_id: string;
  headline: string;
  description: string | null;
  creative_url: string | null;
  status: CampaignStatus;
  metrics: string;
  created_at: string;
}

function rowToAd(row: AdRow): Ad {
  return {
    ...row,
    metrics: JSON.parse(row.metrics || "{}"),
  };
}

// --- Campaign CRUD ---

export interface CreateCampaignInput {
  platform: Platform;
  name: string;
  status?: CampaignStatus;
  budget_daily?: number;
  budget_total?: number;
  spend?: number;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  roas?: number;
  start_date?: string;
  end_date?: string;
  metadata?: Record<string, unknown>;
}

export function createCampaign(input: CreateCampaignInput): Campaign {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO campaigns (id, platform, name, status, budget_daily, budget_total, spend, impressions, clicks, conversions, roas, start_date, end_date, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.platform,
    input.name,
    input.status || "draft",
    input.budget_daily ?? 0,
    input.budget_total ?? 0,
    input.spend ?? 0,
    input.impressions ?? 0,
    input.clicks ?? 0,
    input.conversions ?? 0,
    input.roas ?? 0,
    input.start_date || null,
    input.end_date || null,
    metadata
  );

  return getCampaign(id)!;
}

export function getCampaign(id: string): Campaign | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as CampaignRow | null;
  return row ? rowToCampaign(row) : null;
}

export interface ListCampaignsOptions {
  platform?: Platform;
  status?: CampaignStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listCampaigns(options: ListCampaignsOptions = {}): Campaign[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.platform) {
    conditions.push("platform = ?");
    params.push(options.platform);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.search) {
    conditions.push("(name LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q);
  }

  let sql = "SELECT * FROM campaigns";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as CampaignRow[];
  return rows.map(rowToCampaign);
}

export interface UpdateCampaignInput {
  platform?: Platform;
  name?: string;
  status?: CampaignStatus;
  budget_daily?: number;
  budget_total?: number;
  spend?: number;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  roas?: number;
  start_date?: string | null;
  end_date?: string | null;
  metadata?: Record<string, unknown>;
}

export function updateCampaign(
  id: string,
  input: UpdateCampaignInput
): Campaign | null {
  const db = getDatabase();
  const existing = getCampaign(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.platform !== undefined) {
    sets.push("platform = ?");
    params.push(input.platform);
  }
  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.budget_daily !== undefined) {
    sets.push("budget_daily = ?");
    params.push(input.budget_daily);
  }
  if (input.budget_total !== undefined) {
    sets.push("budget_total = ?");
    params.push(input.budget_total);
  }
  if (input.spend !== undefined) {
    sets.push("spend = ?");
    params.push(input.spend);
  }
  if (input.impressions !== undefined) {
    sets.push("impressions = ?");
    params.push(input.impressions);
  }
  if (input.clicks !== undefined) {
    sets.push("clicks = ?");
    params.push(input.clicks);
  }
  if (input.conversions !== undefined) {
    sets.push("conversions = ?");
    params.push(input.conversions);
  }
  if (input.roas !== undefined) {
    sets.push("roas = ?");
    params.push(input.roas);
  }
  if (input.start_date !== undefined) {
    sets.push("start_date = ?");
    params.push(input.start_date);
  }
  if (input.end_date !== undefined) {
    sets.push("end_date = ?");
    params.push(input.end_date);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE campaigns SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getCampaign(id);
}

export function deleteCampaign(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM campaigns WHERE id = ?").run(id);
  return result.changes > 0;
}

export function pauseCampaign(id: string): Campaign | null {
  return updateCampaign(id, { status: "paused" });
}

export function resumeCampaign(id: string): Campaign | null {
  return updateCampaign(id, { status: "active" });
}

export function countCampaigns(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM campaigns").get() as { count: number };
  return row.count;
}

// --- Ad Group CRUD ---

export interface CreateAdGroupInput {
  campaign_id: string;
  name: string;
  targeting?: Record<string, unknown>;
  status?: CampaignStatus;
}

export function createAdGroup(input: CreateAdGroupInput): AdGroup {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const targeting = JSON.stringify(input.targeting || {});

  db.prepare(
    `INSERT INTO ad_groups (id, campaign_id, name, targeting, status)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    id,
    input.campaign_id,
    input.name,
    targeting,
    input.status || "draft"
  );

  return getAdGroup(id)!;
}

export function getAdGroup(id: string): AdGroup | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM ad_groups WHERE id = ?").get(id) as AdGroupRow | null;
  return row ? rowToAdGroup(row) : null;
}

export function listAdGroups(campaign_id?: string): AdGroup[] {
  const db = getDatabase();
  let sql = "SELECT * FROM ad_groups";
  const params: unknown[] = [];

  if (campaign_id) {
    sql += " WHERE campaign_id = ?";
    params.push(campaign_id);
  }

  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params) as AdGroupRow[];
  return rows.map(rowToAdGroup);
}

export function deleteAdGroup(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM ad_groups WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Ad CRUD ---

export interface CreateAdInput {
  ad_group_id: string;
  headline: string;
  description?: string;
  creative_url?: string;
  status?: CampaignStatus;
  metrics?: Record<string, unknown>;
}

export function createAd(input: CreateAdInput): Ad {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metrics = JSON.stringify(input.metrics || {});

  db.prepare(
    `INSERT INTO ads (id, ad_group_id, headline, description, creative_url, status, metrics)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.ad_group_id,
    input.headline,
    input.description || null,
    input.creative_url || null,
    input.status || "draft",
    metrics
  );

  return getAd(id)!;
}

export function getAd(id: string): Ad | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM ads WHERE id = ?").get(id) as AdRow | null;
  return row ? rowToAd(row) : null;
}

export function listAds(ad_group_id?: string): Ad[] {
  const db = getDatabase();
  let sql = "SELECT * FROM ads";
  const params: unknown[] = [];

  if (ad_group_id) {
    sql += " WHERE ad_group_id = ?";
    params.push(ad_group_id);
  }

  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params) as AdRow[];
  return rows.map(rowToAd);
}

export function deleteAd(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM ads WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Aggregation helpers ---

export interface CampaignStats {
  total_campaigns: number;
  active_campaigns: number;
  total_spend: number;
  total_impressions: number;
  total_clicks: number;
  total_conversions: number;
  avg_roas: number;
}

export function getCampaignStats(): CampaignStats {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT
      COUNT(*) as total_campaigns,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_campaigns,
      COALESCE(SUM(spend), 0) as total_spend,
      COALESCE(SUM(impressions), 0) as total_impressions,
      COALESCE(SUM(clicks), 0) as total_clicks,
      COALESCE(SUM(conversions), 0) as total_conversions,
      COALESCE(AVG(CASE WHEN roas > 0 THEN roas END), 0) as avg_roas
    FROM campaigns
  `).get() as CampaignStats;
  return row;
}

export interface SpendByPlatform {
  platform: Platform;
  total_spend: number;
  campaign_count: number;
}

export function getSpendByPlatform(): SpendByPlatform[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT
      platform,
      COALESCE(SUM(spend), 0) as total_spend,
      COUNT(*) as campaign_count
    FROM campaigns
    GROUP BY platform
    ORDER BY total_spend DESC
  `).all() as SpendByPlatform[];
  return rows;
}

export function getPlatforms(): string[] {
  const db = getDatabase();
  const rows = db.prepare(
    "SELECT DISTINCT platform FROM campaigns ORDER BY platform"
  ).all() as { platform: string }[];
  return rows.map((r) => r.platform);
}

// --- QoL Features ---

// 1. Bulk pause/resume by platform
export interface BulkUpdateResult {
  updated_count: number;
  platform: Platform;
  new_status: CampaignStatus;
}

export function bulkPause(platform: Platform): BulkUpdateResult {
  const db = getDatabase();
  const result = db.prepare(
    "UPDATE campaigns SET status = 'paused', updated_at = datetime('now') WHERE platform = ? AND status = 'active'"
  ).run(platform);
  return { updated_count: result.changes, platform, new_status: "paused" };
}

export function bulkResume(platform: Platform): BulkUpdateResult {
  const db = getDatabase();
  const result = db.prepare(
    "UPDATE campaigns SET status = 'active', updated_at = datetime('now') WHERE platform = ? AND status = 'paused'"
  ).run(platform);
  return { updated_count: result.changes, platform, new_status: "active" };
}

// 2. Performance ranking
export type RankMetric = "roas" | "ctr" | "spend";

export function getRankedCampaigns(sortBy: RankMetric = "roas", limit: number = 10): Campaign[] {
  const db = getDatabase();
  let orderExpr: string;

  switch (sortBy) {
    case "roas":
      orderExpr = "roas DESC";
      break;
    case "ctr":
      // CTR = clicks / impressions (handle division by zero)
      orderExpr = "CASE WHEN impressions > 0 THEN CAST(clicks AS REAL) / impressions ELSE 0 END DESC";
      break;
    case "spend":
      orderExpr = "spend DESC";
      break;
    default:
      orderExpr = "roas DESC";
  }

  const rows = db.prepare(
    `SELECT * FROM campaigns ORDER BY ${orderExpr} LIMIT ?`
  ).all(limit) as CampaignRow[];
  return rows.map(rowToCampaign);
}

// 3. Budget alerts
export interface BudgetStatus {
  campaign_id: string;
  campaign_name: string;
  over_budget: boolean;
  daily_remaining: number;
  total_remaining: number;
  pct_used: number;
  days_active: number;
  expected_spend: number;
}

export function checkBudgetStatus(id: string): BudgetStatus | null {
  const campaign = getCampaign(id);
  if (!campaign) return null;

  const now = new Date();
  let daysActive = 1;

  if (campaign.start_date) {
    const start = new Date(campaign.start_date);
    const diffMs = now.getTime() - start.getTime();
    daysActive = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  const expectedSpend = campaign.budget_daily * daysActive;
  const overBudget = campaign.budget_total > 0
    ? campaign.spend > campaign.budget_total
    : campaign.spend > expectedSpend;

  const dailySpentToday = daysActive > 0 ? campaign.spend / daysActive : campaign.spend;
  const dailyRemaining = Math.max(0, campaign.budget_daily - dailySpentToday);

  const totalRemaining = campaign.budget_total > 0
    ? Math.max(0, campaign.budget_total - campaign.spend)
    : Math.max(0, expectedSpend - campaign.spend);

  const pctUsed = campaign.budget_total > 0
    ? (campaign.spend / campaign.budget_total) * 100
    : expectedSpend > 0 ? (campaign.spend / expectedSpend) * 100 : 0;

  return {
    campaign_id: id,
    campaign_name: campaign.name,
    over_budget: overBudget,
    daily_remaining: Math.round(dailyRemaining * 100) / 100,
    total_remaining: Math.round(totalRemaining * 100) / 100,
    pct_used: Math.round(pctUsed * 100) / 100,
    days_active: daysActive,
    expected_spend: Math.round(expectedSpend * 100) / 100,
  };
}

// 4. Cross-platform comparison
export interface PlatformComparison {
  platform: Platform;
  campaign_count: number;
  total_spend: number;
  total_impressions: number;
  total_clicks: number;
  total_conversions: number;
  avg_roas: number;
  avg_ctr: number;
  avg_cpa: number;
}

export function comparePlatforms(): PlatformComparison[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT
      platform,
      COUNT(*) as campaign_count,
      COALESCE(SUM(spend), 0) as total_spend,
      COALESCE(SUM(impressions), 0) as total_impressions,
      COALESCE(SUM(clicks), 0) as total_clicks,
      COALESCE(SUM(conversions), 0) as total_conversions,
      COALESCE(AVG(CASE WHEN roas > 0 THEN roas END), 0) as avg_roas,
      CASE WHEN SUM(impressions) > 0
        THEN CAST(SUM(clicks) AS REAL) / SUM(impressions) * 100
        ELSE 0
      END as avg_ctr,
      CASE WHEN SUM(conversions) > 0
        THEN SUM(spend) / SUM(conversions)
        ELSE 0
      END as avg_cpa
    FROM campaigns
    GROUP BY platform
    ORDER BY total_spend DESC
  `).all() as PlatformComparison[];
  return rows;
}

// 5. CSV export
export function exportCampaigns(format: "csv" | "json" = "csv"): string {
  const campaigns = listCampaigns();

  if (format === "json") {
    return JSON.stringify(campaigns, null, 2);
  }

  // CSV format
  const headers = [
    "id", "platform", "name", "status", "budget_daily", "budget_total",
    "spend", "impressions", "clicks", "conversions", "roas",
    "start_date", "end_date", "created_at", "updated_at",
  ];

  const rows = campaigns.map((c) =>
    headers.map((h) => {
      const val = c[h as keyof Campaign];
      if (val === null || val === undefined) return "";
      if (typeof val === "object") return JSON.stringify(val);
      const str = String(val);
      // Escape CSV fields that contain commas or quotes
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

// 6. Campaign cloning
export function cloneCampaign(id: string, newName: string): Campaign | null {
  const original = getCampaign(id);
  if (!original) return null;

  const db = getDatabase();

  // Clone the campaign itself (reset metrics)
  const cloned = createCampaign({
    platform: original.platform,
    name: newName,
    status: "draft",
    budget_daily: original.budget_daily,
    budget_total: original.budget_total,
    start_date: original.start_date || undefined,
    end_date: original.end_date || undefined,
    metadata: original.metadata,
  });

  // Clone ad groups and their ads
  const adGroups = listAdGroups(id);
  for (const ag of adGroups) {
    const clonedGroup = createAdGroup({
      campaign_id: cloned.id,
      name: ag.name,
      targeting: ag.targeting,
      status: "draft",
    });

    const ads = listAds(ag.id);
    for (const ad of ads) {
      createAd({
        ad_group_id: clonedGroup.id,
        headline: ad.headline,
        description: ad.description || undefined,
        creative_url: ad.creative_url || undefined,
        status: "draft",
        metrics: {},
      });
    }
  }

  return getCampaign(cloned.id)!;
}

// 7. Budget remaining (reuses checkBudgetStatus but provides a focused view)
export interface BudgetRemaining {
  campaign_id: string;
  campaign_name: string;
  budget_daily: number;
  budget_total: number;
  spend: number;
  daily_remaining: number;
  total_remaining: number;
  days_remaining_at_daily_rate: number;
}

export function getBudgetRemaining(id: string): BudgetRemaining | null {
  const campaign = getCampaign(id);
  if (!campaign) return null;

  const now = new Date();
  let daysActive = 1;
  if (campaign.start_date) {
    const start = new Date(campaign.start_date);
    const diffMs = now.getTime() - start.getTime();
    daysActive = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  const avgDailySpend = campaign.spend / daysActive;
  const dailyRemaining = Math.max(0, campaign.budget_daily - avgDailySpend);
  const totalRemaining = campaign.budget_total > 0
    ? Math.max(0, campaign.budget_total - campaign.spend)
    : 0;
  const daysRemainingAtRate = avgDailySpend > 0 && campaign.budget_total > 0
    ? Math.floor(totalRemaining / avgDailySpend)
    : 0;

  return {
    campaign_id: id,
    campaign_name: campaign.name,
    budget_daily: campaign.budget_daily,
    budget_total: campaign.budget_total,
    spend: campaign.spend,
    daily_remaining: Math.round(dailyRemaining * 100) / 100,
    total_remaining: Math.round(totalRemaining * 100) / 100,
    days_remaining_at_daily_rate: daysRemainingAtRate,
  };
}

// 8. Ad group stats — aggregate metrics for ads in a group
export interface AdGroupStats {
  ad_group_id: string;
  ad_group_name: string;
  campaign_id: string;
  total_ads: number;
  active_ads: number;
  metrics: Record<string, number>;
}

export function getAdGroupStats(adGroupId: string): AdGroupStats | null {
  const adGroup = getAdGroup(adGroupId);
  if (!adGroup) return null;

  const ads = listAds(adGroupId);
  const activeAds = ads.filter((a) => a.status === "active").length;

  // Aggregate numeric metrics from all ads
  const aggregated: Record<string, number> = {};
  for (const ad of ads) {
    for (const [key, value] of Object.entries(ad.metrics)) {
      if (typeof value === "number") {
        aggregated[key] = (aggregated[key] || 0) + value;
      }
    }
  }

  return {
    ad_group_id: adGroupId,
    ad_group_name: adGroup.name,
    campaign_id: adGroup.campaign_id,
    total_ads: ads.length,
    active_ads: activeAds,
    metrics: aggregated,
  };
}
