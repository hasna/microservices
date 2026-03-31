#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import { createPlan, getPlan, listPlans } from "../lib/plans.js";
import { getSubscription, getWorkspaceSubscription, listSubscriptions } from "../lib/subscriptions.js";
import { listWorkspaceInvoices } from "../lib/invoices.js";

const server = new Server({ name: "microservice-billing", version: "0.0.1" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  {
    name: "billing_list_plans",
    description: "List billing plans",
    inputSchema: { type: "object", properties: { active_only: { type: "boolean" } }, required: [] }
  },
  {
    name: "billing_create_plan",
    description: "Create a billing plan",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        amount_cents: { type: "number" },
        currency: { type: "string" },
        interval: { type: "string", enum: ["month", "year", "one_time"] },
        stripe_price_id: { type: "string" },
        active: { type: "boolean" }
      },
      required: ["name", "amount_cents"]
    }
  },
  {
    name: "billing_get_subscription",
    description: "Get a subscription by ID",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
  },
  {
    name: "billing_get_workspace_subscription",
    description: "Get the active subscription for a workspace",
    inputSchema: { type: "object", properties: { workspace_id: { type: "string" } }, required: ["workspace_id"] }
  },
  {
    name: "billing_list_invoices",
    description: "List invoices for a workspace",
    inputSchema: { type: "object", properties: { workspace_id: { type: "string" } }, required: ["workspace_id"] }
  },
]}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb(); const { name, arguments: args } = req.params; const a = args as Record<string, unknown>;
  const t = (d: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(d, null, 2) }] });

  if (name === "billing_list_plans") return t(await listPlans(sql, { activeOnly: Boolean(a.active_only) }));
  if (name === "billing_create_plan") return t(await createPlan(sql, {
    name: String(a.name),
    description: a.description ? String(a.description) : undefined,
    amount_cents: Number(a.amount_cents),
    currency: a.currency ? String(a.currency) : undefined,
    interval: a.interval as any,
    stripe_price_id: a.stripe_price_id ? String(a.stripe_price_id) : undefined,
    active: a.active !== undefined ? Boolean(a.active) : undefined,
  }));
  if (name === "billing_get_subscription") return t(await getSubscription(sql, String(a.id)));
  if (name === "billing_get_workspace_subscription") return t(await getWorkspaceSubscription(sql, String(a.workspace_id)));
  if (name === "billing_list_invoices") return t(await listWorkspaceInvoices(sql, String(a.workspace_id)));

  throw new Error(`Unknown tool: ${name}`);
});

async function main() { const sql = getDb(); await migrate(sql); await server.connect(new StdioServerTransport()); }
main().catch(console.error);
