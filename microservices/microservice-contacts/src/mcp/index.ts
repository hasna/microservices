#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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
  countCompanies,
} from "../db/companies.js";
import {
  createRelationship,
  getContactRelationships,
  deleteRelationship,
} from "../db/relationships.js";

const server = new McpServer({
  name: "microservice-contacts",
  version: "0.0.1",
});

// --- Contacts ---

server.registerTool(
  "create_contact",
  {
    title: "Create Contact",
    description: "Create a new contact.",
    inputSchema: {
      first_name: z.string(),
      last_name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      company_id: z.string().optional(),
      title: z.string().optional(),
      notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async (params) => {
    const contact = createContact(params);
    return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
  }
);

server.registerTool(
  "get_contact",
  {
    title: "Get Contact",
    description: "Get a contact by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const contact = getContact(id);
    if (!contact) {
      return { content: [{ type: "text", text: `Contact '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
  }
);

server.registerTool(
  "list_contacts",
  {
    title: "List Contacts",
    description: "List contacts with optional filters.",
    inputSchema: {
      search: z.string().optional(),
      tag: z.string().optional(),
      company_id: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const contacts = listContacts(params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ contacts, count: contacts.length }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "update_contact",
  {
    title: "Update Contact",
    description: "Update an existing contact.",
    inputSchema: {
      id: z.string(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      company_id: z.string().optional(),
      title: z.string().optional(),
      notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const contact = updateContact(id, input);
    if (!contact) {
      return { content: [{ type: "text", text: `Contact '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
  }
);

server.registerTool(
  "delete_contact",
  {
    title: "Delete Contact",
    description: "Delete a contact by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteContact(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_contacts",
  {
    title: "Search Contacts",
    description: "Search contacts by name, email, or phone.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchContacts(query);
    return {
      content: [
        { type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "count_contacts",
  {
    title: "Count Contacts",
    description: "Get the total number of contacts.",
    inputSchema: {},
  },
  async () => {
    const count = countContacts();
    return { content: [{ type: "text", text: JSON.stringify({ count }) }] };
  }
);

// --- Companies ---

server.registerTool(
  "create_company",
  {
    title: "Create Company",
    description: "Create a new company.",
    inputSchema: {
      name: z.string(),
      domain: z.string().optional(),
      industry: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    const company = createCompany(params);
    return { content: [{ type: "text", text: JSON.stringify(company, null, 2) }] };
  }
);

server.registerTool(
  "list_companies",
  {
    title: "List Companies",
    description: "List companies with optional filters.",
    inputSchema: {
      search: z.string().optional(),
      industry: z.string().optional(),
    },
  },
  async (params) => {
    const companies = listCompanies(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ companies, count: companies.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_company",
  {
    title: "Update Company",
    description: "Update a company.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      domain: z.string().optional(),
      industry: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const company = updateCompany(id, input);
    if (!company) {
      return { content: [{ type: "text", text: `Company '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(company, null, 2) }] };
  }
);

server.registerTool(
  "delete_company",
  {
    title: "Delete Company",
    description: "Delete a company by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteCompany(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Relationships ---

server.registerTool(
  "create_relationship",
  {
    title: "Create Relationship",
    description: "Create a relationship between two contacts.",
    inputSchema: {
      contact_id: z.string(),
      related_contact_id: z.string(),
      type: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    const rel = createRelationship(params);
    return { content: [{ type: "text", text: JSON.stringify(rel, null, 2) }] };
  }
);

server.registerTool(
  "list_relationships",
  {
    title: "List Relationships",
    description: "List all relationships for a contact.",
    inputSchema: { contact_id: z.string() },
  },
  async ({ contact_id }) => {
    const rels = getContactRelationships(contact_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ relationships: rels, count: rels.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "delete_relationship",
  {
    title: "Delete Relationship",
    description: "Delete a relationship by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteRelationship(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-contacts MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
