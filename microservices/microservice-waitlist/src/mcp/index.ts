#!/usr/bin/env bun
/**
 * MCP server for microservice-waitlist.
 *
 * Exposes waitlist functionality as MCP tools for AI agents.
 * Run via: microservice-waitlist mcp  (or configure in claude_desktop_config.json)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import {
  joinWaitlist,
  getPosition,
  inviteBatch,
  listEntries,
  updateScore,
} from "../lib/entries.js";
import { createCampaign, listCampaigns } from "../lib/campaigns.js";
import { getWaitlistStats } from "../lib/stats.js";

const server = new Server(
  { name: "microservice-waitlist", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "waitlist_join",
      description: "Join a waitlist campaign. Creates an entry and optionally credits a referrer.",
      inputSchema: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "Campaign UUID" },
          email: { type: "string", description: "Entrant's email address" },
          name: { type: "string", description: "Entrant's name (optional)" },
          referral_code: { type: "string", description: "Referral code from another entry (optional)" },
          metadata: { type: "object", description: "Additional metadata (optional)" },
        },
        required: ["campaign_id", "email"],
      },
    },
    {
      name: "waitlist_get_position",
      description: "Get the queue position for a waitlist entry.",
      inputSchema: {
        type: "object",
        properties: {
          entry_id: { type: "string", description: "Entry UUID" },
        },
        required: ["entry_id"],
      },
    },
    {
      name: "waitlist_invite_batch",
      description: "Invite a batch of top-priority waiting entries.",
      inputSchema: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "Campaign UUID" },
          count: { type: "number", description: "Number of entries to invite" },
        },
        required: ["campaign_id", "count"],
      },
    },
    {
      name: "waitlist_get_stats",
      description: "Get statistics for a waitlist campaign.",
      inputSchema: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "Campaign UUID" },
        },
        required: ["campaign_id"],
      },
    },
    {
      name: "waitlist_create_campaign",
      description: "Create a new waitlist campaign.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Unique campaign name" },
          description: { type: "string", description: "Campaign description (optional)" },
          status: { type: "string", enum: ["active", "paused", "closed"], description: "Campaign status (default: active)" },
        },
        required: ["name"],
      },
    },
    {
      name: "waitlist_list_entries",
      description: "List entries for a campaign, optionally filtered by status.",
      inputSchema: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "Campaign UUID" },
          status: { type: "string", enum: ["waiting", "invited", "joined", "removed"], description: "Filter by status (optional)" },
          limit: { type: "number", description: "Max entries to return (default 50)" },
        },
        required: ["campaign_id"],
      },
    },
    {
      name: "waitlist_update_score",
      description: "Manually update the priority score for an entry.",
      inputSchema: {
        type: "object",
        properties: {
          entry_id: { type: "string", description: "Entry UUID" },
          score: { type: "number", description: "New priority score" },
        },
        required: ["entry_id", "score"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as Record<string, unknown>;

  const text = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  if (name === "waitlist_join") {
    return text(await joinWaitlist(sql, {
      campaignId: String(a.campaign_id),
      email: String(a.email),
      name: a.name ? String(a.name) : undefined,
      referralCode: a.referral_code ? String(a.referral_code) : undefined,
      metadata: a.metadata as Record<string, unknown> | undefined,
    }));
  }

  if (name === "waitlist_get_position") {
    return text(await getPosition(sql, String(a.entry_id)));
  }

  if (name === "waitlist_invite_batch") {
    return text(await inviteBatch(sql, String(a.campaign_id), Number(a.count)));
  }

  if (name === "waitlist_get_stats") {
    return text(await getWaitlistStats(sql, String(a.campaign_id)));
  }

  if (name === "waitlist_create_campaign") {
    return text(await createCampaign(sql, {
      name: String(a.name),
      description: a.description ? String(a.description) : undefined,
      status: a.status as "active" | "paused" | "closed" | undefined,
    }));
  }

  if (name === "waitlist_list_entries") {
    return text(await listEntries(
      sql,
      String(a.campaign_id),
      a.status ? String(a.status) : undefined,
      a.limit ? Number(a.limit) : undefined
    ));
  }

  if (name === "waitlist_update_score") {
    await updateScore(sql, String(a.entry_id), Number(a.score));
    return text({ ok: true });
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  const sql = getDb();
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
