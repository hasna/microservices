import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-contacts-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createContact,
  getContact,
  listContacts,
  updateContact,
  deleteContact,
  countContacts,
  searchContacts,
  getContactsByTag,
} from "./contacts";
import {
  createCompany,
  getCompany,
  listCompanies,
  deleteCompany,
} from "./companies";
import {
  createRelationship,
  getContactRelationships,
  deleteRelationship,
} from "./relationships";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Contacts", () => {
  test("create and get contact", () => {
    const contact = createContact({
      first_name: "Alice",
      last_name: "Smith",
      email: "alice@example.com",
      tags: ["friend", "developer"],
    });

    expect(contact.id).toBeTruthy();
    expect(contact.first_name).toBe("Alice");
    expect(contact.last_name).toBe("Smith");
    expect(contact.email).toBe("alice@example.com");
    expect(contact.tags).toEqual(["friend", "developer"]);

    const fetched = getContact(contact.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(contact.id);
  });

  test("list contacts", () => {
    createContact({ first_name: "Bob", last_name: "Jones" });
    const all = listContacts();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("search contacts", () => {
    const results = searchContacts("Alice");
    expect(results.length).toBe(1);
    expect(results[0].first_name).toBe("Alice");
  });

  test("filter by tag", () => {
    const results = getContactsByTag("developer");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((c) => c.tags.includes("developer"))).toBe(true);
  });

  test("update contact", () => {
    const contact = createContact({ first_name: "Charlie" });
    const updated = updateContact(contact.id, {
      last_name: "Brown",
      email: "charlie@example.com",
    });

    expect(updated).toBeDefined();
    expect(updated!.last_name).toBe("Brown");
    expect(updated!.email).toBe("charlie@example.com");
  });

  test("delete contact", () => {
    const contact = createContact({ first_name: "DeleteMe" });
    expect(deleteContact(contact.id)).toBe(true);
    expect(getContact(contact.id)).toBeNull();
  });

  test("count contacts", () => {
    const count = countContacts();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

describe("Companies", () => {
  test("create and get company", () => {
    const company = createCompany({
      name: "Acme Corp",
      domain: "acme.com",
      industry: "Technology",
    });

    expect(company.id).toBeTruthy();
    expect(company.name).toBe("Acme Corp");
    expect(company.domain).toBe("acme.com");

    const fetched = getCompany(company.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Acme Corp");
  });

  test("list companies", () => {
    const companies = listCompanies();
    expect(companies.length).toBeGreaterThanOrEqual(1);
  });

  test("delete company", () => {
    const company = createCompany({ name: "DeleteCo" });
    expect(deleteCompany(company.id)).toBe(true);
    expect(getCompany(company.id)).toBeNull();
  });
});

describe("Relationships", () => {
  test("create and list relationships", () => {
    const c1 = createContact({ first_name: "Rel1" });
    const c2 = createContact({ first_name: "Rel2" });

    const rel = createRelationship({
      contact_id: c1.id,
      related_contact_id: c2.id,
      type: "colleague",
    });

    expect(rel.id).toBeTruthy();
    expect(rel.type).toBe("colleague");

    const rels = getContactRelationships(c1.id);
    expect(rels.length).toBe(1);
    expect(rels[0].type).toBe("colleague");
  });

  test("delete relationship", () => {
    const c1 = createContact({ first_name: "Del1" });
    const c2 = createContact({ first_name: "Del2" });
    const rel = createRelationship({
      contact_id: c1.id,
      related_contact_id: c2.id,
    });

    expect(deleteRelationship(rel.id)).toBe(true);
    expect(getContactRelationships(c1.id).length).toBe(0);
  });
});
