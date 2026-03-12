#!/usr/bin/env bun

import { Command } from "commander";
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  logTime,
  getEntry,
  listEntries,
  updateEntry,
  deleteEntry,
  getProjectSummary,
  getWeeklySummary,
  getClientSummary,
} from "../db/timesheets.js";

const program = new Command();

program
  .name("microservice-timesheets")
  .description("Timesheet management microservice")
  .version("0.0.1");

// --- Projects ---

const projectCmd = program
  .command("project")
  .description("Project management");

projectCmd
  .command("add")
  .description("Add a new project")
  .requiredOption("--name <name>", "Project name")
  .option("--client <client>", "Client name")
  .option("--rate <rate>", "Hourly rate", "0")
  .option("--budget <hours>", "Budget hours", "0")
  .option("--status <status>", "Status: active|completed|archived", "active")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const project = createProject({
      name: opts.name,
      client: opts.client,
      hourly_rate: parseFloat(opts.rate),
      budget_hours: parseFloat(opts.budget),
      status: opts.status,
    });

    if (opts.json) {
      console.log(JSON.stringify(project, null, 2));
    } else {
      console.log(`Created project: ${project.name} (${project.id})`);
    }
  });

projectCmd
  .command("get")
  .description("Get a project by ID")
  .argument("<id>", "Project ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const project = getProject(id);
    if (!project) {
      console.error(`Project '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(project, null, 2));
    } else {
      console.log(`${project.name}`);
      console.log(`  Status: ${project.status}`);
      if (project.client) console.log(`  Client: ${project.client}`);
      if (project.hourly_rate) console.log(`  Rate:   $${project.hourly_rate}/hr`);
      if (project.budget_hours) console.log(`  Budget: ${project.budget_hours} hrs`);
    }
  });

projectCmd
  .command("list")
  .description("List projects")
  .option("--status <status>", "Filter by status")
  .option("--client <client>", "Filter by client")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const projects = listProjects({
      status: opts.status,
      client: opts.client,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(projects, null, 2));
    } else {
      if (projects.length === 0) {
        console.log("No projects found.");
        return;
      }
      for (const p of projects) {
        const client = p.client ? ` (${p.client})` : "";
        const rate = p.hourly_rate ? ` $${p.hourly_rate}/hr` : "";
        console.log(`  ${p.name}${client}${rate} [${p.status}]`);
      }
      console.log(`\n${projects.length} project(s)`);
    }
  });

projectCmd
  .command("update")
  .description("Update a project")
  .argument("<id>", "Project ID")
  .option("--name <name>", "Project name")
  .option("--client <client>", "Client name")
  .option("--rate <rate>", "Hourly rate")
  .option("--budget <hours>", "Budget hours")
  .option("--status <status>", "Status")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.client !== undefined) input.client = opts.client;
    if (opts.rate !== undefined) input.hourly_rate = parseFloat(opts.rate);
    if (opts.budget !== undefined) input.budget_hours = parseFloat(opts.budget);
    if (opts.status !== undefined) input.status = opts.status;

    const project = updateProject(id, input);
    if (!project) {
      console.error(`Project '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(project, null, 2));
    } else {
      console.log(`Updated: ${project.name}`);
    }
  });

projectCmd
  .command("delete")
  .description("Delete a project")
  .argument("<id>", "Project ID")
  .action((id) => {
    const deleted = deleteProject(id);
    if (deleted) {
      console.log(`Deleted project ${id}`);
    } else {
      console.error(`Project '${id}' not found.`);
      process.exit(1);
    }
  });

// --- Time Entries ---

program
  .command("log")
  .description("Log a time entry")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--description <text>", "Description of work")
  .requiredOption("--hours <hours>", "Hours worked")
  .option("--date <date>", "Date (YYYY-MM-DD)")
  .option("--no-billable", "Mark as non-billable")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const entry = logTime({
      project_id: opts.project,
      description: opts.description,
      hours: parseFloat(opts.hours),
      date: opts.date,
      billable: opts.billable,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(entry, null, 2));
    } else {
      const billable = entry.billable ? "" : " (non-billable)";
      console.log(`Logged ${entry.hours}h: ${entry.description}${billable} [${entry.date}]`);
    }
  });

program
  .command("get")
  .description("Get a time entry by ID")
  .argument("<id>", "Entry ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const entry = getEntry(id);
    if (!entry) {
      console.error(`Entry '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(entry, null, 2));
    } else {
      const billable = entry.billable ? "billable" : "non-billable";
      console.log(`${entry.description}`);
      console.log(`  Date:     ${entry.date}`);
      console.log(`  Hours:    ${entry.hours} (${billable})`);
      console.log(`  Project:  ${entry.project_id}`);
      if (entry.tags.length) console.log(`  Tags:     ${entry.tags.join(", ")}`);
    }
  });

program
  .command("list")
  .description("List time entries")
  .option("--project <id>", "Filter by project ID")
  .option("--from <date>", "From date (YYYY-MM-DD)")
  .option("--to <date>", "To date (YYYY-MM-DD)")
  .option("--billable", "Show only billable entries")
  .option("--non-billable", "Show only non-billable entries")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    let billable: boolean | undefined;
    if (opts.billable) billable = true;
    if (opts.nonBillable) billable = false;

    const entries = listEntries({
      project_id: opts.project,
      from_date: opts.from,
      to_date: opts.to,
      billable,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(entries, null, 2));
    } else {
      if (entries.length === 0) {
        console.log("No entries found.");
        return;
      }
      for (const e of entries) {
        const b = e.billable ? "" : " (nb)";
        const tags = e.tags.length ? ` [${e.tags.join(", ")}]` : "";
        console.log(`  ${e.date}  ${String(e.hours).padEnd(5)}h  ${e.description}${b}${tags}`);
      }
      const total = entries.reduce((sum, e) => sum + e.hours, 0);
      console.log(`\n${entries.length} entry/entries, ${total}h total`);
    }
  });

program
  .command("update")
  .description("Update a time entry")
  .argument("<id>", "Entry ID")
  .option("--project <id>", "Project ID")
  .option("--description <text>", "Description")
  .option("--date <date>", "Date")
  .option("--hours <hours>", "Hours")
  .option("--billable <bool>", "Billable (true/false)")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.project !== undefined) input.project_id = opts.project;
    if (opts.description !== undefined) input.description = opts.description;
    if (opts.date !== undefined) input.date = opts.date;
    if (opts.hours !== undefined) input.hours = parseFloat(opts.hours);
    if (opts.billable !== undefined) input.billable = opts.billable === "true";
    if (opts.tags !== undefined) input.tags = opts.tags.split(",").map((t: string) => t.trim());

    const entry = updateEntry(id, input);
    if (!entry) {
      console.error(`Entry '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(entry, null, 2));
    } else {
      console.log(`Updated: ${entry.description} (${entry.hours}h on ${entry.date})`);
    }
  });

program
  .command("delete")
  .description("Delete a time entry")
  .argument("<id>", "Entry ID")
  .action((id) => {
    const deleted = deleteEntry(id);
    if (deleted) {
      console.log(`Deleted entry ${id}`);
    } else {
      console.error(`Entry '${id}' not found.`);
      process.exit(1);
    }
  });

// --- Summaries ---

program
  .command("project-summary")
  .description("Get project summary with hours and value")
  .argument("<id>", "Project ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const summary = getProjectSummary(id);
    if (!summary) {
      console.error(`Project '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`\n  Project: ${summary.project_name}`);
      if (summary.client) console.log(`  Client:  ${summary.client}`);
      console.log(`  Total Hours:      ${summary.total_hours}`);
      console.log(`  Billable Hours:   ${summary.billable_hours}`);
      console.log(`  Non-Billable:     ${summary.non_billable_hours}`);
      console.log(`  Total Value:      $${summary.total_value.toFixed(2)}`);
      if (summary.budget_hours > 0) {
        console.log(`  Budget:           ${summary.budget_hours}h`);
        console.log(`  Remaining:        ${summary.budget_remaining}h`);
      }
      console.log();
    }
  });

program
  .command("weekly")
  .description("Get weekly summary")
  .argument("<week-start>", "Week start date (YYYY-MM-DD, typically Monday)")
  .option("--json", "Output as JSON", false)
  .action((weekStart, opts) => {
    const summary = getWeeklySummary(weekStart);

    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`\n  Week of ${summary.week_start}`);
      for (const day of summary.days) {
        const bar = "#".repeat(Math.round(day.hours));
        const label = day.hours > 0 ? `${day.hours}h (${day.entries} entries)` : "-";
        console.log(`  ${day.date}  ${label.padEnd(20)} ${bar}`);
      }
      console.log(`\n  Total: ${summary.total_hours}h across ${summary.total_entries} entries`);
      console.log();
    }
  });

program
  .command("client-summary")
  .description("Get summary by client")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const summaries = getClientSummary();

    if (opts.json) {
      console.log(JSON.stringify(summaries, null, 2));
    } else {
      if (summaries.length === 0) {
        console.log("No data found.");
        return;
      }
      console.log("\n  Client Summary");
      for (const s of summaries) {
        console.log(`  ${s.client}`);
        console.log(`    Projects: ${s.projects}  Hours: ${s.total_hours}  Billable: ${s.billable_hours}  Value: $${s.total_value.toFixed(2)}`);
      }
      console.log();
    }
  });

program.parse(process.argv);
