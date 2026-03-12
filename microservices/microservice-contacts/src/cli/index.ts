#!/usr/bin/env bun

import { Command } from "commander";
import {
  createContact,
  getContact,
  listContacts,
  updateContact,
  deleteContact,
  countContacts,
  searchContacts,
} from "../db/contacts.js";
import {
  createCompany,
  getCompany,
  listCompanies,
  updateCompany,
  deleteCompany,
} from "../db/companies.js";
import {
  createRelationship,
  getContactRelationships,
  deleteRelationship,
} from "../db/relationships.js";

const program = new Command();

program
  .name("microservice-contacts")
  .description("Contact management microservice")
  .version("0.0.1");

// --- Contacts ---

program
  .command("add")
  .description("Add a new contact")
  .requiredOption("--first-name <name>", "First name")
  .option("--last-name <name>", "Last name")
  .option("--email <email>", "Email address")
  .option("--phone <phone>", "Phone number")
  .option("--company <id>", "Company ID")
  .option("--title <title>", "Job title")
  .option("--notes <notes>", "Notes")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const contact = createContact({
      first_name: opts.firstName,
      last_name: opts.lastName,
      email: opts.email,
      phone: opts.phone,
      company_id: opts.company,
      title: opts.title,
      notes: opts.notes,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(contact, null, 2));
    } else {
      console.log(`Created contact: ${contact.first_name} ${contact.last_name || ""} (${contact.id})`);
    }
  });

program
  .command("get")
  .description("Get a contact by ID")
  .argument("<id>", "Contact ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const contact = getContact(id);
    if (!contact) {
      console.error(`Contact '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(contact, null, 2));
    } else {
      console.log(`${contact.first_name} ${contact.last_name || ""}`);
      if (contact.email) console.log(`  Email: ${contact.email}`);
      if (contact.phone) console.log(`  Phone: ${contact.phone}`);
      if (contact.title) console.log(`  Title: ${contact.title}`);
      if (contact.tags.length) console.log(`  Tags: ${contact.tags.join(", ")}`);
      if (contact.notes) console.log(`  Notes: ${contact.notes}`);
    }
  });

program
  .command("list")
  .description("List contacts")
  .option("--search <query>", "Search by name, email, or phone")
  .option("--tag <tag>", "Filter by tag")
  .option("--company <id>", "Filter by company ID")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const contacts = listContacts({
      search: opts.search,
      tag: opts.tag,
      company_id: opts.company,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(contacts, null, 2));
    } else {
      if (contacts.length === 0) {
        console.log("No contacts found.");
        return;
      }
      for (const c of contacts) {
        const email = c.email ? ` <${c.email}>` : "";
        const tags = c.tags.length ? ` [${c.tags.join(", ")}]` : "";
        console.log(`  ${c.first_name} ${c.last_name || ""}${email}${tags}`);
      }
      console.log(`\n${contacts.length} contact(s)`);
    }
  });

program
  .command("update")
  .description("Update a contact")
  .argument("<id>", "Contact ID")
  .option("--first-name <name>", "First name")
  .option("--last-name <name>", "Last name")
  .option("--email <email>", "Email")
  .option("--phone <phone>", "Phone")
  .option("--company <id>", "Company ID")
  .option("--title <title>", "Job title")
  .option("--notes <notes>", "Notes")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.firstName !== undefined) input.first_name = opts.firstName;
    if (opts.lastName !== undefined) input.last_name = opts.lastName;
    if (opts.email !== undefined) input.email = opts.email;
    if (opts.phone !== undefined) input.phone = opts.phone;
    if (opts.company !== undefined) input.company_id = opts.company;
    if (opts.title !== undefined) input.title = opts.title;
    if (opts.notes !== undefined) input.notes = opts.notes;
    if (opts.tags !== undefined) input.tags = opts.tags.split(",").map((t: string) => t.trim());

    const contact = updateContact(id, input);
    if (!contact) {
      console.error(`Contact '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(contact, null, 2));
    } else {
      console.log(`Updated: ${contact.first_name} ${contact.last_name || ""}`);
    }
  });

program
  .command("delete")
  .description("Delete a contact")
  .argument("<id>", "Contact ID")
  .action((id) => {
    const deleted = deleteContact(id);
    if (deleted) {
      console.log(`Deleted contact ${id}`);
    } else {
      console.error(`Contact '${id}' not found.`);
      process.exit(1);
    }
  });

program
  .command("search")
  .description("Search contacts")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .action((query, opts) => {
    const results = searchContacts(query);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log(`No contacts matching "${query}".`);
        return;
      }
      for (const c of results) {
        console.log(`  ${c.first_name} ${c.last_name || ""} ${c.email ? `<${c.email}>` : ""}`);
      }
    }
  });

program
  .command("count")
  .description("Count contacts")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const count = countContacts();
    if (opts.json) {
      console.log(JSON.stringify({ count }));
    } else {
      console.log(`${count} contact(s)`);
    }
  });

// --- Companies ---

const companiesCmd = program
  .command("company")
  .description("Company management");

companiesCmd
  .command("add")
  .description("Add a company")
  .requiredOption("--name <name>", "Company name")
  .option("--domain <domain>", "Website domain")
  .option("--industry <industry>", "Industry")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const company = createCompany({
      name: opts.name,
      domain: opts.domain,
      industry: opts.industry,
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(company, null, 2));
    } else {
      console.log(`Created company: ${company.name} (${company.id})`);
    }
  });

companiesCmd
  .command("list")
  .description("List companies")
  .option("--search <query>", "Search")
  .option("--industry <industry>", "Filter by industry")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const companies = listCompanies({
      search: opts.search,
      industry: opts.industry,
    });

    if (opts.json) {
      console.log(JSON.stringify(companies, null, 2));
    } else {
      if (companies.length === 0) {
        console.log("No companies found.");
        return;
      }
      for (const c of companies) {
        const domain = c.domain ? ` (${c.domain})` : "";
        console.log(`  ${c.name}${domain}`);
      }
    }
  });

companiesCmd
  .command("get")
  .description("Get a company")
  .argument("<id>", "Company ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const company = getCompany(id);
    if (!company) {
      console.error(`Company '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(company, null, 2));
    } else {
      console.log(`${company.name}`);
      if (company.domain) console.log(`  Domain: ${company.domain}`);
      if (company.industry) console.log(`  Industry: ${company.industry}`);
      if (company.notes) console.log(`  Notes: ${company.notes}`);
    }
  });

companiesCmd
  .command("update")
  .description("Update a company")
  .argument("<id>", "Company ID")
  .option("--name <name>", "Name")
  .option("--domain <domain>", "Domain")
  .option("--industry <industry>", "Industry")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.domain !== undefined) input.domain = opts.domain;
    if (opts.industry !== undefined) input.industry = opts.industry;
    if (opts.notes !== undefined) input.notes = opts.notes;

    const company = updateCompany(id, input);
    if (!company) {
      console.error(`Company '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(company, null, 2));
    } else {
      console.log(`Updated: ${company.name}`);
    }
  });

companiesCmd
  .command("delete")
  .description("Delete a company")
  .argument("<id>", "Company ID")
  .action((id) => {
    const deleted = deleteCompany(id);
    if (deleted) {
      console.log(`Deleted company ${id}`);
    } else {
      console.error(`Company '${id}' not found.`);
      process.exit(1);
    }
  });

// --- Relationships ---

const relCmd = program
  .command("relationship")
  .alias("rel")
  .description("Contact relationships");

relCmd
  .command("add")
  .description("Add a relationship between contacts")
  .requiredOption("--from <id>", "Contact ID")
  .requiredOption("--to <id>", "Related contact ID")
  .option("--type <type>", "Relationship type", "knows")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const rel = createRelationship({
      contact_id: opts.from,
      related_contact_id: opts.to,
      type: opts.type,
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(rel, null, 2));
    } else {
      console.log(`Created relationship: ${rel.contact_id} -> ${rel.related_contact_id} (${rel.type})`);
    }
  });

relCmd
  .command("list")
  .description("List relationships for a contact")
  .argument("<contact-id>", "Contact ID")
  .option("--json", "Output as JSON", false)
  .action((contactId, opts) => {
    const rels = getContactRelationships(contactId);

    if (opts.json) {
      console.log(JSON.stringify(rels, null, 2));
    } else {
      if (rels.length === 0) {
        console.log("No relationships found.");
        return;
      }
      for (const r of rels) {
        const other = r.contact_id === contactId ? r.related_contact_id : r.contact_id;
        console.log(`  ${r.type} -> ${other}`);
      }
    }
  });

relCmd
  .command("delete")
  .description("Delete a relationship")
  .argument("<id>", "Relationship ID")
  .action((id) => {
    const deleted = deleteRelationship(id);
    if (deleted) {
      console.log(`Deleted relationship ${id}`);
    } else {
      console.error(`Relationship '${id}' not found.`);
      process.exit(1);
    }
  });

program.parse(process.argv);
