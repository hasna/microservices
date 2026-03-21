#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createDomain,
  getDomain,
  listDomains,
  updateDomain,
  deleteDomain,
  countDomains,
  searchDomains,
  getByRegistrar,
  listExpiring,
  listSslExpiring,
  getDomainStats,
  createDnsRecord,
  listDnsRecords,
  updateDnsRecord,
  deleteDnsRecord,
  createAlert,
  listAlerts,
  deleteAlert,
} from "../db/domains.js";

const server = new McpServer({
  name: "microservice-domains",
  version: "0.0.1",
});

// --- Domains ---

server.registerTool(
  "create_domain",
  {
    title: "Create Domain",
    description: "Add a new domain to the portfolio.",
    inputSchema: {
      name: z.string(),
      registrar: z.string().optional(),
      status: z.enum(["active", "expired", "transferring", "redemption"]).optional(),
      registered_at: z.string().optional(),
      expires_at: z.string().optional(),
      auto_renew: z.boolean().optional(),
      nameservers: z.array(z.string()).optional(),
      ssl_expires_at: z.string().optional(),
      ssl_issuer: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    const domain = createDomain(params);
    return { content: [{ type: "text", text: JSON.stringify(domain, null, 2) }] };
  }
);

server.registerTool(
  "get_domain",
  {
    title: "Get Domain",
    description: "Get a domain by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const domain = getDomain(id);
    if (!domain) {
      return { content: [{ type: "text", text: `Domain '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(domain, null, 2) }] };
  }
);

server.registerTool(
  "list_domains",
  {
    title: "List Domains",
    description: "List domains with optional filters.",
    inputSchema: {
      search: z.string().optional(),
      status: z.enum(["active", "expired", "transferring", "redemption"]).optional(),
      registrar: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const domains = listDomains(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ domains, count: domains.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_domain",
  {
    title: "Update Domain",
    description: "Update an existing domain.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      registrar: z.string().optional(),
      status: z.enum(["active", "expired", "transferring", "redemption"]).optional(),
      registered_at: z.string().optional(),
      expires_at: z.string().optional(),
      auto_renew: z.boolean().optional(),
      nameservers: z.array(z.string()).optional(),
      ssl_expires_at: z.string().optional(),
      ssl_issuer: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const domain = updateDomain(id, input);
    if (!domain) {
      return { content: [{ type: "text", text: `Domain '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(domain, null, 2) }] };
  }
);

server.registerTool(
  "delete_domain",
  {
    title: "Delete Domain",
    description: "Delete a domain by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteDomain(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_domains",
  {
    title: "Search Domains",
    description: "Search domains by name, registrar, or notes.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchDomains(query);
    return {
      content: [
        { type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "count_domains",
  {
    title: "Count Domains",
    description: "Get the total number of domains.",
    inputSchema: {},
  },
  async () => {
    const count = countDomains();
    return { content: [{ type: "text", text: JSON.stringify({ count }) }] };
  }
);

server.registerTool(
  "list_expiring_domains",
  {
    title: "List Expiring Domains",
    description: "List domains expiring within N days.",
    inputSchema: { days: z.number().default(30) },
  },
  async ({ days }) => {
    const domains = listExpiring(days);
    return {
      content: [
        { type: "text", text: JSON.stringify({ domains, count: domains.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "list_ssl_expiring",
  {
    title: "List SSL Expiring",
    description: "List domains with SSL certificates expiring within N days.",
    inputSchema: { days: z.number().default(30) },
  },
  async ({ days }) => {
    const domains = listSslExpiring(days);
    return {
      content: [
        { type: "text", text: JSON.stringify({ domains, count: domains.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_domains_by_registrar",
  {
    title: "Get Domains by Registrar",
    description: "List all domains from a specific registrar.",
    inputSchema: { registrar: z.string() },
  },
  async ({ registrar }) => {
    const domains = getByRegistrar(registrar);
    return {
      content: [
        { type: "text", text: JSON.stringify({ domains, count: domains.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_domain_stats",
  {
    title: "Get Domain Stats",
    description: "Get domain portfolio statistics.",
    inputSchema: {},
  },
  async () => {
    const stats = getDomainStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// --- DNS Records ---

server.registerTool(
  "create_dns_record",
  {
    title: "Create DNS Record",
    description: "Create a new DNS record for a domain.",
    inputSchema: {
      domain_id: z.string(),
      type: z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV"]),
      name: z.string(),
      value: z.string(),
      ttl: z.number().optional(),
      priority: z.number().optional(),
    },
  },
  async (params) => {
    const record = createDnsRecord(params);
    return { content: [{ type: "text", text: JSON.stringify(record, null, 2) }] };
  }
);

server.registerTool(
  "list_dns_records",
  {
    title: "List DNS Records",
    description: "List DNS records for a domain.",
    inputSchema: {
      domain_id: z.string(),
      type: z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV"]).optional(),
    },
  },
  async ({ domain_id, type }) => {
    const records = listDnsRecords(domain_id, type);
    return {
      content: [
        { type: "text", text: JSON.stringify({ records, count: records.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_dns_record",
  {
    title: "Update DNS Record",
    description: "Update a DNS record.",
    inputSchema: {
      id: z.string(),
      type: z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV"]).optional(),
      name: z.string().optional(),
      value: z.string().optional(),
      ttl: z.number().optional(),
      priority: z.number().optional(),
    },
  },
  async ({ id, ...input }) => {
    const record = updateDnsRecord(id, input);
    if (!record) {
      return { content: [{ type: "text", text: `DNS record '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(record, null, 2) }] };
  }
);

server.registerTool(
  "delete_dns_record",
  {
    title: "Delete DNS Record",
    description: "Delete a DNS record by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteDnsRecord(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Alerts ---

server.registerTool(
  "create_alert",
  {
    title: "Create Alert",
    description: "Set an alert for a domain (expiry, SSL expiry, or DNS change).",
    inputSchema: {
      domain_id: z.string(),
      type: z.enum(["expiry", "ssl_expiry", "dns_change"]),
      trigger_days_before: z.number().optional(),
    },
  },
  async (params) => {
    const alert = createAlert(params);
    return { content: [{ type: "text", text: JSON.stringify(alert, null, 2) }] };
  }
);

server.registerTool(
  "list_alerts",
  {
    title: "List Alerts",
    description: "List alerts for a domain.",
    inputSchema: { domain_id: z.string() },
  },
  async ({ domain_id }) => {
    const alerts = listAlerts(domain_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ alerts, count: alerts.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "delete_alert",
  {
    title: "Delete Alert",
    description: "Delete an alert by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteAlert(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-domains MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
