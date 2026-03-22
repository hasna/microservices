#!/usr/bin/env bun

import { Command } from "commander";
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
  renewLicense,
  listExpiringLicenses,
  deleteLicense,
  getLicenseStats,
  scheduleAudit,
  listAudits,
  completeAudit,
  getAuditReport,
  getComplianceScore,
  getFrameworkStatus,
} from "../db/compliance.js";

const program = new Command();

program
  .name("microservice-compliance")
  .description("Compliance management microservice")
  .version("0.0.1");

// --- Requirements ---

const reqCmd = program
  .command("requirement")
  .alias("req")
  .description("Compliance requirement management");

reqCmd
  .command("create")
  .description("Create a compliance requirement")
  .requiredOption("--name <name>", "Requirement name")
  .option("--framework <framework>", "Framework (gdpr, soc2, hipaa, pci, tax, iso27001, custom)")
  .option("--status <status>", "Status (compliant, non_compliant, in_progress, not_applicable)")
  .option("--description <text>", "Description")
  .option("--evidence <text>", "Evidence")
  .option("--due-date <date>", "Due date (YYYY-MM-DD)")
  .option("--reviewer <name>", "Reviewer name")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const req = createRequirement({
      name: opts.name,
      framework: opts.framework,
      status: opts.status,
      description: opts.description,
      evidence: opts.evidence,
      due_date: opts.dueDate,
      reviewer: opts.reviewer,
    });

    if (opts.json) {
      console.log(JSON.stringify(req, null, 2));
    } else {
      console.log(`Created requirement: ${req.name} (${req.id})`);
    }
  });

reqCmd
  .command("list")
  .description("List requirements")
  .option("--framework <framework>", "Filter by framework")
  .option("--status <status>", "Filter by status")
  .option("--search <query>", "Search by name or description")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const reqs = listRequirements({
      framework: opts.framework,
      status: opts.status,
      search: opts.search,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(reqs, null, 2));
    } else {
      if (reqs.length === 0) {
        console.log("No requirements found.");
        return;
      }
      for (const r of reqs) {
        const fw = r.framework ? ` [${r.framework}]` : "";
        console.log(`  ${r.name}${fw} — ${r.status}`);
      }
      console.log(`\n${reqs.length} requirement(s)`);
    }
  });

reqCmd
  .command("get")
  .description("Get a requirement by ID")
  .argument("<id>", "Requirement ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const req = getRequirement(id);
    if (!req) {
      console.error(`Requirement '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(req, null, 2));
    } else {
      console.log(`${req.name}`);
      console.log(`  Status: ${req.status}`);
      if (req.framework) console.log(`  Framework: ${req.framework}`);
      if (req.description) console.log(`  Description: ${req.description}`);
      if (req.evidence) console.log(`  Evidence: ${req.evidence}`);
      if (req.due_date) console.log(`  Due: ${req.due_date}`);
      if (req.reviewer) console.log(`  Reviewer: ${req.reviewer}`);
    }
  });

reqCmd
  .command("update")
  .description("Update a requirement")
  .argument("<id>", "Requirement ID")
  .option("--name <name>", "Name")
  .option("--framework <framework>", "Framework")
  .option("--status <status>", "Status")
  .option("--description <text>", "Description")
  .option("--evidence <text>", "Evidence")
  .option("--due-date <date>", "Due date")
  .option("--reviewer <name>", "Reviewer")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.framework !== undefined) input.framework = opts.framework;
    if (opts.status !== undefined) input.status = opts.status;
    if (opts.description !== undefined) input.description = opts.description;
    if (opts.evidence !== undefined) input.evidence = opts.evidence;
    if (opts.dueDate !== undefined) input.due_date = opts.dueDate;
    if (opts.reviewer !== undefined) input.reviewer = opts.reviewer;

    const req = updateRequirement(id, input);
    if (!req) {
      console.error(`Requirement '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(req, null, 2));
    } else {
      console.log(`Updated: ${req.name} — ${req.status}`);
    }
  });

reqCmd
  .command("delete")
  .description("Delete a requirement")
  .argument("<id>", "Requirement ID")
  .action((id) => {
    const deleted = deleteRequirement(id);
    if (deleted) {
      console.log(`Deleted requirement ${id}`);
    } else {
      console.error(`Requirement '${id}' not found.`);
      process.exit(1);
    }
  });

// --- Licenses ---

const licCmd = program
  .command("license")
  .alias("lic")
  .description("License management");

licCmd
  .command("create")
  .description("Create a license")
  .requiredOption("--name <name>", "License name")
  .option("--type <type>", "Type (software, business, professional, patent, trademark)")
  .option("--issuer <issuer>", "Issuer")
  .option("--license-number <number>", "License number")
  .option("--status <status>", "Status (active, expired, pending_renewal)")
  .option("--issued-at <date>", "Issued date")
  .option("--expires-at <date>", "Expiry date")
  .option("--auto-renew", "Auto-renew", false)
  .option("--cost <amount>", "Cost")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const lic = createLicense({
      name: opts.name,
      type: opts.type,
      issuer: opts.issuer,
      license_number: opts.licenseNumber,
      status: opts.status,
      issued_at: opts.issuedAt,
      expires_at: opts.expiresAt,
      auto_renew: opts.autoRenew,
      cost: opts.cost ? parseFloat(opts.cost) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(lic, null, 2));
    } else {
      console.log(`Created license: ${lic.name} (${lic.id})`);
    }
  });

licCmd
  .command("list")
  .description("List licenses")
  .option("--type <type>", "Filter by type")
  .option("--status <status>", "Filter by status")
  .option("--search <query>", "Search")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const lics = listLicenses({
      type: opts.type,
      status: opts.status,
      search: opts.search,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(lics, null, 2));
    } else {
      if (lics.length === 0) {
        console.log("No licenses found.");
        return;
      }
      for (const l of lics) {
        const type = l.type ? ` [${l.type}]` : "";
        const expires = l.expires_at ? ` expires ${l.expires_at}` : "";
        console.log(`  ${l.name}${type} — ${l.status}${expires}`);
      }
      console.log(`\n${lics.length} license(s)`);
    }
  });

licCmd
  .command("get")
  .description("Get a license by ID")
  .argument("<id>", "License ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const lic = getLicense(id);
    if (!lic) {
      console.error(`License '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(lic, null, 2));
    } else {
      console.log(`${lic.name}`);
      console.log(`  Status: ${lic.status}`);
      if (lic.type) console.log(`  Type: ${lic.type}`);
      if (lic.issuer) console.log(`  Issuer: ${lic.issuer}`);
      if (lic.license_number) console.log(`  Number: ${lic.license_number}`);
      if (lic.expires_at) console.log(`  Expires: ${lic.expires_at}`);
      if (lic.cost !== null) console.log(`  Cost: ${lic.cost}`);
      console.log(`  Auto-renew: ${lic.auto_renew ? "yes" : "no"}`);
    }
  });

licCmd
  .command("renew")
  .description("Renew a license with new expiry date")
  .argument("<id>", "License ID")
  .requiredOption("--expires-at <date>", "New expiry date")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const lic = renewLicense(id, opts.expiresAt);
    if (!lic) {
      console.error(`License '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(lic, null, 2));
    } else {
      console.log(`Renewed: ${lic.name} — expires ${lic.expires_at}`);
    }
  });

licCmd
  .command("expiring")
  .description("List licenses expiring within N days")
  .option("--days <n>", "Number of days", "30")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const days = parseInt(opts.days);
    const lics = listExpiringLicenses(days);

    if (opts.json) {
      console.log(JSON.stringify(lics, null, 2));
    } else {
      if (lics.length === 0) {
        console.log(`No licenses expiring within ${days} days.`);
        return;
      }
      for (const l of lics) {
        console.log(`  ${l.name} — expires ${l.expires_at}`);
      }
      console.log(`\n${lics.length} license(s) expiring within ${days} days`);
    }
  });

// --- Audits ---

const auditCmd = program
  .command("audit")
  .description("Audit management");

auditCmd
  .command("schedule")
  .description("Schedule a new audit")
  .requiredOption("--name <name>", "Audit name")
  .option("--framework <framework>", "Framework")
  .option("--auditor <name>", "Auditor name")
  .option("--scheduled-at <date>", "Scheduled date")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const audit = scheduleAudit({
      name: opts.name,
      framework: opts.framework,
      auditor: opts.auditor,
      scheduled_at: opts.scheduledAt,
    });

    if (opts.json) {
      console.log(JSON.stringify(audit, null, 2));
    } else {
      console.log(`Scheduled audit: ${audit.name} (${audit.id})`);
    }
  });

auditCmd
  .command("list")
  .description("List audits")
  .option("--framework <framework>", "Filter by framework")
  .option("--status <status>", "Filter by status")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const audits = listAudits({
      framework: opts.framework,
      status: opts.status,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(audits, null, 2));
    } else {
      if (audits.length === 0) {
        console.log("No audits found.");
        return;
      }
      for (const a of audits) {
        const fw = a.framework ? ` [${a.framework}]` : "";
        console.log(`  ${a.name}${fw} — ${a.status}`);
      }
      console.log(`\n${audits.length} audit(s)`);
    }
  });

auditCmd
  .command("complete")
  .description("Complete an audit with findings")
  .argument("<id>", "Audit ID")
  .option("--findings <json>", "Findings as JSON array", "[]")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    let findings: unknown[];
    try {
      findings = JSON.parse(opts.findings);
    } catch {
      console.error("Invalid JSON for findings.");
      process.exit(1);
    }

    const audit = completeAudit(id, findings);
    if (!audit) {
      console.error(`Audit '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(audit, null, 2));
    } else {
      console.log(`Completed audit: ${audit.name} — ${audit.status} (${audit.findings.length} finding(s))`);
    }
  });

// --- Analytics ---

program
  .command("score")
  .description("Get overall compliance score")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const score = getComplianceScore();

    if (opts.json) {
      console.log(JSON.stringify(score, null, 2));
    } else {
      console.log(`Compliance Score: ${score.score}%`);
      console.log(`  Total: ${score.total}`);
      console.log(`  Compliant: ${score.compliant}`);
      console.log(`  Non-compliant: ${score.non_compliant}`);
      console.log(`  In progress: ${score.in_progress}`);
      console.log(`  Not applicable: ${score.not_applicable}`);
    }
  });

program
  .command("framework-status")
  .description("Get compliance status for a framework")
  .argument("<framework>", "Framework name")
  .option("--json", "Output as JSON", false)
  .action((framework, opts) => {
    const status = getFrameworkStatus(framework);

    if (opts.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(`Framework: ${status.framework} — ${status.score}% compliant`);
      console.log(`  Total: ${status.total}`);
      console.log(`  Compliant: ${status.compliant}`);
      console.log(`  Non-compliant: ${status.non_compliant}`);
      console.log(`  In progress: ${status.in_progress}`);
      console.log(`  Not applicable: ${status.not_applicable}`);
    }
  });

program
  .command("stats")
  .description("Get license statistics")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getLicenseStats();

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(`License Stats`);
      console.log(`  Total: ${stats.total}`);
      console.log(`  Active: ${stats.active}`);
      console.log(`  Expired: ${stats.expired}`);
      console.log(`  Pending renewal: ${stats.pending_renewal}`);
      console.log(`  Total cost: ${stats.total_cost}`);
      if (Object.keys(stats.by_type).length > 0) {
        console.log(`  By type:`);
        for (const [type, count] of Object.entries(stats.by_type)) {
          console.log(`    ${type}: ${count}`);
        }
      }
    }
  });

program.parse(process.argv);
