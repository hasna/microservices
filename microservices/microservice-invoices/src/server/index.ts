#!/usr/bin/env bun
/**
 * HTTP server for microservice-invoices
 * Serves REST API + dashboard
 */

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createInvoice,
  getInvoice,
  getInvoiceWithItems,
  listInvoices,
  updateInvoiceStatus,
  deleteInvoice,
  addLineItem,
  removeLineItem,
  recordPayment,
  getInvoiceSummary,
} from "../db/invoices.js";
import { createClient, getClient, listClients, updateClient, deleteClient } from "../db/clients.js";
import {
  createBusinessProfile,
  listBusinessProfiles,
  getTaxRulesForCountry,
  listAllTaxRules,
  determineTax,
} from "../db/business.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env["PORT"] || "19500");

// Resolve dashboard dist
const dashboardDir = join(__dirname, "..", "..", "dashboard", "dist");
const hasDashboard = existsSync(dashboardDir);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function parseBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // --- API Routes ---

    // Invoices
    if (path === "/api/invoices" && method === "GET") {
      const status = url.searchParams.get("status") || undefined;
      const client_id = url.searchParams.get("client_id") || undefined;
      return json(listInvoices({ status, client_id }));
    }
    if (path === "/api/invoices" && method === "POST") {
      const body = await parseBody(req);
      return json(createInvoice(body), 201);
    }
    if (path === "/api/invoices/summary" && method === "GET") {
      return json(getInvoiceSummary());
    }
    if (path.match(/^\/api\/invoices\/([^/]+)$/) && method === "GET") {
      const id = path.split("/")[3];
      const inv = getInvoiceWithItems(id);
      return inv ? json(inv) : json({ error: "Not found" }, 404);
    }
    if (path.match(/^\/api\/invoices\/([^/]+)$/) && method === "DELETE") {
      const id = path.split("/")[3];
      return json({ deleted: deleteInvoice(id) });
    }
    if (path.match(/^\/api\/invoices\/([^/]+)\/status$/) && method === "PATCH") {
      const id = path.split("/")[3];
      const { status } = await parseBody(req);
      const inv = updateInvoiceStatus(id, status);
      return inv ? json(inv) : json({ error: "Not found" }, 404);
    }

    // Line items
    if (path === "/api/line-items" && method === "POST") {
      const body = await parseBody(req);
      return json(addLineItem(body), 201);
    }
    if (path.match(/^\/api\/line-items\/([^/]+)$/) && method === "DELETE") {
      const id = path.split("/")[3];
      return json({ deleted: removeLineItem(id) });
    }

    // Payments
    if (path === "/api/payments" && method === "POST") {
      const body = await parseBody(req);
      return json(recordPayment(body), 201);
    }

    // Clients
    if (path === "/api/clients" && method === "GET") {
      return json(listClients(url.searchParams.get("search") || undefined));
    }
    if (path === "/api/clients" && method === "POST") {
      const body = await parseBody(req);
      return json(createClient(body), 201);
    }
    if (path.match(/^\/api\/clients\/([^/]+)$/) && method === "GET") {
      const id = path.split("/")[3];
      const cl = getClient(id);
      return cl ? json(cl) : json({ error: "Not found" }, 404);
    }
    if (path.match(/^\/api\/clients\/([^/]+)$/) && method === "DELETE") {
      const id = path.split("/")[3];
      return json({ deleted: deleteClient(id) });
    }

    // Business profiles
    if (path === "/api/business-profiles" && method === "GET") {
      return json(listBusinessProfiles());
    }
    if (path === "/api/business-profiles" && method === "POST") {
      const body = await parseBody(req);
      return json(createBusinessProfile(body), 201);
    }

    // Tax rules
    if (path === "/api/tax-rules" && method === "GET") {
      const country = url.searchParams.get("country");
      return json(country ? getTaxRulesForCountry(country) : listAllTaxRules());
    }
    if (path === "/api/tax/determine" && method === "POST") {
      const { issuer_country, client_country, client_vat_number } = await parseBody(req);
      return json(determineTax(issuer_country, client_country, client_vat_number));
    }

    // Health
    if (path === "/health") {
      return json({ status: "ok", service: "microservice-invoices" });
    }

    // --- Dashboard (static files) ---
    if (hasDashboard) {
      let filePath = join(dashboardDir, path === "/" ? "index.html" : path);
      if (!existsSync(filePath)) {
        filePath = join(dashboardDir, "index.html"); // SPA fallback
      }
      return new Response(Bun.file(filePath));
    }

    return json({ error: "Not found" }, 404);
  },
});

console.log(`microservice-invoices server running on http://localhost:${PORT}`);
