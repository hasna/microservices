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
import {
  createObligation,
  getObligation,
  listObligations,
  completeObligation,
  listOverdueObligations,
} from "./contracts";
import {
  submitForReview,
  approveContract,
} from "./contracts";
import {
  getContractHistory,
} from "./contracts";
import {
  recordSignature,
  getSignature,
  listSignatures,
} from "./contracts";
import {
  saveClauseTemplate,
  getClauseTemplate,
  getClauseTemplateByName,
  listClauseTemplates,
  addClauseFromTemplate,
} from "./contracts";
import {
  setMultiReminders,
} from "./contracts";
import {
  compareContracts,
} from "./contracts";
import {
  exportContract,
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

// --- New QoL feature tests ---

describe("Obligations", () => {
  test("create and get obligation", () => {
    const contract = createContract({ title: "Obligation Contract" });
    const clause = createClause({
      contract_id: contract.id,
      name: "Delivery",
      text: "Deliver goods within 30 days.",
    });

    const obligation = createObligation({
      clause_id: clause.id,
      description: "Deliver initial batch",
      due_date: "2025-06-15",
      assigned_to: "John Doe",
    });

    expect(obligation.id).toBeTruthy();
    expect(obligation.clause_id).toBe(clause.id);
    expect(obligation.description).toBe("Deliver initial batch");
    expect(obligation.due_date).toBe("2025-06-15");
    expect(obligation.status).toBe("pending");
    expect(obligation.assigned_to).toBe("John Doe");

    const fetched = getObligation(obligation.id);
    expect(fetched).toBeDefined();
    expect(fetched!.description).toBe("Deliver initial batch");
  });

  test("create obligation with minimal fields", () => {
    const contract = createContract({ title: "Min Obligation" });
    const clause = createClause({
      contract_id: contract.id,
      name: "Payment",
      text: "Pay on time.",
    });

    const obligation = createObligation({
      clause_id: clause.id,
      description: "Make first payment",
    });

    expect(obligation.due_date).toBeNull();
    expect(obligation.assigned_to).toBeNull();
    expect(obligation.status).toBe("pending");
  });

  test("list obligations for a clause", () => {
    const contract = createContract({ title: "Multi-Obligation" });
    const clause = createClause({
      contract_id: contract.id,
      name: "Terms",
      text: "Terms text.",
    });

    createObligation({ clause_id: clause.id, description: "Obligation A" });
    createObligation({ clause_id: clause.id, description: "Obligation B" });

    const obligations = listObligations(clause.id);
    expect(obligations.length).toBe(2);
    expect(obligations[0].description).toBe("Obligation A");
    expect(obligations[1].description).toBe("Obligation B");
  });

  test("complete obligation", () => {
    const contract = createContract({ title: "Complete Obligation" });
    const clause = createClause({
      contract_id: contract.id,
      name: "Task",
      text: "Do the task.",
    });

    const obligation = createObligation({
      clause_id: clause.id,
      description: "Complete me",
    });

    expect(obligation.status).toBe("pending");
    const completed = completeObligation(obligation.id);
    expect(completed).toBeDefined();
    expect(completed!.status).toBe("completed");
  });

  test("complete nonexistent obligation returns null", () => {
    expect(completeObligation("nonexistent-id")).toBeNull();
  });

  test("list overdue obligations", () => {
    const contract = createContract({ title: "Overdue Contract" });
    const clause = createClause({
      contract_id: contract.id,
      name: "Overdue Clause",
      text: "This has overdue obligations.",
    });

    // Create obligation with past due date
    createObligation({
      clause_id: clause.id,
      description: "This is overdue",
      due_date: "2020-01-01",
    });

    const overdue = listOverdueObligations();
    expect(overdue.length).toBeGreaterThanOrEqual(1);
    expect(overdue.some((o) => o.description === "This is overdue")).toBe(true);
    expect(overdue.every((o) => o.status === "overdue")).toBe(true);
  });

  test("deleting clause cascades to obligations", () => {
    const contract = createContract({ title: "Cascade Obligation" });
    const clause = createClause({
      contract_id: contract.id,
      name: "Cascade Clause",
      text: "Will be deleted.",
    });

    const obligation = createObligation({
      clause_id: clause.id,
      description: "Will cascade away",
    });

    deleteClause(clause.id);
    expect(getObligation(obligation.id)).toBeNull();
  });
});

describe("Approval Workflow", () => {
  test("full approval flow: draft -> pending_review -> pending_signature -> active", () => {
    const contract = createContract({ title: "Approval Flow Test" });
    expect(contract.status).toBe("draft");

    // Submit for review
    const reviewed = submitForReview(contract.id);
    expect(reviewed).toBeDefined();
    expect(reviewed!.status).toBe("pending_review");

    // Approve (pending_review -> pending_signature)
    const pendingSig = approveContract(contract.id);
    expect(pendingSig).toBeDefined();
    expect(pendingSig!.status).toBe("pending_signature");

    // Approve again (pending_signature -> active)
    const active = approveContract(contract.id);
    expect(active).toBeDefined();
    expect(active!.status).toBe("active");
  });

  test("cannot submit non-draft contract for review", () => {
    const contract = createContract({ title: "Already Active", status: "active" });
    expect(() => submitForReview(contract.id)).toThrow("Cannot submit for review");
  });

  test("cannot approve an active contract", () => {
    const contract = createContract({ title: "Already Active 2", status: "active" });
    expect(() => approveContract(contract.id)).toThrow("Cannot approve");
  });

  test("submitForReview returns null for nonexistent contract", () => {
    expect(submitForReview("nonexistent-id")).toBeNull();
  });

  test("approveContract returns null for nonexistent contract", () => {
    expect(approveContract("nonexistent-id")).toBeNull();
  });
});

describe("Version History", () => {
  test("updateContract saves version history", () => {
    const contract = createContract({
      title: "Version Test",
      value: 1000,
      status: "draft",
    });

    // First update
    updateContract(contract.id, { title: "Version Test v2", value: 2000 });

    // Second update
    updateContract(contract.id, { title: "Version Test v3", status: "active" });

    const history = getContractHistory(contract.id);
    expect(history.length).toBe(2);

    // First version should be the original state
    expect(history[0].title).toBe("Version Test");
    expect(history[0].value).toBe(1000);
    expect(history[0].status).toBe("draft");

    // Second version should be the first-updated state
    expect(history[1].title).toBe("Version Test v2");
    expect(history[1].value).toBe(2000);
  });

  test("no version saved for no-op update", () => {
    const contract = createContract({ title: "No-Op Version" });
    updateContract(contract.id, {}); // no changes

    const history = getContractHistory(contract.id);
    // Should have no versions since no actual update occurred
    const versions = history.filter((v) => v.contract_id === contract.id);
    expect(versions.length).toBe(0);
  });

  test("history is empty for new contract", () => {
    const contract = createContract({ title: "Brand New" });
    const history = getContractHistory(contract.id);
    expect(history.length).toBe(0);
  });

  test("version metadata_snapshot stores contract metadata", () => {
    const contract = createContract({
      title: "Meta Version",
      metadata: { dept: "legal" },
    });

    updateContract(contract.id, { title: "Meta Version Updated", metadata: { dept: "finance" } });

    const history = getContractHistory(contract.id);
    expect(history.length).toBe(1);
    expect(history[0].metadata_snapshot).toEqual({ dept: "legal" });
  });
});

describe("Signatures", () => {
  test("record and get signature", () => {
    const contract = createContract({ title: "Signature Contract" });
    const sig = recordSignature({
      contract_id: contract.id,
      signer_name: "Jane Smith",
      signer_email: "jane@example.com",
      method: "digital",
    });

    expect(sig.id).toBeTruthy();
    expect(sig.contract_id).toBe(contract.id);
    expect(sig.signer_name).toBe("Jane Smith");
    expect(sig.signer_email).toBe("jane@example.com");
    expect(sig.method).toBe("digital");
    expect(sig.signed_at).toBeTruthy();

    const fetched = getSignature(sig.id);
    expect(fetched).toBeDefined();
    expect(fetched!.signer_name).toBe("Jane Smith");
  });

  test("record signature with defaults", () => {
    const contract = createContract({ title: "Default Sig" });
    const sig = recordSignature({
      contract_id: contract.id,
      signer_name: "Bob",
    });

    expect(sig.method).toBe("digital");
    expect(sig.signer_email).toBeNull();
  });

  test("record signature with wet and docusign methods", () => {
    const contract = createContract({ title: "Multi-Method Sigs" });

    const wet = recordSignature({
      contract_id: contract.id,
      signer_name: "Alice",
      method: "wet",
    });
    expect(wet.method).toBe("wet");

    const docu = recordSignature({
      contract_id: contract.id,
      signer_name: "Charlie",
      method: "docusign",
    });
    expect(docu.method).toBe("docusign");
  });

  test("list signatures for contract", () => {
    const contract = createContract({ title: "Multi-Sig Contract" });
    recordSignature({ contract_id: contract.id, signer_name: "Signer A" });
    recordSignature({ contract_id: contract.id, signer_name: "Signer B" });

    const sigs = listSignatures(contract.id);
    expect(sigs.length).toBe(2);
    expect(sigs[0].signer_name).toBe("Signer A");
    expect(sigs[1].signer_name).toBe("Signer B");
  });

  test("deleting contract cascades to signatures", () => {
    const contract = createContract({ title: "Cascade Sig" });
    const sig = recordSignature({
      contract_id: contract.id,
      signer_name: "Will Cascade",
    });

    deleteContract(contract.id);
    expect(getSignature(sig.id)).toBeNull();
  });
});

describe("Clause Templates", () => {
  test("save and get clause template", () => {
    const template = saveClauseTemplate({
      name: "Standard NDA",
      text: "Both parties agree to maintain confidentiality of all shared information.",
      type: "standard",
    });

    expect(template.id).toBeTruthy();
    expect(template.name).toBe("Standard NDA");
    expect(template.type).toBe("standard");

    const fetched = getClauseTemplate(template.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Standard NDA");
  });

  test("get clause template by name", () => {
    const template = getClauseTemplateByName("Standard NDA");
    expect(template).toBeDefined();
    expect(template!.name).toBe("Standard NDA");
  });

  test("list clause templates", () => {
    saveClauseTemplate({
      name: "Non-Compete",
      text: "Employee agrees not to compete for 12 months.",
      type: "negotiated",
    });

    const templates = listClauseTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(2);
  });

  test("add clause from template", () => {
    const contract = createContract({ title: "Template Clause Contract" });
    const clause = addClauseFromTemplate(contract.id, "Standard NDA");

    expect(clause.name).toBe("Standard NDA");
    expect(clause.text).toBe("Both parties agree to maintain confidentiality of all shared information.");
    expect(clause.type).toBe("standard");
    expect(clause.contract_id).toBe(contract.id);
  });

  test("add clause from nonexistent template throws", () => {
    const contract = createContract({ title: "No Template" });
    expect(() => addClauseFromTemplate(contract.id, "Nonexistent")).toThrow("not found");
  });

  test("duplicate template name throws", () => {
    expect(() =>
      saveClauseTemplate({ name: "Standard NDA", text: "Duplicate" })
    ).toThrow();
  });
});

describe("Multi-Stage Reminders", () => {
  test("set multi reminders based on days before end date", () => {
    const contract = createContract({
      title: "Multi-Remind Contract",
      end_date: "2025-12-31",
    });

    const reminders = setMultiReminders(contract.id, [60, 30, 7]);
    expect(reminders.length).toBe(3);

    // Check that reminders are created at the right dates
    // end_date is 2025-12-31 so:
    // 60 days before = 2025-11-01
    // 30 days before = 2025-12-01
    // 7 days before = 2025-12-24
    expect(reminders[0].remind_at).toBe("2025-11-01T09:00:00");
    expect(reminders[1].remind_at).toBe("2025-12-01T09:00:00");
    expect(reminders[2].remind_at).toBe("2025-12-24T09:00:00");

    // Check messages
    expect(reminders[0].message).toContain("60 day(s)");
    expect(reminders[1].message).toContain("30 day(s)");
    expect(reminders[2].message).toContain("7 day(s)");
  });

  test("set multi reminders on contract without end_date throws", () => {
    const contract = createContract({ title: "No End Date" });
    expect(() => setMultiReminders(contract.id, [30])).toThrow("no end_date");
  });

  test("set multi reminders on nonexistent contract throws", () => {
    expect(() => setMultiReminders("nonexistent-id", [30])).toThrow("not found");
  });
});

describe("Contract Comparison", () => {
  test("compare two contracts with different fields", () => {
    const c1 = createContract({
      title: "Contract Alpha",
      type: "nda",
      value: 1000,
      counterparty: "Acme",
    });
    const c2 = createContract({
      title: "Contract Beta",
      type: "service",
      value: 2000,
      counterparty: "Acme",
    });

    const diff = compareContracts(c1.id, c2.id);
    expect(diff.contract1.title).toBe("Contract Alpha");
    expect(diff.contract2.title).toBe("Contract Beta");

    // Should have differences for title, type, value
    const fieldNames = diff.field_differences.map((d) => d.field);
    expect(fieldNames).toContain("title");
    expect(fieldNames).toContain("type");
    expect(fieldNames).toContain("value");

    // counterparty should NOT be different
    expect(fieldNames).not.toContain("counterparty");
  });

  test("compare contracts with clause differences", () => {
    const c1 = createContract({ title: "Clause Compare A" });
    const c2 = createContract({ title: "Clause Compare B" });

    createClause({ contract_id: c1.id, name: "Shared", text: "Version A text" });
    createClause({ contract_id: c1.id, name: "Only in A", text: "Exclusive" });

    createClause({ contract_id: c2.id, name: "Shared", text: "Version B text" });
    createClause({ contract_id: c2.id, name: "Only in B", text: "Exclusive" });

    const diff = compareContracts(c1.id, c2.id);

    expect(diff.clause_only_in_1.length).toBe(1);
    expect(diff.clause_only_in_1[0].name).toBe("Only in A");

    expect(diff.clause_only_in_2.length).toBe(1);
    expect(diff.clause_only_in_2[0].name).toBe("Only in B");

    expect(diff.clause_differences.length).toBe(1);
    expect(diff.clause_differences[0].name).toBe("Shared");
    expect(diff.clause_differences[0].contract1_text).toBe("Version A text");
    expect(diff.clause_differences[0].contract2_text).toBe("Version B text");
  });

  test("compare identical contracts shows no differences", () => {
    const c1 = createContract({ title: "Identical A", type: "nda", value: 500 });
    const c2 = createContract({ title: "Identical A", type: "nda", value: 500 });

    const diff = compareContracts(c1.id, c2.id);
    expect(diff.field_differences.length).toBe(0);
    expect(diff.clause_only_in_1.length).toBe(0);
    expect(diff.clause_only_in_2.length).toBe(0);
    expect(diff.clause_differences.length).toBe(0);
  });

  test("compare with nonexistent contract throws", () => {
    const c1 = createContract({ title: "Real" });
    expect(() => compareContracts(c1.id, "nonexistent")).toThrow("not found");
    expect(() => compareContracts("nonexistent", c1.id)).toThrow("not found");
  });
});

describe("Markdown Export", () => {
  test("export contract as markdown", () => {
    const contract = createContract({
      title: "Export Test",
      type: "service",
      status: "active",
      counterparty: "Test Corp",
      counterparty_email: "test@corp.com",
      start_date: "2025-01-01",
      end_date: "2026-01-01",
      value: 10000,
      currency: "USD",
    });

    createClause({
      contract_id: contract.id,
      name: "Payment Terms",
      text: "Net 30 days from invoice date.",
      type: "standard",
    });

    recordSignature({
      contract_id: contract.id,
      signer_name: "John",
      signer_email: "john@corp.com",
      method: "digital",
    });

    const md = exportContract(contract.id, "md");

    expect(md).toContain("# Export Test");
    expect(md).toContain("| Type | service |");
    expect(md).toContain("| Status | active |");
    expect(md).toContain("| Counterparty | Test Corp |");
    expect(md).toContain("## Clauses");
    expect(md).toContain("### Payment Terms (standard)");
    expect(md).toContain("Net 30 days from invoice date.");
    expect(md).toContain("## Signatures");
    expect(md).toContain("**John**");
    expect(md).toContain("(john@corp.com)");
  });

  test("export contract as JSON", () => {
    const contract = createContract({ title: "JSON Export" });
    const json = exportContract(contract.id, "json");
    const parsed = JSON.parse(json);

    expect(parsed.contract.title).toBe("JSON Export");
    expect(Array.isArray(parsed.clauses)).toBe(true);
    expect(Array.isArray(parsed.signatures)).toBe(true);
    expect(Array.isArray(parsed.reminders)).toBe(true);
  });

  test("export nonexistent contract throws", () => {
    expect(() => exportContract("nonexistent-id")).toThrow("not found");
  });

  test("export contract defaults to markdown", () => {
    const contract = createContract({ title: "Default Format" });
    const output = exportContract(contract.id);
    expect(output).toContain("# Default Format");
  });
});
