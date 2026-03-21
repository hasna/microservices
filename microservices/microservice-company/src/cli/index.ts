#!/usr/bin/env bun

import { Command } from "commander";
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
  addMember,
  getMember,
  listMembers,
  updateMember,
  removeMember,
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
  deleteCustomer,
  searchCustomers,
  mergeCustomers,
  createVendor,
  getVendor,
  listVendors,
  updateVendor,
  deleteVendor,
  searchVendors,
} from "../db/company.js";
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
import {
  logAction,
  searchAudit,
  getAuditStats,
  type AuditAction,
} from "../lib/audit.js";
import {
  getSetting,
  setSetting,
  getAllSettings,
  deleteSetting,
} from "../lib/settings.js";

const program = new Command();

program
  .name("microservice-company")
  .description("AI agent control plane for autonomous company operations")
  .version("0.0.1");

// ─── Organization ────────────────────────────────────────────────────────────

const orgCmd = program.command("org").description("Organization management");

orgCmd
  .command("create")
  .description("Create an organization")
  .requiredOption("--name <name>", "Organization name")
  .option("--legal-name <name>", "Legal name")
  .option("--tax-id <id>", "Tax ID")
  .option("--phone <phone>", "Phone")
  .option("--email <email>", "Email")
  .option("--website <url>", "Website")
  .option("--industry <industry>", "Industry")
  .option("--currency <code>", "Currency code", "USD")
  .option("--timezone <tz>", "Timezone", "UTC")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const org = createOrg({
      name: opts.name,
      legal_name: opts.legalName,
      tax_id: opts.taxId,
      phone: opts.phone,
      email: opts.email,
      website: opts.website,
      industry: opts.industry,
      currency: opts.currency,
      timezone: opts.timezone,
    });

    if (opts.json) {
      console.log(JSON.stringify(org, null, 2));
    } else {
      console.log(`Created organization: ${org.name} (${org.id})`);
    }
  });

orgCmd
  .command("get")
  .description("Get an organization by ID")
  .argument("<id>", "Organization ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const org = getOrg(id);
    if (!org) {
      console.error(`Organization '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(org, null, 2));
    } else {
      console.log(`${org.name}`);
      if (org.legal_name) console.log(`  Legal: ${org.legal_name}`);
      if (org.email) console.log(`  Email: ${org.email}`);
      if (org.phone) console.log(`  Phone: ${org.phone}`);
      if (org.website) console.log(`  Website: ${org.website}`);
      if (org.industry) console.log(`  Industry: ${org.industry}`);
      console.log(`  Currency: ${org.currency}`);
      console.log(`  Timezone: ${org.timezone}`);
    }
  });

orgCmd
  .command("update")
  .description("Update an organization")
  .argument("<id>", "Organization ID")
  .option("--name <name>", "Name")
  .option("--legal-name <name>", "Legal name")
  .option("--tax-id <id>", "Tax ID")
  .option("--phone <phone>", "Phone")
  .option("--email <email>", "Email")
  .option("--website <url>", "Website")
  .option("--industry <industry>", "Industry")
  .option("--currency <code>", "Currency")
  .option("--timezone <tz>", "Timezone")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.legalName !== undefined) input.legal_name = opts.legalName;
    if (opts.taxId !== undefined) input.tax_id = opts.taxId;
    if (opts.phone !== undefined) input.phone = opts.phone;
    if (opts.email !== undefined) input.email = opts.email;
    if (opts.website !== undefined) input.website = opts.website;
    if (opts.industry !== undefined) input.industry = opts.industry;
    if (opts.currency !== undefined) input.currency = opts.currency;
    if (opts.timezone !== undefined) input.timezone = opts.timezone;

    const org = updateOrg(id, input);
    if (!org) {
      console.error(`Organization '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(org, null, 2));
    } else {
      console.log(`Updated: ${org.name}`);
    }
  });

// ─── Teams ───────────────────────────────────────────────────────────────────

const teamCmd = program.command("team").description("Team management");

teamCmd
  .command("create")
  .description("Create a team")
  .requiredOption("--org <id>", "Organization ID")
  .requiredOption("--name <name>", "Team name")
  .option("--parent <id>", "Parent team ID")
  .option("--department <dept>", "Department")
  .option("--cost-center <cc>", "Cost center")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const team = createTeam({
      org_id: opts.org,
      name: opts.name,
      parent_id: opts.parent,
      department: opts.department,
      cost_center: opts.costCenter,
    });

    if (opts.json) {
      console.log(JSON.stringify(team, null, 2));
    } else {
      console.log(`Created team: ${team.name} (${team.id})`);
    }
  });

teamCmd
  .command("list")
  .description("List teams")
  .option("--org <id>", "Filter by organization")
  .option("--department <dept>", "Filter by department")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const teams = listTeams({
      org_id: opts.org,
      department: opts.department,
    });

    if (opts.json) {
      console.log(JSON.stringify(teams, null, 2));
    } else {
      if (teams.length === 0) {
        console.log("No teams found.");
        return;
      }
      for (const t of teams) {
        const dept = t.department ? ` (${t.department})` : "";
        console.log(`  ${t.name}${dept} — ${t.id}`);
      }
      console.log(`\n${teams.length} team(s)`);
    }
  });

teamCmd
  .command("get")
  .description("Get a team by ID")
  .argument("<id>", "Team ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const team = getTeam(id);
    if (!team) {
      console.error(`Team '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(team, null, 2));
    } else {
      console.log(`${team.name}`);
      if (team.department) console.log(`  Department: ${team.department}`);
      if (team.cost_center) console.log(`  Cost Center: ${team.cost_center}`);
      if (team.parent_id) console.log(`  Parent: ${team.parent_id}`);
    }
  });

teamCmd
  .command("update")
  .description("Update a team")
  .argument("<id>", "Team ID")
  .option("--name <name>", "Name")
  .option("--parent <id>", "Parent team ID")
  .option("--department <dept>", "Department")
  .option("--cost-center <cc>", "Cost center")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.parent !== undefined) input.parent_id = opts.parent;
    if (opts.department !== undefined) input.department = opts.department;
    if (opts.costCenter !== undefined) input.cost_center = opts.costCenter;

    const team = updateTeam(id, input);
    if (!team) {
      console.error(`Team '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(team, null, 2));
    } else {
      console.log(`Updated: ${team.name}`);
    }
  });

teamCmd
  .command("delete")
  .description("Delete a team")
  .argument("<id>", "Team ID")
  .action((id) => {
    const deleted = deleteTeam(id);
    if (deleted) {
      console.log(`Deleted team ${id}`);
    } else {
      console.error(`Team '${id}' not found.`);
      process.exit(1);
    }
  });

teamCmd
  .command("tree")
  .description("Show team hierarchy")
  .requiredOption("--org <id>", "Organization ID")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const tree = getTeamTree(opts.org);

    if (opts.json) {
      console.log(JSON.stringify(tree, null, 2));
    } else {
      function printTree(nodes: typeof tree, indent = 0) {
        for (const node of nodes) {
          const prefix = "  ".repeat(indent);
          const dept = node.department ? ` (${node.department})` : "";
          console.log(`${prefix}${node.name}${dept}`);
          printTree(node.children, indent + 1);
        }
      }
      if (tree.length === 0) {
        console.log("No teams found.");
      } else {
        printTree(tree);
      }
    }
  });

// ─── Members ─────────────────────────────────────────────────────────────────

const memberCmd = program.command("member").description("Member management");

memberCmd
  .command("add")
  .description("Add a member")
  .requiredOption("--org <id>", "Organization ID")
  .requiredOption("--name <name>", "Member name")
  .option("--team <id>", "Team ID")
  .option("--email <email>", "Email")
  .option("--role <role>", "Role (owner/admin/manager/member/viewer)", "member")
  .option("--title <title>", "Job title")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const member = addMember({
      org_id: opts.org,
      team_id: opts.team,
      name: opts.name,
      email: opts.email,
      role: opts.role,
      title: opts.title,
    });

    if (opts.json) {
      console.log(JSON.stringify(member, null, 2));
    } else {
      console.log(`Added member: ${member.name} (${member.id})`);
    }
  });

memberCmd
  .command("list")
  .description("List members")
  .option("--org <id>", "Filter by organization")
  .option("--team <id>", "Filter by team")
  .option("--role <role>", "Filter by role")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const members = listMembers({
      org_id: opts.org,
      team_id: opts.team,
      role: opts.role,
    });

    if (opts.json) {
      console.log(JSON.stringify(members, null, 2));
    } else {
      if (members.length === 0) {
        console.log("No members found.");
        return;
      }
      for (const m of members) {
        const email = m.email ? ` <${m.email}>` : "";
        console.log(`  ${m.name}${email} [${m.role}]`);
      }
      console.log(`\n${members.length} member(s)`);
    }
  });

memberCmd
  .command("get")
  .description("Get a member by ID")
  .argument("<id>", "Member ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const member = getMember(id);
    if (!member) {
      console.error(`Member '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(member, null, 2));
    } else {
      console.log(`${member.name}`);
      if (member.email) console.log(`  Email: ${member.email}`);
      console.log(`  Role: ${member.role}`);
      if (member.title) console.log(`  Title: ${member.title}`);
      console.log(`  Status: ${member.status}`);
    }
  });

memberCmd
  .command("update")
  .description("Update a member")
  .argument("<id>", "Member ID")
  .option("--name <name>", "Name")
  .option("--team <id>", "Team ID")
  .option("--email <email>", "Email")
  .option("--role <role>", "Role")
  .option("--title <title>", "Title")
  .option("--status <status>", "Status")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.team !== undefined) input.team_id = opts.team;
    if (opts.email !== undefined) input.email = opts.email;
    if (opts.role !== undefined) input.role = opts.role;
    if (opts.title !== undefined) input.title = opts.title;
    if (opts.status !== undefined) input.status = opts.status;

    const member = updateMember(id, input);
    if (!member) {
      console.error(`Member '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(member, null, 2));
    } else {
      console.log(`Updated: ${member.name}`);
    }
  });

memberCmd
  .command("remove")
  .description("Remove a member")
  .argument("<id>", "Member ID")
  .action((id) => {
    const removed = removeMember(id);
    if (removed) {
      console.log(`Removed member ${id}`);
    } else {
      console.error(`Member '${id}' not found.`);
      process.exit(1);
    }
  });

// ─── Customers ───────────────────────────────────────────────────────────────

const customerCmd = program.command("customer").description("Customer management");

customerCmd
  .command("create")
  .description("Create a customer")
  .requiredOption("--org <id>", "Organization ID")
  .requiredOption("--name <name>", "Customer name")
  .option("--email <email>", "Email")
  .option("--phone <phone>", "Phone")
  .option("--company <company>", "Company name")
  .option("--source <source>", "Lead source")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const customer = createCustomer({
      org_id: opts.org,
      name: opts.name,
      email: opts.email,
      phone: opts.phone,
      company: opts.company,
      source: opts.source,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(customer, null, 2));
    } else {
      console.log(`Created customer: ${customer.name} (${customer.id})`);
    }
  });

customerCmd
  .command("list")
  .description("List customers")
  .option("--org <id>", "Filter by organization")
  .option("--search <query>", "Search")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const customers = listCustomers({
      org_id: opts.org,
      search: opts.search,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(customers, null, 2));
    } else {
      if (customers.length === 0) {
        console.log("No customers found.");
        return;
      }
      for (const c of customers) {
        const email = c.email ? ` <${c.email}>` : "";
        console.log(`  ${c.name}${email}`);
      }
      console.log(`\n${customers.length} customer(s)`);
    }
  });

customerCmd
  .command("get")
  .description("Get a customer by ID")
  .argument("<id>", "Customer ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const customer = getCustomer(id);
    if (!customer) {
      console.error(`Customer '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(customer, null, 2));
    } else {
      console.log(`${customer.name}`);
      if (customer.email) console.log(`  Email: ${customer.email}`);
      if (customer.phone) console.log(`  Phone: ${customer.phone}`);
      if (customer.company) console.log(`  Company: ${customer.company}`);
      if (customer.tags.length) console.log(`  Tags: ${customer.tags.join(", ")}`);
      console.log(`  Lifetime Value: ${customer.lifetime_value}`);
    }
  });

customerCmd
  .command("update")
  .description("Update a customer")
  .argument("<id>", "Customer ID")
  .option("--name <name>", "Name")
  .option("--email <email>", "Email")
  .option("--phone <phone>", "Phone")
  .option("--company <company>", "Company")
  .option("--source <source>", "Source")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--lifetime-value <value>", "Lifetime value")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.email !== undefined) input.email = opts.email;
    if (opts.phone !== undefined) input.phone = opts.phone;
    if (opts.company !== undefined) input.company = opts.company;
    if (opts.source !== undefined) input.source = opts.source;
    if (opts.tags !== undefined) input.tags = opts.tags.split(",").map((t: string) => t.trim());
    if (opts.lifetimeValue !== undefined) input.lifetime_value = parseFloat(opts.lifetimeValue);

    const customer = updateCustomer(id, input);
    if (!customer) {
      console.error(`Customer '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(customer, null, 2));
    } else {
      console.log(`Updated: ${customer.name}`);
    }
  });

customerCmd
  .command("delete")
  .description("Delete a customer")
  .argument("<id>", "Customer ID")
  .action((id) => {
    const deleted = deleteCustomer(id);
    if (deleted) {
      console.log(`Deleted customer ${id}`);
    } else {
      console.error(`Customer '${id}' not found.`);
      process.exit(1);
    }
  });

customerCmd
  .command("search")
  .description("Search customers")
  .requiredOption("--org <id>", "Organization ID")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .action((query, opts) => {
    const results = searchCustomers(opts.org, query);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log(`No customers matching "${query}".`);
        return;
      }
      for (const c of results) {
        console.log(`  ${c.name} ${c.email ? `<${c.email}>` : ""}`);
      }
    }
  });

customerCmd
  .command("merge")
  .description("Merge two customers (keep first, merge data from second)")
  .argument("<id1>", "Primary customer ID")
  .argument("<id2>", "Secondary customer ID (will be deleted)")
  .option("--json", "Output as JSON", false)
  .action((id1, id2, opts) => {
    const merged = mergeCustomers(id1, id2);
    if (!merged) {
      console.error("One or both customers not found.");
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(merged, null, 2));
    } else {
      console.log(`Merged into: ${merged.name} (${merged.id})`);
    }
  });

// ─── Vendors ─────────────────────────────────────────────────────────────────

const vendorCmd = program.command("vendor").description("Vendor management");

vendorCmd
  .command("add")
  .description("Add a vendor")
  .requiredOption("--org <id>", "Organization ID")
  .requiredOption("--name <name>", "Vendor name")
  .option("--email <email>", "Email")
  .option("--phone <phone>", "Phone")
  .option("--company <company>", "Company name")
  .option("--category <cat>", "Category (supplier/contractor/partner/agency)")
  .option("--payment-terms <terms>", "Payment terms")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const vendor = createVendor({
      org_id: opts.org,
      name: opts.name,
      email: opts.email,
      phone: opts.phone,
      company: opts.company,
      category: opts.category,
      payment_terms: opts.paymentTerms,
    });

    if (opts.json) {
      console.log(JSON.stringify(vendor, null, 2));
    } else {
      console.log(`Added vendor: ${vendor.name} (${vendor.id})`);
    }
  });

vendorCmd
  .command("list")
  .description("List vendors")
  .option("--org <id>", "Filter by organization")
  .option("--category <cat>", "Filter by category")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const vendors = listVendors({
      org_id: opts.org,
      category: opts.category,
    });

    if (opts.json) {
      console.log(JSON.stringify(vendors, null, 2));
    } else {
      if (vendors.length === 0) {
        console.log("No vendors found.");
        return;
      }
      for (const v of vendors) {
        const cat = v.category ? ` [${v.category}]` : "";
        console.log(`  ${v.name}${cat}`);
      }
      console.log(`\n${vendors.length} vendor(s)`);
    }
  });

vendorCmd
  .command("get")
  .description("Get a vendor by ID")
  .argument("<id>", "Vendor ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const vendor = getVendor(id);
    if (!vendor) {
      console.error(`Vendor '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(vendor, null, 2));
    } else {
      console.log(`${vendor.name}`);
      if (vendor.email) console.log(`  Email: ${vendor.email}`);
      if (vendor.phone) console.log(`  Phone: ${vendor.phone}`);
      if (vendor.category) console.log(`  Category: ${vendor.category}`);
      if (vendor.payment_terms) console.log(`  Payment Terms: ${vendor.payment_terms}`);
    }
  });

vendorCmd
  .command("update")
  .description("Update a vendor")
  .argument("<id>", "Vendor ID")
  .option("--name <name>", "Name")
  .option("--email <email>", "Email")
  .option("--phone <phone>", "Phone")
  .option("--company <company>", "Company")
  .option("--category <cat>", "Category")
  .option("--payment-terms <terms>", "Payment terms")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.email !== undefined) input.email = opts.email;
    if (opts.phone !== undefined) input.phone = opts.phone;
    if (opts.company !== undefined) input.company = opts.company;
    if (opts.category !== undefined) input.category = opts.category;
    if (opts.paymentTerms !== undefined) input.payment_terms = opts.paymentTerms;

    const vendor = updateVendor(id, input);
    if (!vendor) {
      console.error(`Vendor '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(vendor, null, 2));
    } else {
      console.log(`Updated: ${vendor.name}`);
    }
  });

vendorCmd
  .command("delete")
  .description("Delete a vendor")
  .argument("<id>", "Vendor ID")
  .action((id) => {
    const deleted = deleteVendor(id);
    if (deleted) {
      console.log(`Deleted vendor ${id}`);
    } else {
      console.error(`Vendor '${id}' not found.`);
      process.exit(1);
    }
  });

vendorCmd
  .command("search")
  .description("Search vendors")
  .requiredOption("--org <id>", "Organization ID")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .action((query, opts) => {
    const results = searchVendors(opts.org, query);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log(`No vendors matching "${query}".`);
        return;
      }
      for (const v of results) {
        console.log(`  ${v.name} ${v.email ? `<${v.email}>` : ""}`);
      }
    }
  });

// ─── Audit ───────────────────────────────────────────────────────────────────

const auditCmd = program.command("audit").description("Audit log management");

auditCmd
  .command("search")
  .description("Search audit log entries")
  .option("--org <id>", "Filter by organization")
  .option("--actor <actor>", "Filter by actor")
  .option("--service <service>", "Filter by service")
  .option("--action <action>", "Filter by action")
  .option("--entity-type <type>", "Filter by entity type")
  .option("--entity-id <id>", "Filter by entity ID")
  .option("--from <date>", "From date (ISO)")
  .option("--to <date>", "To date (ISO)")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const results = searchAudit({
      org_id: opts.org,
      actor: opts.actor,
      service: opts.service,
      action: opts.action as AuditAction | undefined,
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      from: opts.from,
      to: opts.to,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log("No audit entries found.");
        return;
      }
      for (const e of results) {
        const svc = e.service ? ` [${e.service}]` : "";
        const entity = e.entity_type ? ` ${e.entity_type}:${e.entity_id}` : "";
        console.log(`  ${e.timestamp} ${e.actor} ${e.action}${svc}${entity}`);
      }
      console.log(`\n${results.length} entry/entries`);
    }
  });

auditCmd
  .command("log")
  .description("Log an audit action")
  .requiredOption("--actor <actor>", "Actor name")
  .requiredOption("--action <action>", "Action (create/update/delete/execute/login/approve)")
  .option("--org <id>", "Organization ID")
  .option("--service <service>", "Service name")
  .option("--entity-type <type>", "Entity type")
  .option("--entity-id <id>", "Entity ID")
  .option("--details <json>", "Details JSON")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const entry = logAction({
      org_id: opts.org,
      actor: opts.actor,
      action: opts.action as AuditAction,
      service: opts.service,
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      details: opts.details ? JSON.parse(opts.details) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(entry, null, 2));
    } else {
      console.log(`Logged: ${entry.actor} ${entry.action} (${entry.id})`);
    }
  });

auditCmd
  .command("stats")
  .description("Show audit statistics")
  .option("--org <id>", "Organization ID")
  .option("--from <date>", "From date (ISO)")
  .option("--to <date>", "To date (ISO)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getAuditStats(opts.org, opts.from, opts.to);

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(`Total entries: ${stats.total}`);
      console.log("\nBy actor:");
      for (const [actor, count] of Object.entries(stats.by_actor)) {
        console.log(`  ${actor}: ${count}`);
      }
      console.log("\nBy service:");
      for (const [service, count] of Object.entries(stats.by_service)) {
        console.log(`  ${service}: ${count}`);
      }
      console.log("\nBy action:");
      for (const [action, count] of Object.entries(stats.by_action)) {
        console.log(`  ${action}: ${count}`);
      }
    }
  });

// ─── Settings ────────────────────────────────────────────────────────────────

const settingsCmd = program.command("settings").description("Company settings management");

settingsCmd
  .command("view")
  .description("View all settings")
  .option("--org <id>", "Organization ID")
  .option("--category <cat>", "Filter by category")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const settings = getAllSettings(opts.org || null, opts.category);

    if (opts.json) {
      console.log(JSON.stringify(settings, null, 2));
    } else {
      if (settings.length === 0) {
        console.log("No settings found.");
        return;
      }
      for (const s of settings) {
        const cat = s.category ? ` [${s.category}]` : "";
        console.log(`  ${s.key} = ${s.value}${cat}`);
      }
      console.log(`\n${settings.length} setting(s)`);
    }
  });

settingsCmd
  .command("set")
  .description("Set a setting value")
  .argument("<key>", "Setting key")
  .argument("<value>", "Setting value")
  .option("--org <id>", "Organization ID")
  .option("--category <cat>", "Category")
  .option("--json", "Output as JSON", false)
  .action((key, value, opts) => {
    const setting = setSetting(opts.org || null, key, value, opts.category);

    if (opts.json) {
      console.log(JSON.stringify(setting, null, 2));
    } else {
      console.log(`Set: ${setting.key} = ${setting.value}`);
    }
  });

settingsCmd
  .command("delete")
  .description("Delete a setting")
  .argument("<key>", "Setting key")
  .option("--org <id>", "Organization ID")
  .action((key, opts) => {
    const deleted = deleteSetting(opts.org || null, key);
    if (deleted) {
      console.log(`Deleted setting '${key}'`);
    } else {
      console.error(`Setting '${key}' not found.`);
      process.exit(1);
    }
  });

// ─── P&L ────────────────────────────────────────────────────────────────────

program
  .command("pnl")
  .description("Generate a Profit & Loss report")
  .requiredOption("--org <id>", "Organization ID")
  .requiredOption("--from <date>", "Start date (YYYY-MM-DD)")
  .requiredOption("--to <date>", "End date (YYYY-MM-DD)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const report = generatePnl(opts.org, opts.from, opts.to);

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`P&L Report (${opts.from} to ${opts.to})`);
      console.log(`  Revenue:    ${report.revenue.toFixed(2)}`);
      console.log(`  Expenses:   ${report.expenses.toFixed(2)}`);
      console.log(`  Net Income: ${report.net_income.toFixed(2)}`);
      const services = Object.keys(report.breakdown_by_service);
      if (services.length > 0) {
        console.log("  Breakdown:");
        for (const svc of services) {
          const b = report.breakdown_by_service[svc];
          console.log(`    ${svc}: rev=${b.revenue.toFixed(2)} exp=${b.expenses.toFixed(2)}`);
        }
      }
    }
  });

// ─── Financial Periods ───────────────────────────────────────────────────────

const periodCmd = program.command("period").description("Financial period management");

periodCmd
  .command("create")
  .description("Create a financial period")
  .requiredOption("--org <id>", "Organization ID")
  .requiredOption("--name <name>", "Period name")
  .requiredOption("--type <type>", "Period type (month/quarter/year)")
  .requiredOption("--from <date>", "Start date (YYYY-MM-DD)")
  .requiredOption("--to <date>", "End date (YYYY-MM-DD)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const period = createPeriod(opts.org, opts.name, opts.type, opts.from, opts.to);

    if (opts.json) {
      console.log(JSON.stringify(period, null, 2));
    } else {
      console.log(`Created period: ${period.name} (${period.id})`);
    }
  });

periodCmd
  .command("list")
  .description("List financial periods")
  .requiredOption("--org <id>", "Organization ID")
  .option("--type <type>", "Filter by type (month/quarter/year)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const periods = listPeriods(opts.org, opts.type);

    if (opts.json) {
      console.log(JSON.stringify(periods, null, 2));
    } else {
      if (periods.length === 0) {
        console.log("No financial periods found.");
        return;
      }
      for (const p of periods) {
        console.log(`  ${p.name} [${p.type}] ${p.status} (${p.start_date} to ${p.end_date})`);
      }
      console.log(`\n${periods.length} period(s)`);
    }
  });

periodCmd
  .command("close")
  .description("Close a financial period with final figures")
  .argument("<id>", "Period ID")
  .requiredOption("--revenue <amount>", "Total revenue")
  .requiredOption("--expenses <amount>", "Total expenses")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const period = closePeriod(id, parseFloat(opts.revenue), parseFloat(opts.expenses));
    if (!period) {
      console.error(`Period '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(period, null, 2));
    } else {
      console.log(`Closed period: ${period.name}`);
      console.log(`  Revenue:    ${period.revenue.toFixed(2)}`);
      console.log(`  Expenses:   ${period.expenses.toFixed(2)}`);
      console.log(`  Net Income: ${period.net_income.toFixed(2)}`);
    }
  });

// ─── Cashflow ────────────────────────────────────────────────────────────────

program
  .command("cashflow")
  .description("Generate a cashflow report")
  .requiredOption("--org <id>", "Organization ID")
  .requiredOption("--from <date>", "Start date (YYYY-MM-DD)")
  .requiredOption("--to <date>", "End date (YYYY-MM-DD)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const report = generateCashflow(opts.org, opts.from, opts.to);

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Cashflow Report (${opts.from} to ${opts.to})`);
      console.log(`  Cash In:      ${report.cash_in.toFixed(2)}`);
      console.log(`  Cash Out:     ${report.cash_out.toFixed(2)}`);
      console.log(`  Net Cashflow: ${report.net_cashflow.toFixed(2)}`);
    }
  });

// ─── Budgets ─────────────────────────────────────────────────────────────────

const budgetCmd = program.command("budget").description("Budget management");

budgetCmd
  .command("set")
  .description("Set a department budget")
  .requiredOption("--org <id>", "Organization ID")
  .requiredOption("--department <dept>", "Department name")
  .requiredOption("--amount <amount>", "Monthly budget amount")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const budget = setBudget(opts.org, opts.department, parseFloat(opts.amount));

    if (opts.json) {
      console.log(JSON.stringify(budget, null, 2));
    } else {
      console.log(`Budget set: ${budget.department} = ${budget.monthly_amount}/month`);
    }
  });

budgetCmd
  .command("list")
  .description("List all budgets")
  .requiredOption("--org <id>", "Organization ID")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const budgets = listBudgets(opts.org);

    if (opts.json) {
      console.log(JSON.stringify(budgets, null, 2));
    } else {
      if (budgets.length === 0) {
        console.log("No budgets found.");
        return;
      }
      for (const b of budgets) {
        console.log(`  ${b.department}: ${b.monthly_amount}/month (${b.currency})`);
      }
      console.log(`\n${budgets.length} budget(s)`);
    }
  });

budgetCmd
  .command("check")
  .description("Check budget vs actual spending")
  .requiredOption("--org <id>", "Organization ID")
  .requiredOption("--department <dept>", "Department name")
  .requiredOption("--month <month>", "Month (YYYY-MM)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const result = getBudgetVsActual(opts.org, opts.department, opts.month);
    if (!result) {
      console.error(`No budget found for department '${opts.department}'.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Budget vs Actual: ${result.department} (${opts.month})`);
      console.log(`  Budget:   ${result.budget.toFixed(2)}`);
      console.log(`  Actual:   ${result.actual.toFixed(2)}`);
      console.log(`  Variance: ${result.variance.toFixed(2)} (${result.variance_pct}%)`);
    }
  });

program.parse(process.argv);
