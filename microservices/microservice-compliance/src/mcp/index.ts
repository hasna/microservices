#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createRequirement,
  getRequirement,
  listRequirements,
  updateRequirement,
  deleteRequirement,
  searchRequirements,
  createLicense,
  getLicense,
  listLicenses,
  updateLicense,
  deleteLicense,
  renewLicense,
  listExpiringLicenses,
  getLicenseStats,
  scheduleAudit,
  getAudit,
  listAudits,
  completeAudit,
  getAuditReport,
  deleteAudit,
  getComplianceScore,
  getFrameworkStatus,
} from "../db/compliance.js";

const server = new McpServer({
  name: "microservice-compliance",
  version: "0.0.1",
});

// --- Requirements ---

server.registerTool(
  "create_requirement",
  {
    title: "Create Requirement",
    description: "Create a new compliance requirement.",
    inputSchema: {
      name: z.string(),
      framework: z.enum(["gdpr", "soc2", "hipaa", "pci", "tax", "iso27001", "custom"]).optional(),
      status: z.enum(["compliant", "non_compliant", "in_progress", "not_applicable"]).optional(),
      description: z.string().optional(),
      evidence: z.string().optional(),
      due_date: z.string().optional(),
      reviewer: z.string().optional(),
    },
  },
  async (params) => {
    const req = createRequirement(params);
    return { content: [{ type: "text", text: JSON.stringify(req, null, 2) }] };
  }
);

server.registerTool(
  "get_requirement",
  {
    title: "Get Requirement",
    description: "Get a compliance requirement by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const req = getRequirement(id);
    if (!req) {
      return { content: [{ type: "text", text: `Requirement '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(req, null, 2) }] };
  }
);

server.registerTool(
  "list_requirements",
  {
    title: "List Requirements",
    description: "List compliance requirements with optional filters.",
    inputSchema: {
      framework: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const reqs = listRequirements(params);
    return {
      content: [{ type: "text", text: JSON.stringify({ requirements: reqs, count: reqs.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "update_requirement",
  {
    title: "Update Requirement",
    description: "Update an existing compliance requirement.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      framework: z.enum(["gdpr", "soc2", "hipaa", "pci", "tax", "iso27001", "custom"]).optional(),
      status: z.enum(["compliant", "non_compliant", "in_progress", "not_applicable"]).optional(),
      description: z.string().optional(),
      evidence: z.string().optional(),
      due_date: z.string().optional(),
      reviewed_at: z.string().optional(),
      reviewer: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const req = updateRequirement(id, input);
    if (!req) {
      return { content: [{ type: "text", text: `Requirement '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(req, null, 2) }] };
  }
);

server.registerTool(
  "delete_requirement",
  {
    title: "Delete Requirement",
    description: "Delete a compliance requirement by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteRequirement(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_requirements",
  {
    title: "Search Requirements",
    description: "Search requirements by name or description.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchRequirements(query);
    return {
      content: [{ type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) }],
    };
  }
);

// --- Licenses ---

server.registerTool(
  "create_license",
  {
    title: "Create License",
    description: "Create a new license.",
    inputSchema: {
      name: z.string(),
      type: z.enum(["software", "business", "professional", "patent", "trademark"]).optional(),
      issuer: z.string().optional(),
      license_number: z.string().optional(),
      status: z.enum(["active", "expired", "pending_renewal"]).optional(),
      issued_at: z.string().optional(),
      expires_at: z.string().optional(),
      auto_renew: z.boolean().optional(),
      cost: z.number().optional(),
    },
  },
  async (params) => {
    const lic = createLicense(params);
    return { content: [{ type: "text", text: JSON.stringify(lic, null, 2) }] };
  }
);

server.registerTool(
  "get_license",
  {
    title: "Get License",
    description: "Get a license by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const lic = getLicense(id);
    if (!lic) {
      return { content: [{ type: "text", text: `License '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(lic, null, 2) }] };
  }
);

server.registerTool(
  "list_licenses",
  {
    title: "List Licenses",
    description: "List licenses with optional filters.",
    inputSchema: {
      type: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const lics = listLicenses(params);
    return {
      content: [{ type: "text", text: JSON.stringify({ licenses: lics, count: lics.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "update_license",
  {
    title: "Update License",
    description: "Update an existing license.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      type: z.enum(["software", "business", "professional", "patent", "trademark"]).optional(),
      issuer: z.string().optional(),
      license_number: z.string().optional(),
      status: z.enum(["active", "expired", "pending_renewal"]).optional(),
      issued_at: z.string().optional(),
      expires_at: z.string().optional(),
      auto_renew: z.boolean().optional(),
      cost: z.number().optional(),
    },
  },
  async ({ id, ...input }) => {
    const lic = updateLicense(id, input);
    if (!lic) {
      return { content: [{ type: "text", text: `License '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(lic, null, 2) }] };
  }
);

server.registerTool(
  "delete_license",
  {
    title: "Delete License",
    description: "Delete a license by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteLicense(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "renew_license",
  {
    title: "Renew License",
    description: "Renew a license with a new expiry date.",
    inputSchema: {
      id: z.string(),
      expires_at: z.string(),
    },
  },
  async ({ id, expires_at }) => {
    const lic = renewLicense(id, expires_at);
    if (!lic) {
      return { content: [{ type: "text", text: `License '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(lic, null, 2) }] };
  }
);

server.registerTool(
  "list_expiring_licenses",
  {
    title: "List Expiring Licenses",
    description: "List licenses expiring within N days.",
    inputSchema: { days: z.number().default(30) },
  },
  async ({ days }) => {
    const lics = listExpiringLicenses(days);
    return {
      content: [{ type: "text", text: JSON.stringify({ licenses: lics, count: lics.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "get_license_stats",
  {
    title: "Get License Stats",
    description: "Get license statistics — totals by status and type.",
    inputSchema: {},
  },
  async () => {
    const stats = getLicenseStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// --- Audits ---

server.registerTool(
  "schedule_audit",
  {
    title: "Schedule Audit",
    description: "Schedule a new compliance audit.",
    inputSchema: {
      name: z.string(),
      framework: z.string().optional(),
      auditor: z.string().optional(),
      scheduled_at: z.string().optional(),
    },
  },
  async (params) => {
    const audit = scheduleAudit(params);
    return { content: [{ type: "text", text: JSON.stringify(audit, null, 2) }] };
  }
);

server.registerTool(
  "get_audit",
  {
    title: "Get Audit",
    description: "Get an audit by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const audit = getAudit(id);
    if (!audit) {
      return { content: [{ type: "text", text: `Audit '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(audit, null, 2) }] };
  }
);

server.registerTool(
  "list_audits",
  {
    title: "List Audits",
    description: "List audits with optional filters.",
    inputSchema: {
      framework: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const audits = listAudits(params);
    return {
      content: [{ type: "text", text: JSON.stringify({ audits, count: audits.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "complete_audit",
  {
    title: "Complete Audit",
    description: "Complete an audit with findings. Audits with critical-severity findings are marked as failed.",
    inputSchema: {
      id: z.string(),
      findings: z.array(z.any()),
    },
  },
  async ({ id, findings }) => {
    const audit = completeAudit(id, findings);
    if (!audit) {
      return { content: [{ type: "text", text: `Audit '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(audit, null, 2) }] };
  }
);

server.registerTool(
  "get_audit_report",
  {
    title: "Get Audit Report",
    description: "Get a detailed audit report with findings summary.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const report = getAuditReport(id);
    if (!report) {
      return { content: [{ type: "text", text: `Audit '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
);

server.registerTool(
  "delete_audit",
  {
    title: "Delete Audit",
    description: "Delete an audit by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteAudit(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Analytics ---

server.registerTool(
  "get_compliance_score",
  {
    title: "Get Compliance Score",
    description: "Get the overall compliance score — percentage of applicable requirements that are compliant.",
    inputSchema: {},
  },
  async () => {
    const score = getComplianceScore();
    return { content: [{ type: "text", text: JSON.stringify(score, null, 2) }] };
  }
);

server.registerTool(
  "get_framework_status",
  {
    title: "Get Framework Status",
    description: "Get compliance status for a specific framework.",
    inputSchema: { framework: z.string() },
  },
  async ({ framework }) => {
    const status = getFrameworkStatus(framework);
    return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-compliance MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
