#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createOrg,
  getOrg,
  updateOrg,
  createTeam,
  getTeam,
  listTeams,
  updateTeam,
  deleteTeam,
  getTeamTree,
  getTeamMembers,
  addMember,
  getMember,
  listMembers,
  updateMember,
  removeMember,
  getMembersByRole,
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
  deleteCustomer,
  searchCustomers,
  mergeCustomers,
  getCustomerByEmail,
  createVendor,
  getVendor,
  listVendors,
  updateVendor,
  deleteVendor,
  searchVendors,
  getVendorsByCategory,
} from "../db/company.js";
import {
  logAction,
  searchAudit,
  getAuditStats,
  getAuditTimeline,
} from "../lib/audit.js";
import {
  getSetting,
  setSetting,
  getAllSettings,
  deleteSetting,
} from "../lib/settings.js";
import {
  generatePnl,
  createPeriod,
  closePeriod,
  listPeriods,
  generateCashflow,
  setBudget,
  getBudgetVsActual,
  listBudgets,
} from "../lib/finance.js";

const server = new McpServer({
  name: "microservice-company",
  version: "0.0.1",
});

// ─── Organization ────────────────────────────────────────────────────────────

server.registerTool(
  "create_org",
  {
    title: "Create Organization",
    description: "Create a new organization.",
    inputSchema: {
      name: z.string(),
      legal_name: z.string().optional(),
      tax_id: z.string().optional(),
      address: z.record(z.unknown()).optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      website: z.string().optional(),
      industry: z.string().optional(),
      currency: z.string().optional(),
      fiscal_year_start: z.string().optional(),
      timezone: z.string().optional(),
      branding: z.record(z.unknown()).optional(),
      settings: z.record(z.unknown()).optional(),
    },
  },
  async (params) => {
    const org = createOrg(params);
    return { content: [{ type: "text", text: JSON.stringify(org, null, 2) }] };
  }
);

server.registerTool(
  "get_org",
  {
    title: "Get Organization",
    description: "Get an organization by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const org = getOrg(id);
    if (!org) {
      return { content: [{ type: "text", text: `Organization '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(org, null, 2) }] };
  }
);

server.registerTool(
  "update_org",
  {
    title: "Update Organization",
    description: "Update an existing organization.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      legal_name: z.string().optional(),
      tax_id: z.string().optional(),
      address: z.record(z.unknown()).optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      website: z.string().optional(),
      industry: z.string().optional(),
      currency: z.string().optional(),
      fiscal_year_start: z.string().optional(),
      timezone: z.string().optional(),
      branding: z.record(z.unknown()).optional(),
      settings: z.record(z.unknown()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const org = updateOrg(id, input);
    if (!org) {
      return { content: [{ type: "text", text: `Organization '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(org, null, 2) }] };
  }
);

// ─── Teams ───────────────────────────────────────────────────────────────────

server.registerTool(
  "create_team",
  {
    title: "Create Team",
    description: "Create a new team within an organization.",
    inputSchema: {
      org_id: z.string(),
      name: z.string(),
      parent_id: z.string().optional(),
      department: z.string().optional(),
      cost_center: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async (params) => {
    const team = createTeam(params);
    return { content: [{ type: "text", text: JSON.stringify(team, null, 2) }] };
  }
);

server.registerTool(
  "get_team",
  {
    title: "Get Team",
    description: "Get a team by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const team = getTeam(id);
    if (!team) {
      return { content: [{ type: "text", text: `Team '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(team, null, 2) }] };
  }
);

server.registerTool(
  "list_teams",
  {
    title: "List Teams",
    description: "List teams with optional filters.",
    inputSchema: {
      org_id: z.string().optional(),
      department: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const teams = listTeams(params);
    return {
      content: [{ type: "text", text: JSON.stringify({ teams, count: teams.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "update_team",
  {
    title: "Update Team",
    description: "Update an existing team.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      parent_id: z.string().optional(),
      department: z.string().optional(),
      cost_center: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const team = updateTeam(id, input);
    if (!team) {
      return { content: [{ type: "text", text: `Team '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(team, null, 2) }] };
  }
);

server.registerTool(
  "delete_team",
  {
    title: "Delete Team",
    description: "Delete a team by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteTeam(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "get_team_tree",
  {
    title: "Get Team Tree",
    description: "Get the hierarchical team tree for an organization.",
    inputSchema: { org_id: z.string() },
  },
  async ({ org_id }) => {
    const tree = getTeamTree(org_id);
    return { content: [{ type: "text", text: JSON.stringify(tree, null, 2) }] };
  }
);

server.registerTool(
  "get_team_members",
  {
    title: "Get Team Members",
    description: "Get all members of a team.",
    inputSchema: { team_id: z.string() },
  },
  async ({ team_id }) => {
    const members = getTeamMembers(team_id);
    return {
      content: [{ type: "text", text: JSON.stringify({ members, count: members.length }, null, 2) }],
    };
  }
);

// ─── Members ─────────────────────────────────────────────────────────────────

server.registerTool(
  "add_member",
  {
    title: "Add Member",
    description: "Add a new member to an organization.",
    inputSchema: {
      org_id: z.string(),
      team_id: z.string().optional(),
      name: z.string(),
      email: z.string().optional(),
      role: z.enum(["owner", "admin", "manager", "member", "viewer"]).optional(),
      title: z.string().optional(),
      permissions: z.record(z.unknown()).optional(),
      status: z.string().optional(),
    },
  },
  async (params) => {
    const member = addMember(params);
    return { content: [{ type: "text", text: JSON.stringify(member, null, 2) }] };
  }
);

server.registerTool(
  "get_member",
  {
    title: "Get Member",
    description: "Get a member by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const member = getMember(id);
    if (!member) {
      return { content: [{ type: "text", text: `Member '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(member, null, 2) }] };
  }
);

server.registerTool(
  "list_members",
  {
    title: "List Members",
    description: "List members with optional filters.",
    inputSchema: {
      org_id: z.string().optional(),
      team_id: z.string().optional(),
      role: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const members = listMembers(params);
    return {
      content: [{ type: "text", text: JSON.stringify({ members, count: members.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "update_member",
  {
    title: "Update Member",
    description: "Update an existing member.",
    inputSchema: {
      id: z.string(),
      team_id: z.string().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
      role: z.enum(["owner", "admin", "manager", "member", "viewer"]).optional(),
      title: z.string().optional(),
      permissions: z.record(z.unknown()).optional(),
      status: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const member = updateMember(id, input);
    if (!member) {
      return { content: [{ type: "text", text: `Member '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(member, null, 2) }] };
  }
);

server.registerTool(
  "remove_member",
  {
    title: "Remove Member",
    description: "Remove a member by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const removed = removeMember(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, removed }) }] };
  }
);

server.registerTool(
  "get_members_by_role",
  {
    title: "Get Members by Role",
    description: "Get all members with a specific role in an organization.",
    inputSchema: {
      org_id: z.string(),
      role: z.string(),
    },
  },
  async ({ org_id, role }) => {
    const members = getMembersByRole(org_id, role);
    return {
      content: [{ type: "text", text: JSON.stringify({ members, count: members.length }, null, 2) }],
    };
  }
);

// ─── Customers ───────────────────────────────────────────────────────────────

server.registerTool(
  "create_customer",
  {
    title: "Create Customer",
    description: "Create a new customer.",
    inputSchema: {
      org_id: z.string(),
      name: z.string(),
      email: z.string().optional(),
      phone: z.string().optional(),
      company: z.string().optional(),
      address: z.record(z.unknown()).optional(),
      source: z.string().optional(),
      source_ids: z.record(z.unknown()).optional(),
      tags: z.array(z.string()).optional(),
      lifetime_value: z.number().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async (params) => {
    const customer = createCustomer(params);
    return { content: [{ type: "text", text: JSON.stringify(customer, null, 2) }] };
  }
);

server.registerTool(
  "get_customer",
  {
    title: "Get Customer",
    description: "Get a customer by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const customer = getCustomer(id);
    if (!customer) {
      return { content: [{ type: "text", text: `Customer '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(customer, null, 2) }] };
  }
);

server.registerTool(
  "list_customers",
  {
    title: "List Customers",
    description: "List customers with optional filters.",
    inputSchema: {
      org_id: z.string().optional(),
      search: z.string().optional(),
      source: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const customers = listCustomers(params);
    return {
      content: [{ type: "text", text: JSON.stringify({ customers, count: customers.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "update_customer",
  {
    title: "Update Customer",
    description: "Update an existing customer.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      company: z.string().optional(),
      address: z.record(z.unknown()).optional(),
      source: z.string().optional(),
      source_ids: z.record(z.unknown()).optional(),
      tags: z.array(z.string()).optional(),
      lifetime_value: z.number().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const customer = updateCustomer(id, input);
    if (!customer) {
      return { content: [{ type: "text", text: `Customer '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(customer, null, 2) }] };
  }
);

server.registerTool(
  "delete_customer",
  {
    title: "Delete Customer",
    description: "Delete a customer by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteCustomer(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_customers",
  {
    title: "Search Customers",
    description: "Search customers by name, email, phone, or company.",
    inputSchema: {
      org_id: z.string(),
      query: z.string(),
    },
  },
  async ({ org_id, query }) => {
    const results = searchCustomers(org_id, query);
    return {
      content: [{ type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "merge_customers",
  {
    title: "Merge Customers",
    description: "Merge two customers — keep the first, merge data from second, delete second.",
    inputSchema: {
      id1: z.string(),
      id2: z.string(),
    },
  },
  async ({ id1, id2 }) => {
    const merged = mergeCustomers(id1, id2);
    if (!merged) {
      return { content: [{ type: "text", text: "One or both customers not found." }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(merged, null, 2) }] };
  }
);

server.registerTool(
  "get_customer_by_email",
  {
    title: "Get Customer by Email",
    description: "Find a customer by email within an organization.",
    inputSchema: {
      org_id: z.string(),
      email: z.string(),
    },
  },
  async ({ org_id, email }) => {
    const customer = getCustomerByEmail(org_id, email);
    if (!customer) {
      return { content: [{ type: "text", text: `No customer with email '${email}' found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(customer, null, 2) }] };
  }
);

// ─── Vendors ─────────────────────────────────────────────────────────────────

server.registerTool(
  "create_vendor",
  {
    title: "Create Vendor",
    description: "Create a new vendor.",
    inputSchema: {
      org_id: z.string(),
      name: z.string(),
      email: z.string().optional(),
      phone: z.string().optional(),
      company: z.string().optional(),
      category: z.enum(["supplier", "contractor", "partner", "agency"]).optional(),
      payment_terms: z.string().optional(),
      address: z.record(z.unknown()).optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async (params) => {
    const vendor = createVendor(params);
    return { content: [{ type: "text", text: JSON.stringify(vendor, null, 2) }] };
  }
);

server.registerTool(
  "get_vendor",
  {
    title: "Get Vendor",
    description: "Get a vendor by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const vendor = getVendor(id);
    if (!vendor) {
      return { content: [{ type: "text", text: `Vendor '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(vendor, null, 2) }] };
  }
);

server.registerTool(
  "list_vendors",
  {
    title: "List Vendors",
    description: "List vendors with optional filters.",
    inputSchema: {
      org_id: z.string().optional(),
      category: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const vendors = listVendors(params);
    return {
      content: [{ type: "text", text: JSON.stringify({ vendors, count: vendors.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "update_vendor",
  {
    title: "Update Vendor",
    description: "Update an existing vendor.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      company: z.string().optional(),
      category: z.enum(["supplier", "contractor", "partner", "agency"]).optional(),
      payment_terms: z.string().optional(),
      address: z.record(z.unknown()).optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const vendor = updateVendor(id, input);
    if (!vendor) {
      return { content: [{ type: "text", text: `Vendor '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(vendor, null, 2) }] };
  }
);

server.registerTool(
  "delete_vendor",
  {
    title: "Delete Vendor",
    description: "Delete a vendor by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteVendor(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_vendors",
  {
    title: "Search Vendors",
    description: "Search vendors by name, email, phone, or company.",
    inputSchema: {
      org_id: z.string(),
      query: z.string(),
    },
  },
  async ({ org_id, query }) => {
    const results = searchVendors(org_id, query);
    return {
      content: [{ type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "get_vendors_by_category",
  {
    title: "Get Vendors by Category",
    description: "Get all vendors in a specific category within an organization.",
    inputSchema: {
      org_id: z.string(),
      category: z.string(),
    },
  },
  async ({ org_id, category }) => {
    const vendors = getVendorsByCategory(org_id, category);
    return {
      content: [{ type: "text", text: JSON.stringify({ vendors, count: vendors.length }, null, 2) }],
    };
  }
);

// ─── Audit ───────────────────────────────────────────────────────────────────

server.registerTool(
  "search_audit",
  {
    title: "Search Audit Log",
    description: "Search audit log entries with filters.",
    inputSchema: {
      org_id: z.string().optional(),
      actor: z.string().optional(),
      service: z.string().optional(),
      action: z.enum(["create", "update", "delete", "execute", "login", "approve"]).optional(),
      entity_type: z.string().optional(),
      entity_id: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const results = searchAudit(params);
    return {
      content: [{ type: "text", text: JSON.stringify({ entries: results, count: results.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "log_audit",
  {
    title: "Log Audit Action",
    description: "Log an action to the audit trail.",
    inputSchema: {
      org_id: z.string().optional(),
      actor: z.string(),
      action: z.enum(["create", "update", "delete", "execute", "login", "approve"]),
      service: z.string().optional(),
      entity_type: z.string().optional(),
      entity_id: z.string().optional(),
      details: z.record(z.unknown()).optional(),
    },
  },
  async (params) => {
    const entry = logAction(params);
    return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
  }
);

server.registerTool(
  "audit_stats",
  {
    title: "Audit Statistics",
    description: "Get audit log statistics — counts by actor, service, and action.",
    inputSchema: {
      org_id: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    },
  },
  async ({ org_id, from, to }) => {
    const stats = getAuditStats(org_id, from, to);
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

server.registerTool(
  "audit_timeline",
  {
    title: "Audit Timeline",
    description: "Get the full audit history for a specific entity.",
    inputSchema: {
      entity_type: z.string(),
      entity_id: z.string(),
    },
  },
  async ({ entity_type, entity_id }) => {
    const timeline = getAuditTimeline(entity_type, entity_id);
    return {
      content: [{ type: "text", text: JSON.stringify({ timeline, count: timeline.length }, null, 2) }],
    };
  }
);

// ─── Settings ────────────────────────────────────────────────────────────────

server.registerTool(
  "get_setting",
  {
    title: "Get Setting",
    description: "Get a single setting by key.",
    inputSchema: {
      org_id: z.string().nullable(),
      key: z.string(),
    },
  },
  async ({ org_id, key }) => {
    const setting = getSetting(org_id, key);
    if (!setting) {
      return { content: [{ type: "text", text: `Setting '${key}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(setting, null, 2) }] };
  }
);

server.registerTool(
  "set_setting",
  {
    title: "Set Setting",
    description: "Set a setting value (upsert).",
    inputSchema: {
      org_id: z.string().nullable(),
      key: z.string(),
      value: z.string(),
      category: z.string().optional(),
    },
  },
  async ({ org_id, key, value, category }) => {
    const setting = setSetting(org_id, key, value, category);
    return { content: [{ type: "text", text: JSON.stringify(setting, null, 2) }] };
  }
);

server.registerTool(
  "list_settings",
  {
    title: "List Settings",
    description: "List all settings for an organization, optionally filtered by category.",
    inputSchema: {
      org_id: z.string().nullable(),
      category: z.string().optional(),
    },
  },
  async ({ org_id, category }) => {
    const settings = getAllSettings(org_id, category);
    return {
      content: [{ type: "text", text: JSON.stringify({ settings, count: settings.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "delete_setting",
  {
    title: "Delete Setting",
    description: "Delete a setting by key.",
    inputSchema: {
      org_id: z.string().nullable(),
      key: z.string(),
    },
  },
  async ({ org_id, key }) => {
    const deleted = deleteSetting(org_id, key);
    return { content: [{ type: "text", text: JSON.stringify({ key, deleted }) }] };
  }
);

// ─── Financial Consolidation ─────────────────────────────────────────────────

server.registerTool(
  "generate_pnl",
  {
    title: "Generate P&L Report",
    description: "Generate a Profit & Loss report from closed financial periods.",
    inputSchema: {
      org_id: z.string(),
      start_date: z.string(),
      end_date: z.string(),
    },
  },
  async ({ org_id, start_date, end_date }) => {
    const report = generatePnl(org_id, start_date, end_date);
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
);

server.registerTool(
  "create_period",
  {
    title: "Create Financial Period",
    description: "Create a new financial period (month, quarter, or year).",
    inputSchema: {
      org_id: z.string(),
      name: z.string(),
      type: z.enum(["month", "quarter", "year"]),
      start_date: z.string(),
      end_date: z.string(),
    },
  },
  async ({ org_id, name, type, start_date, end_date }) => {
    const period = createPeriod(org_id, name, type, start_date, end_date);
    return { content: [{ type: "text", text: JSON.stringify(period, null, 2) }] };
  }
);

server.registerTool(
  "close_period",
  {
    title: "Close Financial Period",
    description: "Close a financial period with final revenue and expense figures.",
    inputSchema: {
      period_id: z.string(),
      revenue: z.number(),
      expenses: z.number(),
    },
  },
  async ({ period_id, revenue, expenses }) => {
    const period = closePeriod(period_id, revenue, expenses);
    if (!period) {
      return { content: [{ type: "text", text: `Period '${period_id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(period, null, 2) }] };
  }
);

server.registerTool(
  "list_periods",
  {
    title: "List Financial Periods",
    description: "List financial periods for an organization, optionally filtered by type.",
    inputSchema: {
      org_id: z.string(),
      type: z.enum(["month", "quarter", "year"]).optional(),
    },
  },
  async ({ org_id, type }) => {
    const periods = listPeriods(org_id, type);
    return {
      content: [{ type: "text", text: JSON.stringify({ periods, count: periods.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "generate_cashflow",
  {
    title: "Generate Cashflow Report",
    description: "Generate a cashflow report from financial periods.",
    inputSchema: {
      org_id: z.string(),
      start_date: z.string(),
      end_date: z.string(),
    },
  },
  async ({ org_id, start_date, end_date }) => {
    const report = generateCashflow(org_id, start_date, end_date);
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
);

server.registerTool(
  "set_budget",
  {
    title: "Set Budget",
    description: "Set or update a department's monthly budget.",
    inputSchema: {
      org_id: z.string(),
      department: z.string(),
      monthly_amount: z.number(),
    },
  },
  async ({ org_id, department, monthly_amount }) => {
    const budget = setBudget(org_id, department, monthly_amount);
    return { content: [{ type: "text", text: JSON.stringify(budget, null, 2) }] };
  }
);

server.registerTool(
  "budget_status",
  {
    title: "Budget vs Actual",
    description: "Compare a department's budget against actual spending for a given month.",
    inputSchema: {
      org_id: z.string(),
      department: z.string(),
      month: z.string().describe("Month in YYYY-MM format"),
    },
  },
  async ({ org_id, department, month }) => {
    const result = getBudgetVsActual(org_id, department, month);
    if (!result) {
      return { content: [{ type: "text", text: `No budget found for department '${department}'.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "list_budgets",
  {
    title: "List Budgets",
    description: "List all budgets for an organization.",
    inputSchema: {
      org_id: z.string(),
    },
  },
  async ({ org_id }) => {
    const budgets = listBudgets(org_id);
    return {
      content: [{ type: "text", text: JSON.stringify({ budgets, count: budgets.length }, null, 2) }],
    };
  }
);

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-company MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
