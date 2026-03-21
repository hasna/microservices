import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-contracts-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createContract,
  getContract,
  listContracts,
  updateContract,
  deleteContract,
  searchContracts,
  listExpiring,
  renewContract,
  getContractStats,
} from "./contracts";
import {
  createClause,
  getClause,
  listClauses,
  deleteClause,
} from "./contracts";
import {
  createReminder,
  getReminder,
  listReminders,
  deleteReminder,
  listPendingReminders,
  markReminderSent,
} from "./contracts";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Contracts", () => {
  test("create and get contract", () => {
    const contract = createContract({
      title: "NDA with Acme",
      type: "nda",
      counterparty: "Acme Corp",
      counterparty_email: "legal@acme.com",
    });

    expect(contract.id).toBeTruthy();
    expect(contract.title).toBe("NDA with Acme");
    expect(contract.type).toBe("nda");
    expect(contract.status).toBe("draft");
    expect(contract.counterparty).toBe("Acme Corp");
    expect(contract.counterparty_email).toBe("legal@acme.com");
    expect(contract.currency).toBe("USD");
    expect(contract.auto_renew).toBe(false);

    const fetched = getContract(contract.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(contract.id);
    expect(fetched!.title).toBe("NDA with Acme");
  });

  test("create contract with all fields", () => {
    const contract = createContract({
      title: "Service Agreement",
      type: "service",
      status: "active",
      counterparty: "Beta Inc",
      counterparty_email: "contracts@beta.com",
      start_date: "2025-01-01",
      end_date: "2026-01-01",
      auto_renew: true,
      renewal_period: "1 year",
      value: 50000,
      currency: "EUR",
      file_path: "/docs/service-agreement.pdf",
      metadata: { department: "engineering" },
    });

    expect(contract.type).toBe("service");
    expect(contract.status).toBe("active");
    expect(contract.start_date).toBe("2025-01-01");
    expect(contract.end_date).toBe("2026-01-01");
    expect(contract.auto_renew).toBe(true);
    expect(contract.renewal_period).toBe("1 year");
    expect(contract.value).toBe(50000);
    expect(contract.currency).toBe("EUR");
    expect(contract.file_path).toBe("/docs/service-agreement.pdf");
    expect(contract.metadata).toEqual({ department: "engineering" });
  });

  test("create contract with defaults", () => {
    const contract = createContract({ title: "Simple Contract" });
    expect(contract.type).toBe("other");
    expect(contract.status).toBe("draft");
    expect(contract.currency).toBe("USD");
    expect(contract.auto_renew).toBe(false);
    expect(contract.counterparty).toBeNull();
    expect(contract.value).toBeNull();
  });

  test("list contracts", () => {
    const all = listContracts();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("list contracts with type filter", () => {
    const ndas = listContracts({ type: "nda" });
    expect(ndas.length).toBeGreaterThanOrEqual(1);
    expect(ndas.every((c) => c.type === "nda")).toBe(true);
  });

  test("list contracts with status filter", () => {
    const active = listContracts({ status: "active" });
    expect(active.length).toBeGreaterThanOrEqual(1);
    expect(active.every((c) => c.status === "active")).toBe(true);
  });

  test("list contracts with counterparty filter", () => {
    const results = listContracts({ counterparty: "Acme" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((c) => c.counterparty?.includes("Acme"))).toBe(true);
  });

  test("list contracts with limit", () => {
    const limited = listContracts({ limit: 1 });
    expect(limited.length).toBe(1);
  });

  test("search contracts", () => {
    const results = searchContracts("Acme");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].counterparty).toBe("Acme Corp");
  });

  test("search contracts by title", () => {
    const results = searchContracts("Service Agreement");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toBe("Service Agreement");
  });

  test("update contract", () => {
    const contract = createContract({ title: "To Update" });
    const updated = updateContract(contract.id, {
      title: "Updated Title",
      status: "active",
      value: 10000,
      counterparty: "New Partner",
    });

    expect(updated).toBeDefined();
    expect(updated!.title).toBe("Updated Title");
    expect(updated!.status).toBe("active");
    expect(updated!.value).toBe(10000);
    expect(updated!.counterparty).toBe("New Partner");
  });

  test("update contract returns null for missing id", () => {
    const result = updateContract("nonexistent-id", { title: "Nope" });
    expect(result).toBeNull();
  });

  test("update contract with no changes returns existing", () => {
    const contract = createContract({ title: "No Change" });
    const result = updateContract(contract.id, {});
    expect(result).toBeDefined();
    expect(result!.title).toBe("No Change");
  });

  test("delete contract", () => {
    const contract = createContract({ title: "Delete Me" });
    expect(deleteContract(contract.id)).toBe(true);
    expect(getContract(contract.id)).toBeNull();
  });

  test("delete nonexistent contract returns false", () => {
    expect(deleteContract("nonexistent-id")).toBe(false);
  });

  test("get nonexistent contract returns null", () => {
    expect(getContract("nonexistent-id")).toBeNull();
  });

  test("get contract stats", () => {
    const stats = getContractStats();
    expect(stats.total).toBeGreaterThanOrEqual(3);
    expect(typeof stats.by_status).toBe("object");
    expect(typeof stats.by_type).toBe("object");
    expect(typeof stats.total_value).toBe("number");
    expect(typeof stats.expiring_30_days).toBe("number");
  });

  test("list expiring contracts", () => {
    // Create a contract expiring in 10 days
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    const endDate = futureDate.toISOString().split("T")[0];

    createContract({
      title: "Expiring Soon",
      status: "active",
      end_date: endDate,
    });

    const expiring = listExpiring(30);
    expect(expiring.length).toBeGreaterThanOrEqual(1);
    expect(expiring.some((c) => c.title === "Expiring Soon")).toBe(true);
  });

  test("renew contract", () => {
    const contract = createContract({
      title: "Renewable",
      status: "active",
      end_date: "2025-06-01",
      renewal_period: "6 months",
    });

    const renewed = renewContract(contract.id);
    expect(renewed).toBeDefined();
    expect(renewed!.end_date).toBe("2025-12-01");
    expect(renewed!.status).toBe("active");
  });

  test("renew contract with default period", () => {
    const contract = createContract({
      title: "Default Renew",
      status: "active",
      end_date: "2025-01-01",
    });

    const renewed = renewContract(contract.id);
    expect(renewed).toBeDefined();
    expect(renewed!.end_date).toBe("2026-01-01");
  });

  test("renew nonexistent contract returns null", () => {
    expect(renewContract("nonexistent-id")).toBeNull();
  });
});

describe("Clauses", () => {
  test("create and get clause", () => {
    const contract = createContract({ title: "Clause Test Contract" });
    const clause = createClause({
      contract_id: contract.id,
      name: "Confidentiality",
      text: "Both parties agree to keep all information confidential.",
      type: "standard",
    });

    expect(clause.id).toBeTruthy();
    expect(clause.name).toBe("Confidentiality");
    expect(clause.text).toBe("Both parties agree to keep all information confidential.");
    expect(clause.type).toBe("standard");

    const fetched = getClause(clause.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Confidentiality");
  });

  test("list clauses", () => {
    const contract = createContract({ title: "Multi-Clause Contract" });
    createClause({ contract_id: contract.id, name: "Clause A", text: "Text A" });
    createClause({ contract_id: contract.id, name: "Clause B", text: "Text B", type: "custom" });

    const clauses = listClauses(contract.id);
    expect(clauses.length).toBe(2);
    expect(clauses[0].name).toBe("Clause A");
    expect(clauses[1].name).toBe("Clause B");
    expect(clauses[1].type).toBe("custom");
  });

  test("delete clause", () => {
    const contract = createContract({ title: "Delete Clause Contract" });
    const clause = createClause({
      contract_id: contract.id,
      name: "Removable",
      text: "This clause will be removed.",
    });

    expect(deleteClause(clause.id)).toBe(true);
    expect(getClause(clause.id)).toBeNull();
  });

  test("delete nonexistent clause returns false", () => {
    expect(deleteClause("nonexistent-id")).toBe(false);
  });

  test("deleting contract cascades to clauses", () => {
    const contract = createContract({ title: "Cascade Test" });
    const clause = createClause({
      contract_id: contract.id,
      name: "Will Cascade",
      text: "Gone with the contract.",
    });

    deleteContract(contract.id);
    expect(getClause(clause.id)).toBeNull();
  });
});

describe("Reminders", () => {
  test("create and get reminder", () => {
    const contract = createContract({ title: "Reminder Test Contract" });
    const reminder = createReminder({
      contract_id: contract.id,
      remind_at: "2025-06-01T09:00:00",
      message: "Review contract terms",
    });

    expect(reminder.id).toBeTruthy();
    expect(reminder.remind_at).toBe("2025-06-01T09:00:00");
    expect(reminder.message).toBe("Review contract terms");
    expect(reminder.sent).toBe(false);

    const fetched = getReminder(reminder.id);
    expect(fetched).toBeDefined();
    expect(fetched!.message).toBe("Review contract terms");
  });

  test("list reminders", () => {
    const contract = createContract({ title: "Multi-Reminder Contract" });
    createReminder({ contract_id: contract.id, remind_at: "2025-07-01T09:00:00", message: "First" });
    createReminder({ contract_id: contract.id, remind_at: "2025-08-01T09:00:00", message: "Second" });

    const reminders = listReminders(contract.id);
    expect(reminders.length).toBe(2);
    expect(reminders[0].message).toBe("First");
    expect(reminders[1].message).toBe("Second");
  });

  test("delete reminder", () => {
    const contract = createContract({ title: "Delete Reminder Contract" });
    const reminder = createReminder({
      contract_id: contract.id,
      remind_at: "2025-09-01T09:00:00",
      message: "Will be deleted",
    });

    expect(deleteReminder(reminder.id)).toBe(true);
    expect(getReminder(reminder.id)).toBeNull();
  });

  test("delete nonexistent reminder returns false", () => {
    expect(deleteReminder("nonexistent-id")).toBe(false);
  });

  test("mark reminder as sent", () => {
    const contract = createContract({ title: "Sent Reminder Contract" });
    const reminder = createReminder({
      contract_id: contract.id,
      remind_at: "2025-10-01T09:00:00",
      message: "Mark me sent",
    });

    expect(reminder.sent).toBe(false);
    expect(markReminderSent(reminder.id)).toBe(true);

    const fetched = getReminder(reminder.id);
    expect(fetched!.sent).toBe(true);
  });

  test("list pending reminders", () => {
    const contract = createContract({ title: "Pending Reminder Contract" });
    // Create a reminder in the past (should be pending)
    createReminder({
      contract_id: contract.id,
      remind_at: "2020-01-01T09:00:00",
      message: "Overdue reminder",
    });

    const pending = listPendingReminders();
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending.some((r) => r.message === "Overdue reminder")).toBe(true);
  });

  test("deleting contract cascades to reminders", () => {
    const contract = createContract({ title: "Cascade Reminder Test" });
    const reminder = createReminder({
      contract_id: contract.id,
      remind_at: "2025-11-01T09:00:00",
      message: "Cascade me",
    });

    deleteContract(contract.id);
    expect(getReminder(reminder.id)).toBeNull();
  });
});
