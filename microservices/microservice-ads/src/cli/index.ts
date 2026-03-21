#!/usr/bin/env bun

import { Command } from "commander";
import {
  createCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
  deleteCampaign,
  pauseCampaign,
  resumeCampaign,
  getCampaignStats,
  getSpendByPlatform,
  getPlatforms,
} from "../db/campaigns.js";
import {
  createAdGroup,
  listAdGroups,
} from "../db/campaigns.js";
import {
  createAd,
  listAds,
} from "../db/campaigns.js";

const program = new Command();

program
  .name("microservice-ads")
  .description("Ad campaign management microservice")
  .version("0.0.1");

// --- Campaigns ---

const campaignCmd = program
  .command("campaign")
  .description("Campaign management");

campaignCmd
  .command("create")
  .description("Create a new campaign")
  .requiredOption("--platform <platform>", "Platform (google/meta/linkedin/tiktok)")
  .requiredOption("--name <name>", "Campaign name")
  .option("--status <status>", "Status (draft/active/paused/completed)", "draft")
  .option("--budget-daily <amount>", "Daily budget")
  .option("--budget-total <amount>", "Total budget")
  .option("--start-date <date>", "Start date (YYYY-MM-DD)")
  .option("--end-date <date>", "End date (YYYY-MM-DD)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const campaign = createCampaign({
      platform: opts.platform,
      name: opts.name,
      status: opts.status,
      budget_daily: opts.budgetDaily ? parseFloat(opts.budgetDaily) : undefined,
      budget_total: opts.budgetTotal ? parseFloat(opts.budgetTotal) : undefined,
      start_date: opts.startDate,
      end_date: opts.endDate,
    });

    if (opts.json) {
      console.log(JSON.stringify(campaign, null, 2));
    } else {
      console.log(`Created campaign: ${campaign.name} [${campaign.platform}] (${campaign.id})`);
    }
  });

campaignCmd
  .command("list")
  .description("List campaigns")
  .option("--platform <platform>", "Filter by platform")
  .option("--status <status>", "Filter by status")
  .option("--search <query>", "Search by name")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const campaigns = listCampaigns({
      platform: opts.platform,
      status: opts.status,
      search: opts.search,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(campaigns, null, 2));
    } else {
      if (campaigns.length === 0) {
        console.log("No campaigns found.");
        return;
      }
      for (const c of campaigns) {
        const budget = c.budget_total > 0 ? ` $${c.budget_total}` : "";
        console.log(`  [${c.platform}] ${c.name} (${c.status})${budget}`);
      }
      console.log(`\n${campaigns.length} campaign(s)`);
    }
  });

campaignCmd
  .command("get")
  .description("Get a campaign by ID")
  .argument("<id>", "Campaign ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const campaign = getCampaign(id);
    if (!campaign) {
      console.error(`Campaign '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(campaign, null, 2));
    } else {
      console.log(`${campaign.name} [${campaign.platform}]`);
      console.log(`  Status: ${campaign.status}`);
      console.log(`  Budget: $${campaign.budget_daily}/day, $${campaign.budget_total} total`);
      console.log(`  Spend: $${campaign.spend}`);
      console.log(`  Impressions: ${campaign.impressions}, Clicks: ${campaign.clicks}, Conversions: ${campaign.conversions}`);
      console.log(`  ROAS: ${campaign.roas}`);
      if (campaign.start_date) console.log(`  Start: ${campaign.start_date}`);
      if (campaign.end_date) console.log(`  End: ${campaign.end_date}`);
    }
  });

campaignCmd
  .command("update")
  .description("Update a campaign")
  .argument("<id>", "Campaign ID")
  .option("--platform <platform>", "Platform")
  .option("--name <name>", "Campaign name")
  .option("--status <status>", "Status")
  .option("--budget-daily <amount>", "Daily budget")
  .option("--budget-total <amount>", "Total budget")
  .option("--spend <amount>", "Total spend")
  .option("--impressions <n>", "Impressions")
  .option("--clicks <n>", "Clicks")
  .option("--conversions <n>", "Conversions")
  .option("--roas <n>", "ROAS")
  .option("--start-date <date>", "Start date")
  .option("--end-date <date>", "End date")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.platform !== undefined) input.platform = opts.platform;
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.status !== undefined) input.status = opts.status;
    if (opts.budgetDaily !== undefined) input.budget_daily = parseFloat(opts.budgetDaily);
    if (opts.budgetTotal !== undefined) input.budget_total = parseFloat(opts.budgetTotal);
    if (opts.spend !== undefined) input.spend = parseFloat(opts.spend);
    if (opts.impressions !== undefined) input.impressions = parseInt(opts.impressions);
    if (opts.clicks !== undefined) input.clicks = parseInt(opts.clicks);
    if (opts.conversions !== undefined) input.conversions = parseInt(opts.conversions);
    if (opts.roas !== undefined) input.roas = parseFloat(opts.roas);
    if (opts.startDate !== undefined) input.start_date = opts.startDate;
    if (opts.endDate !== undefined) input.end_date = opts.endDate;

    const campaign = updateCampaign(id, input);
    if (!campaign) {
      console.error(`Campaign '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(campaign, null, 2));
    } else {
      console.log(`Updated: ${campaign.name} [${campaign.platform}]`);
    }
  });

campaignCmd
  .command("delete")
  .description("Delete a campaign")
  .argument("<id>", "Campaign ID")
  .action((id) => {
    const deleted = deleteCampaign(id);
    if (deleted) {
      console.log(`Deleted campaign ${id}`);
    } else {
      console.error(`Campaign '${id}' not found.`);
      process.exit(1);
    }
  });

campaignCmd
  .command("pause")
  .description("Pause a campaign")
  .argument("<id>", "Campaign ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const campaign = pauseCampaign(id);
    if (!campaign) {
      console.error(`Campaign '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(campaign, null, 2));
    } else {
      console.log(`Paused: ${campaign.name}`);
    }
  });

campaignCmd
  .command("resume")
  .description("Resume a paused campaign")
  .argument("<id>", "Campaign ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const campaign = resumeCampaign(id);
    if (!campaign) {
      console.error(`Campaign '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(campaign, null, 2));
    } else {
      console.log(`Resumed: ${campaign.name}`);
    }
  });

// --- Ad Groups ---

const adGroupCmd = program
  .command("ad-group")
  .description("Ad group management");

adGroupCmd
  .command("create")
  .description("Create a new ad group")
  .requiredOption("--campaign <id>", "Campaign ID")
  .requiredOption("--name <name>", "Ad group name")
  .option("--targeting <json>", "Targeting JSON")
  .option("--status <status>", "Status", "draft")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const adGroup = createAdGroup({
      campaign_id: opts.campaign,
      name: opts.name,
      targeting: opts.targeting ? JSON.parse(opts.targeting) : undefined,
      status: opts.status,
    });

    if (opts.json) {
      console.log(JSON.stringify(adGroup, null, 2));
    } else {
      console.log(`Created ad group: ${adGroup.name} (${adGroup.id})`);
    }
  });

adGroupCmd
  .command("list")
  .description("List ad groups")
  .option("--campaign <id>", "Filter by campaign ID")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const adGroups = listAdGroups(opts.campaign);

    if (opts.json) {
      console.log(JSON.stringify(adGroups, null, 2));
    } else {
      if (adGroups.length === 0) {
        console.log("No ad groups found.");
        return;
      }
      for (const ag of adGroups) {
        console.log(`  ${ag.name} (${ag.status}) — campaign: ${ag.campaign_id}`);
      }
      console.log(`\n${adGroups.length} ad group(s)`);
    }
  });

// --- Ads ---

const adCmd = program
  .command("ad")
  .description("Ad management");

adCmd
  .command("create")
  .description("Create a new ad")
  .requiredOption("--ad-group <id>", "Ad group ID")
  .requiredOption("--headline <text>", "Ad headline")
  .option("--description <text>", "Ad description")
  .option("--creative-url <url>", "Creative URL")
  .option("--status <status>", "Status", "draft")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const ad = createAd({
      ad_group_id: opts.adGroup,
      headline: opts.headline,
      description: opts.description,
      creative_url: opts.creativeUrl,
      status: opts.status,
    });

    if (opts.json) {
      console.log(JSON.stringify(ad, null, 2));
    } else {
      console.log(`Created ad: ${ad.headline} (${ad.id})`);
    }
  });

adCmd
  .command("list")
  .description("List ads")
  .option("--ad-group <id>", "Filter by ad group ID")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const ads = listAds(opts.adGroup);

    if (opts.json) {
      console.log(JSON.stringify(ads, null, 2));
    } else {
      if (ads.length === 0) {
        console.log("No ads found.");
        return;
      }
      for (const a of ads) {
        console.log(`  ${a.headline} (${a.status})`);
      }
      console.log(`\n${ads.length} ad(s)`);
    }
  });

// --- Stats & Reports ---

program
  .command("stats")
  .description("Show campaign statistics")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getCampaignStats();

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log("Campaign Statistics:");
      console.log(`  Total campaigns: ${stats.total_campaigns}`);
      console.log(`  Active campaigns: ${stats.active_campaigns}`);
      console.log(`  Total spend: $${stats.total_spend.toFixed(2)}`);
      console.log(`  Total impressions: ${stats.total_impressions}`);
      console.log(`  Total clicks: ${stats.total_clicks}`);
      console.log(`  Total conversions: ${stats.total_conversions}`);
      console.log(`  Avg ROAS: ${stats.avg_roas.toFixed(2)}`);
    }
  });

program
  .command("spend")
  .description("Show spend by platform")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const spend = getSpendByPlatform();

    if (opts.json) {
      console.log(JSON.stringify(spend, null, 2));
    } else {
      if (spend.length === 0) {
        console.log("No spend data.");
        return;
      }
      console.log("Spend by Platform:");
      for (const s of spend) {
        console.log(`  ${s.platform}: $${s.total_spend.toFixed(2)} (${s.campaign_count} campaigns)`);
      }
    }
  });

program
  .command("platforms")
  .description("List platforms with campaigns")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const platforms = getPlatforms();

    if (opts.json) {
      console.log(JSON.stringify(platforms, null, 2));
    } else {
      if (platforms.length === 0) {
        console.log("No platforms found.");
        return;
      }
      console.log("Platforms:");
      for (const p of platforms) {
        console.log(`  ${p}`);
      }
    }
  });

program
  .command("providers")
  .description("List supported ad providers")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const providers = ["google", "meta", "linkedin", "tiktok"];

    if (opts.json) {
      console.log(JSON.stringify(providers, null, 2));
    } else {
      console.log("Supported Ad Providers:");
      for (const p of providers) {
        console.log(`  ${p}`);
      }
    }
  });

program.parse(process.argv);
