import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-compliance-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

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
} from "./compliance";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ========================
// Requirements
// ========================

describe("Requirements", () => {
  test("create and get requirement", () => {
    const req = createRequirement({
      name: "Data encryption at rest",
      framework: "gdpr",
      description: "All PII must be encrypted at rest",
      reviewer: "Alice",
    });

    expect(req.id).toBeTruthy();
    expect(req.name).toBe("Data encryption at rest");
    expect(req.framework).toBe("gdpr");
    expect(req.status).toBe("in_progress");
    expect(req.description).toBe("All PII must be encrypted at rest");
    expect(req.reviewer).toBe("Alice");

    const fetched = getRequirement(req.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(req.id);
  });

  test("create requirement with all fields", () => {
    const req = createRequirement({
      name: "Access logging",
      framework: "soc2",
      status: "compliant",
      description: "All access must be logged",
      evidence: "CloudTrail enabled",
      due_date: "2026-06-01",
      reviewer: "Bob",
      metadata: { priority: "high" },
    });

    expect(req.status).toBe("compliant");
    expect(req.evidence).toBe("CloudTrail enabled");
    expect(req.due_date).toBe("2026-06-01");
    expect(req.metadata).toEqual({ priority: "high" });
  });

  test("list requirements", () => {
    const all = listRequirements();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list requirements by framework", () => {
    const gdpr = listRequirements({ framework: "gdpr" });
    expect(gdpr.length).toBeGreaterThanOrEqual(1);
    expect(gdpr.every((r) => r.framework === "gdpr")).toBe(true);
  });

  test("list requirements by status", () => {
    const compliant = listRequirements({ status: "compliant" });
    expect(compliant.length).toBeGreaterThanOrEqual(1);
    expect(compliant.every((r) => r.status === "compliant")).toBe(true);
  });

  test("search requirements", () => {
    const results = searchRequirements("encryption");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toContain("encryption");
  });

  test("update requirement", () => {
    const req = createRequirement({ name: "Update test req", framework: "hipaa" });
    const updated = updateRequirement(req.id, {
      status: "compliant",
      evidence: "Audit log review passed",
      reviewer: "Charlie",
    });

    expect(updated).toBeDefined();
    expect(updated!.status).toBe("compliant");
    expect(updated!.evidence).toBe("Audit log review passed");
    expect(updated!.reviewer).toBe("Charlie");
  });

  test("update nonexistent requirement returns null", () => {
    const result = updateRequirement("nonexistent-id", { name: "nope" });
    expect(result).toBeNull();
  });

  test("delete requirement", () => {
    const req = createRequirement({ name: "Delete me" });
    expect(deleteRequirement(req.id)).toBe(true);
    expect(getRequirement(req.id)).toBeNull();
  });

  test("delete nonexistent requirement returns false", () => {
    expect(deleteRequirement("nonexistent-id")).toBe(false);
  });

  test("get nonexistent requirement returns null", () => {
    expect(getRequirement("nonexistent-id")).toBeNull();
  });
});

// ========================
// Licenses
// ========================

describe("Licenses", () => {
  test("create and get license", () => {
    const lic = createLicense({
      name: "Adobe CC",
      type: "software",
      issuer: "Adobe",
      license_number: "LIC-001",
      cost: 599.99,
    });

    expect(lic.id).toBeTruthy();
    expect(lic.name).toBe("Adobe CC");
    expect(lic.type).toBe("software");
    expect(lic.issuer).toBe("Adobe");
    expect(lic.license_number).toBe("LIC-001");
    expect(lic.status).toBe("active");
    expect(lic.auto_renew).toBe(false);
    expect(lic.cost).toBe(599.99);

    const fetched = getLicense(lic.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(lic.id);
  });

  test("create license with auto_renew", () => {
    const lic = createLicense({
      name: "AWS Support",
      type: "business",
      auto_renew: true,
      expires_at: "2027-01-01",
    });

    expect(lic.auto_renew).toBe(true);
    expect(lic.expires_at).toBe("2027-01-01");
  });

  test("list licenses", () => {
    const all = listLicenses();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list licenses by type", () => {
    const software = listLicenses({ type: "software" });
    expect(software.length).toBeGreaterThanOrEqual(1);
    expect(software.every((l) => l.type === "software")).toBe(true);
  });

  test("update license", () => {
    const lic = createLicense({ name: "Update test lic", type: "patent" });
    const updated = updateLicense(lic.id, {
      name: "Updated license",
      cost: 100,
      auto_renew: true,
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated license");
    expect(updated!.cost).toBe(100);
    expect(updated!.auto_renew).toBe(true);
  });

  test("renew license", () => {
    const lic = createLicense({
      name: "Renew me",
      expires_at: "2025-01-01",
      status: "expired",
    });

    const renewed = renewLicense(lic.id, "2027-06-01");
    expect(renewed).toBeDefined();
    expect(renewed!.status).toBe("active");
    expect(renewed!.expires_at).toBe("2027-06-01");
  });

  test("list expiring licenses", () => {
    // Create a license expiring soon (use a date in the future but within range)
    createLicense({
      name: "Expiring soon",
      status: "active",
      expires_at: "2026-03-25", // 3 days from "today" (2026-03-22)
    });

    const expiring = listExpiringLicenses(365);
    // At least the one we just created should show up
    expect(expiring.length).toBeGreaterThanOrEqual(1);
  });

  test("delete license", () => {
    const lic = createLicense({ name: "Delete me lic" });
    expect(deleteLicense(lic.id)).toBe(true);
    expect(getLicense(lic.id)).toBeNull();
  });

  test("get license stats", () => {
    const stats = getLicenseStats();
    expect(stats.total).toBeGreaterThanOrEqual(3);
    expect(stats.active).toBeGreaterThanOrEqual(1);
    expect(typeof stats.total_cost).toBe("number");
    expect(typeof stats.by_type).toBe("object");
  });

  test("get nonexistent license returns null", () => {
    expect(getLicense("nonexistent-id")).toBeNull();
  });
});

// ========================
// Audits
// ========================

describe("Audits", () => {
  test("schedule and get audit", () => {
    const audit = scheduleAudit({
      name: "Q1 SOC2 Audit",
      framework: "soc2",
      auditor: "External Firm",
      scheduled_at: "2026-04-01",
    });

    expect(audit.id).toBeTruthy();
    expect(audit.name).toBe("Q1 SOC2 Audit");
    expect(audit.framework).toBe("soc2");
    expect(audit.status).toBe("scheduled");
    expect(audit.auditor).toBe("External Firm");

    const fetched = getAudit(audit.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(audit.id);
  });

  test("list audits", () => {
    scheduleAudit({ name: "GDPR Review", framework: "gdpr" });
    const all = listAudits();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list audits by framework", () => {
    const soc2 = listAudits({ framework: "soc2" });
    expect(soc2.length).toBeGreaterThanOrEqual(1);
    expect(soc2.every((a) => a.framework === "soc2")).toBe(true);
  });

  test("complete audit without critical findings", () => {
    const audit = scheduleAudit({ name: "Clean audit" });
    const completed = completeAudit(audit.id, [
      { issue: "Minor config gap", severity: "low" },
    ]);

    expect(completed).toBeDefined();
    expect(completed!.status).toBe("completed");
    expect(completed!.findings.length).toBe(1);
    expect(completed!.completed_at).toBeTruthy();
  });

  test("complete audit with critical finding marks as failed", () => {
    const audit = scheduleAudit({ name: "Failed audit" });
    const completed = completeAudit(audit.id, [
      { issue: "Unencrypted PII", severity: "critical" },
      { issue: "Missing MFA", severity: "high" },
    ]);

    expect(completed).toBeDefined();
    expect(completed!.status).toBe("failed");
    expect(completed!.findings.length).toBe(2);
  });

  test("get audit report", () => {
    const audit = scheduleAudit({ name: "Report audit" });
    completeAudit(audit.id, [
      { issue: "A", severity: "high" },
      { issue: "B", severity: "low" },
      { issue: "C", severity: "high" },
    ]);

    const report = getAuditReport(audit.id);
    expect(report).toBeDefined();
    expect(report!.summary.total_findings).toBe(3);
    expect(report!.summary.by_severity.high).toBe(2);
    expect(report!.summary.by_severity.low).toBe(1);
  });

  test("get audit report for nonexistent audit returns null", () => {
    expect(getAuditReport("nonexistent-id")).toBeNull();
  });

  test("complete nonexistent audit returns null", () => {
    expect(completeAudit("nonexistent-id", [])).toBeNull();
  });

  test("delete audit", () => {
    const audit = scheduleAudit({ name: "Delete me audit" });
    expect(deleteAudit(audit.id)).toBe(true);
    expect(getAudit(audit.id)).toBeNull();
  });
});

// ========================
// Analytics
// ========================

describe("Analytics", () => {
  test("compliance score", () => {
    // Create requirements with known statuses for score calculation
    createRequirement({ name: "Score test 1", framework: "pci", status: "compliant" });
    createRequirement({ name: "Score test 2", framework: "pci", status: "compliant" });
    createRequirement({ name: "Score test 3", framework: "pci", status: "non_compliant" });
    createRequirement({ name: "Score test 4", framework: "pci", status: "not_applicable" });

    const score = getComplianceScore();
    expect(score.total).toBeGreaterThanOrEqual(4);
    expect(score.compliant).toBeGreaterThanOrEqual(2);
    expect(score.non_compliant).toBeGreaterThanOrEqual(1);
    expect(score.not_applicable).toBeGreaterThanOrEqual(1);
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
  });

  test("framework status", () => {
    const status = getFrameworkStatus("pci");
    expect(status.framework).toBe("pci");
    expect(status.total).toBeGreaterThanOrEqual(3);
    expect(status.requirements.length).toBe(status.total);
    expect(status.score).toBeGreaterThanOrEqual(0);
    expect(status.score).toBeLessThanOrEqual(100);
  });

  test("framework status for empty framework", () => {
    const status = getFrameworkStatus("nonexistent");
    expect(status.total).toBe(0);
    expect(status.score).toBe(100); // no applicable = 100%
    expect(status.requirements.length).toBe(0);
  });
});
