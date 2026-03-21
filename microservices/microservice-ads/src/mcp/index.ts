#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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
  createAdGroup,
  listAdGroups,
  createAd,
  listAds,
} from "../db/campaigns.js";

const server = new McpServer({
  name: "microservice-ads",
  version: "0.0.1",
});

const PlatformEnum = z.enum(["google", "meta", "linkedin", "tiktok"]);
const StatusEnum = z.enum(["draft", "active", "paused", "completed"]);

// --- Campaigns ---

server.registerTool(
  "create_campaign",
  {
    title: "Create Campaign",
    description: "Create a new ad campaign.",
    inputSchema: {
      platform: PlatformEnum,
      name: z.string(),
      status: StatusEnum.optional(),
      budget_daily: z.number().optional(),
      budget_total: z.number().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async (params) => {
    const campaign = createCampaign(params);
    return { content: [{ type: "text", text: JSON.stringify(campaign, null, 2) }] };
  }
);

server.registerTool(
  "get_campaign",
  {
    title: "Get Campaign",
    description: "Get a campaign by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const campaign = getCampaign(id);
    if (!campaign) {
      return { content: [{ type: "text", text: `Campaign '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(campaign, null, 2) }] };
  }
);

server.registerTool(
  "list_campaigns",
  {
    title: "List Campaigns",
    description: "List campaigns with optional filters.",
    inputSchema: {
      platform: PlatformEnum.optional(),
      status: StatusEnum.optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const campaigns = listCampaigns(params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ campaigns, count: campaigns.length }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "update_campaign",
  {
    title: "Update Campaign",
    description: "Update an existing campaign.",
    inputSchema: {
      id: z.string(),
      platform: PlatformEnum.optional(),
      name: z.string().optional(),
      status: StatusEnum.optional(),
      budget_daily: z.number().optional(),
      budget_total: z.number().optional(),
      spend: z.number().optional(),
      impressions: z.number().optional(),
      clicks: z.number().optional(),
      conversions: z.number().optional(),
      roas: z.number().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const campaign = updateCampaign(id, input);
    if (!campaign) {
      return { content: [{ type: "text", text: `Campaign '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(campaign, null, 2) }] };
  }
);

server.registerTool(
  "delete_campaign",
  {
    title: "Delete Campaign",
    description: "Delete a campaign by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteCampaign(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "pause_campaign",
  {
    title: "Pause Campaign",
    description: "Pause an active campaign.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const campaign = pauseCampaign(id);
    if (!campaign) {
      return { content: [{ type: "text", text: `Campaign '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(campaign, null, 2) }] };
  }
);

server.registerTool(
  "resume_campaign",
  {
    title: "Resume Campaign",
    description: "Resume a paused campaign.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const campaign = resumeCampaign(id);
    if (!campaign) {
      return { content: [{ type: "text", text: `Campaign '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(campaign, null, 2) }] };
  }
);

server.registerTool(
  "campaign_stats",
  {
    title: "Campaign Stats",
    description: "Get aggregate campaign statistics.",
    inputSchema: {},
  },
  async () => {
    const stats = getCampaignStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

server.registerTool(
  "spend_by_platform",
  {
    title: "Spend by Platform",
    description: "Get total spend broken down by platform.",
    inputSchema: {},
  },
  async () => {
    const spend = getSpendByPlatform();
    return { content: [{ type: "text", text: JSON.stringify(spend, null, 2) }] };
  }
);

server.registerTool(
  "list_platforms",
  {
    title: "List Platforms",
    description: "List platforms that have campaigns.",
    inputSchema: {},
  },
  async () => {
    const platforms = getPlatforms();
    return { content: [{ type: "text", text: JSON.stringify(platforms, null, 2) }] };
  }
);

server.registerTool(
  "list_providers",
  {
    title: "List Providers",
    description: "List all supported ad providers.",
    inputSchema: {},
  },
  async () => {
    const providers = ["google", "meta", "linkedin", "tiktok"];
    return { content: [{ type: "text", text: JSON.stringify(providers, null, 2) }] };
  }
);

// --- Ad Groups ---

server.registerTool(
  "create_ad_group",
  {
    title: "Create Ad Group",
    description: "Create a new ad group within a campaign.",
    inputSchema: {
      campaign_id: z.string(),
      name: z.string(),
      targeting: z.record(z.unknown()).optional(),
      status: StatusEnum.optional(),
    },
  },
  async (params) => {
    const adGroup = createAdGroup(params);
    return { content: [{ type: "text", text: JSON.stringify(adGroup, null, 2) }] };
  }
);

server.registerTool(
  "list_ad_groups",
  {
    title: "List Ad Groups",
    description: "List ad groups, optionally filtered by campaign.",
    inputSchema: {
      campaign_id: z.string().optional(),
    },
  },
  async ({ campaign_id }) => {
    const adGroups = listAdGroups(campaign_id);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ad_groups: adGroups, count: adGroups.length }, null, 2),
        },
      ],
    };
  }
);

// --- Ads ---

server.registerTool(
  "create_ad",
  {
    title: "Create Ad",
    description: "Create a new ad within an ad group.",
    inputSchema: {
      ad_group_id: z.string(),
      headline: z.string(),
      description: z.string().optional(),
      creative_url: z.string().optional(),
      status: StatusEnum.optional(),
      metrics: z.record(z.unknown()).optional(),
    },
  },
  async (params) => {
    const ad = createAd(params);
    return { content: [{ type: "text", text: JSON.stringify(ad, null, 2) }] };
  }
);

server.registerTool(
  "list_ads",
  {
    title: "List Ads",
    description: "List ads, optionally filtered by ad group.",
    inputSchema: {
      ad_group_id: z.string().optional(),
    },
  },
  async ({ ad_group_id }) => {
    const ads = listAds(ad_group_id);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ads, count: ads.length }, null, 2),
        },
      ],
    };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-ads MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
