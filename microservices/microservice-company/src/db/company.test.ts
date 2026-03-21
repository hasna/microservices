import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-company-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

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
  getMembersByTeam,
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
} from "./company";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// Helper: create a default org for tests that need one
let testOrgId: string;
function ensureOrg(): string {
  if (!testOrgId) {
    const org = createOrg({ name: "Test Corp", email: "test@corp.com" });
    testOrgId = org.id;
  }
  return testOrgId;
}

// ─── Organizations ───────────────────────────────────────────────────────────

describe("Organizations", () => {
  test("create and get organization", () => {
    const org = createOrg({
      name: "Acme Inc",
      legal_name: "Acme Incorporated",
      email: "info@acme.com",
      industry: "Technology",
    });

    expect(org.id).toBeTruthy();
    expect(org.name).toBe("Acme Inc");
    expect(org.legal_name).toBe("Acme Incorporated");
    expect(org.email).toBe("info@acme.com");
    expect(org.currency).toBe("USD");
    expect(org.timezone).toBe("UTC");
    expect(org.fiscal_year_start).toBe("01-01");

    const fetched = getOrg(org.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(org.id);
    expect(fetched!.name).toBe("Acme Inc");
  });

  test("get non-existent org returns null", () => {
    expect(getOrg("non-existent")).toBeNull();
  });

  test("update organization", () => {
    const org = createOrg({ name: "UpdateCo" });
    const updated = updateOrg(org.id, {
      name: "Updated Co",
      industry: "Finance",
      currency: "EUR",
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated Co");
    expect(updated!.industry).toBe("Finance");
    expect(updated!.currency).toBe("EUR");
  });

  test("update non-existent org returns null", () => {
    expect(updateOrg("non-existent", { name: "X" })).toBeNull();
  });

  test("update with no changes returns existing", () => {
    const org = createOrg({ name: "NoChange" });
    const same = updateOrg(org.id, {});
    expect(same).toBeDefined();
    expect(same!.name).toBe("NoChange");
  });

  test("org JSON fields parse correctly", () => {
    const org = createOrg({
      name: "JSON Co",
      address: { street: "123 Main", city: "NY" },
      branding: { color: "#fff" },
      settings: { notify: true },
    });

    expect(org.address).toEqual({ street: "123 Main", city: "NY" });
    expect(org.branding).toEqual({ color: "#fff" });
    expect(org.settings).toEqual({ notify: true });
  });
});

// ─── Teams ───────────────────────────────────────────────────────────────────

describe("Teams", () => {
  test("create and get team", () => {
    const orgId = ensureOrg();
    const team = createTeam({ org_id: orgId, name: "Engineering", department: "R&D" });

    expect(team.id).toBeTruthy();
    expect(team.name).toBe("Engineering");
    expect(team.department).toBe("R&D");
    expect(team.org_id).toBe(orgId);

    const fetched = getTeam(team.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Engineering");
  });

  test("get non-existent team returns null", () => {
    expect(getTeam("non-existent")).toBeNull();
  });

  test("list teams by org", () => {
    const orgId = ensureOrg();
    createTeam({ org_id: orgId, name: "Design" });
    const teams = listTeams({ org_id: orgId });
    expect(teams.length).toBeGreaterThanOrEqual(2);
  });

  test("list teams by department", () => {
    const orgId = ensureOrg();
    const teams = listTeams({ org_id: orgId, department: "R&D" });
    expect(teams.length).toBeGreaterThanOrEqual(1);
    expect(teams.every((t) => t.department === "R&D")).toBe(true);
  });

  test("update team", () => {
    const orgId = ensureOrg();
    const team = createTeam({ org_id: orgId, name: "Old Name" });
    const updated = updateTeam(team.id, { name: "New Name", cost_center: "CC-100" });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("New Name");
    expect(updated!.cost_center).toBe("CC-100");
  });

  test("update non-existent team returns null", () => {
    expect(updateTeam("non-existent", { name: "X" })).toBeNull();
  });

  test("delete team", () => {
    const orgId = ensureOrg();
    const team = createTeam({ org_id: orgId, name: "DeleteMe" });
    expect(deleteTeam(team.id)).toBe(true);
    expect(getTeam(team.id)).toBeNull();
  });

  test("delete non-existent team returns false", () => {
    expect(deleteTeam("non-existent")).toBe(false);
  });

  test("get team tree (hierarchical)", () => {
    const org = createOrg({ name: "Tree Org" });
    const parent = createTeam({ org_id: org.id, name: "Parent" });
    createTeam({ org_id: org.id, name: "Child A", parent_id: parent.id });
    createTeam({ org_id: org.id, name: "Child B", parent_id: parent.id });

    const tree = getTeamTree(org.id);
    expect(tree.length).toBe(1);
    expect(tree[0].name).toBe("Parent");
    expect(tree[0].children.length).toBe(2);
  });

  test("get team members", () => {
    const orgId = ensureOrg();
    const team = createTeam({ org_id: orgId, name: "MemberTeam" });
    addMember({ org_id: orgId, team_id: team.id, name: "Alice" });
    addMember({ org_id: orgId, team_id: team.id, name: "Bob" });

    const members = getTeamMembers(team.id);
    expect(members.length).toBe(2);
  });
});

// ─── Members ─────────────────────────────────────────────────────────────────

describe("Members", () => {
  test("add and get member", () => {
    const orgId = ensureOrg();
    const member = addMember({
      org_id: orgId,
      name: "John Doe",
      email: "john@test.com",
      role: "admin",
      title: "CTO",
    });

    expect(member.id).toBeTruthy();
    expect(member.name).toBe("John Doe");
    expect(member.role).toBe("admin");
    expect(member.status).toBe("active");

    const fetched = getMember(member.id);
    expect(fetched).toBeDefined();
    expect(fetched!.email).toBe("john@test.com");
  });

  test("get non-existent member returns null", () => {
    expect(getMember("non-existent")).toBeNull();
  });

  test("list members with filters", () => {
    const orgId = ensureOrg();
    const members = listMembers({ org_id: orgId });
    expect(members.length).toBeGreaterThanOrEqual(1);
  });

  test("update member", () => {
    const orgId = ensureOrg();
    const member = addMember({ org_id: orgId, name: "Update Me" });
    const updated = updateMember(member.id, { role: "manager", title: "Lead" });

    expect(updated).toBeDefined();
    expect(updated!.role).toBe("manager");
    expect(updated!.title).toBe("Lead");
  });

  test("update non-existent member returns null", () => {
    expect(updateMember("non-existent", { name: "X" })).toBeNull();
  });

  test("remove member", () => {
    const orgId = ensureOrg();
    const member = addMember({ org_id: orgId, name: "Remove Me" });
    expect(removeMember(member.id)).toBe(true);
    expect(getMember(member.id)).toBeNull();
  });

  test("remove non-existent member returns false", () => {
    expect(removeMember("non-existent")).toBe(false);
  });

  test("get members by role", () => {
    const orgId = ensureOrg();
    addMember({ org_id: orgId, name: "Viewer1", role: "viewer" });
    const viewers = getMembersByRole(orgId, "viewer");
    expect(viewers.length).toBeGreaterThanOrEqual(1);
    expect(viewers.every((m) => m.role === "viewer")).toBe(true);
  });

  test("get members by team", () => {
    const orgId = ensureOrg();
    const team = createTeam({ org_id: orgId, name: "ByTeamTest" });
    addMember({ org_id: orgId, team_id: team.id, name: "TeamMember1" });
    const members = getMembersByTeam(team.id);
    expect(members.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Customers ───────────────────────────────────────────────────────────────

describe("Customers", () => {
  test("create and get customer", () => {
    const orgId = ensureOrg();
    const customer = createCustomer({
      org_id: orgId,
      name: "Jane Customer",
      email: "jane@customer.com",
      tags: ["vip", "enterprise"],
      lifetime_value: 5000,
    });

    expect(customer.id).toBeTruthy();
    expect(customer.name).toBe("Jane Customer");
    expect(customer.tags).toEqual(["vip", "enterprise"]);
    expect(customer.lifetime_value).toBe(5000);

    const fetched = getCustomer(customer.id);
    expect(fetched).toBeDefined();
    expect(fetched!.email).toBe("jane@customer.com");
  });

  test("get non-existent customer returns null", () => {
    expect(getCustomer("non-existent")).toBeNull();
  });

  test("list customers", () => {
    const orgId = ensureOrg();
    const customers = listCustomers({ org_id: orgId });
    expect(customers.length).toBeGreaterThanOrEqual(1);
  });

  test("search customers", () => {
    const orgId = ensureOrg();
    const results = searchCustomers(orgId, "Jane");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toContain("Jane");
  });

  test("update customer", () => {
    const orgId = ensureOrg();
    const customer = createCustomer({ org_id: orgId, name: "UpdateCust" });
    const updated = updateCustomer(customer.id, {
      company: "Big Corp",
      lifetime_value: 10000,
    });

    expect(updated).toBeDefined();
    expect(updated!.company).toBe("Big Corp");
    expect(updated!.lifetime_value).toBe(10000);
  });

  test("update non-existent customer returns null", () => {
    expect(updateCustomer("non-existent", { name: "X" })).toBeNull();
  });

  test("delete customer", () => {
    const orgId = ensureOrg();
    const customer = createCustomer({ org_id: orgId, name: "DeleteCust" });
    expect(deleteCustomer(customer.id)).toBe(true);
    expect(getCustomer(customer.id)).toBeNull();
  });

  test("delete non-existent customer returns false", () => {
    expect(deleteCustomer("non-existent")).toBe(false);
  });

  test("get customer by email", () => {
    const orgId = ensureOrg();
    createCustomer({ org_id: orgId, name: "Email Cust", email: "unique@email.com" });
    const found = getCustomerByEmail(orgId, "unique@email.com");
    expect(found).toBeDefined();
    expect(found!.name).toBe("Email Cust");
  });

  test("get customer by email returns null if not found", () => {
    const orgId = ensureOrg();
    expect(getCustomerByEmail(orgId, "nope@email.com")).toBeNull();
  });

  test("merge customers", () => {
    const orgId = ensureOrg();
    const c1 = createCustomer({
      org_id: orgId,
      name: "Primary",
      email: "primary@test.com",
      tags: ["tag1"],
      lifetime_value: 100,
    });
    const c2 = createCustomer({
      org_id: orgId,
      name: "Secondary",
      phone: "555-0123",
      tags: ["tag2"],
      lifetime_value: 200,
    });

    const merged = mergeCustomers(c1.id, c2.id);
    expect(merged).toBeDefined();
    expect(merged!.name).toBe("Primary");
    expect(merged!.email).toBe("primary@test.com");
    expect(merged!.phone).toBe("555-0123");
    expect(merged!.tags).toContain("tag1");
    expect(merged!.tags).toContain("tag2");
    expect(merged!.lifetime_value).toBe(300);

    // Secondary should be deleted
    expect(getCustomer(c2.id)).toBeNull();
  });

  test("merge with non-existent customer returns null", () => {
    expect(mergeCustomers("non-existent", "also-non-existent")).toBeNull();
  });
});

// ─── Vendors ─────────────────────────────────────────────────────────────────

describe("Vendors", () => {
  test("create and get vendor", () => {
    const orgId = ensureOrg();
    const vendor = createVendor({
      org_id: orgId,
      name: "Acme Supplies",
      email: "sales@acme.com",
      category: "supplier",
      payment_terms: "Net 30",
    });

    expect(vendor.id).toBeTruthy();
    expect(vendor.name).toBe("Acme Supplies");
    expect(vendor.category).toBe("supplier");
    expect(vendor.payment_terms).toBe("Net 30");

    const fetched = getVendor(vendor.id);
    expect(fetched).toBeDefined();
    expect(fetched!.email).toBe("sales@acme.com");
  });

  test("get non-existent vendor returns null", () => {
    expect(getVendor("non-existent")).toBeNull();
  });

  test("list vendors", () => {
    const orgId = ensureOrg();
    const vendors = listVendors({ org_id: orgId });
    expect(vendors.length).toBeGreaterThanOrEqual(1);
  });

  test("search vendors", () => {
    const orgId = ensureOrg();
    const results = searchVendors(orgId, "Acme");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("get vendors by category", () => {
    const orgId = ensureOrg();
    createVendor({ org_id: orgId, name: "Contractor Co", category: "contractor" });
    const contractors = getVendorsByCategory(orgId, "contractor");
    expect(contractors.length).toBeGreaterThanOrEqual(1);
    expect(contractors.every((v) => v.category === "contractor")).toBe(true);
  });

  test("update vendor", () => {
    const orgId = ensureOrg();
    const vendor = createVendor({ org_id: orgId, name: "UpdateVendor" });
    const updated = updateVendor(vendor.id, {
      category: "partner",
      payment_terms: "Net 60",
    });

    expect(updated).toBeDefined();
    expect(updated!.category).toBe("partner");
    expect(updated!.payment_terms).toBe("Net 60");
  });

  test("update non-existent vendor returns null", () => {
    expect(updateVendor("non-existent", { name: "X" })).toBeNull();
  });

  test("delete vendor", () => {
    const orgId = ensureOrg();
    const vendor = createVendor({ org_id: orgId, name: "DeleteVendor" });
    expect(deleteVendor(vendor.id)).toBe(true);
    expect(getVendor(vendor.id)).toBeNull();
  });

  test("delete non-existent vendor returns false", () => {
    expect(deleteVendor("non-existent")).toBe(false);
  });
});
