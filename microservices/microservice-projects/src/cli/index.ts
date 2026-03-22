#!/usr/bin/env bun

import { Command } from "commander";
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  searchProjects,
  getProjectTimeline,
  getBudgetVsActual,
  getOverdueProjects,
  getOverdueMilestones,
  getProjectStats,
  getMilestoneProgress,
} from "../db/projects.js";
import {
  createMilestone,
  listMilestones,
  completeMilestone,
} from "../db/projects.js";
import {
  createDeliverable,
  listDeliverables,
  completeDeliverable,
} from "../db/projects.js";

const program = new Command();

program
  .name("microservice-projects")
  .description("Project management microservice")
  .version("0.0.1");

// --- Projects ---

program
  .command("create")
  .description("Create a new project")
  .requiredOption("--name <name>", "Project name")
  .option("--description <desc>", "Description")
  .option("--client <client>", "Client name")
  .option("--status <status>", "Status (planning|active|on_hold|completed|cancelled)")
  .option("--budget <amount>", "Budget amount")
  .option("--currency <currency>", "Currency (default: USD)")
  .option("--start-date <date>", "Start date (ISO)")
  .option("--end-date <date>", "End date (ISO)")
  .option("--owner <owner>", "Owner name")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const project = createProject({
      name: opts.name,
      description: opts.description,
      client: opts.client,
      status: opts.status,
      budget: opts.budget ? parseFloat(opts.budget) : undefined,
      currency: opts.currency,
      start_date: opts.startDate,
      end_date: opts.endDate,
      owner: opts.owner,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(project, null, 2));
    } else {
      console.log(`Created project: ${project.name} (${project.id})`);
    }
  });

program
  .command("list")
  .description("List projects")
  .option("--status <status>", "Filter by status")
  .option("--client <client>", "Filter by client")
  .option("--owner <owner>", "Filter by owner")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const projects = listProjects({
      status: opts.status,
      client: opts.client,
      owner: opts.owner,
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
        const status = `[${p.status}]`;
        const client = p.client ? ` (${p.client})` : "";
        console.log(`  ${p.name}${client} ${status}`);
      }
      console.log(`\n${projects.length} project(s)`);
    }
  });

program
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
      console.log(`${project.name} [${project.status}]`);
      if (project.description) console.log(`  Description: ${project.description}`);
      if (project.client) console.log(`  Client: ${project.client}`);
      if (project.owner) console.log(`  Owner: ${project.owner}`);
      if (project.budget !== null) console.log(`  Budget: ${project.currency} ${project.budget}`);
      console.log(`  Spent: ${project.currency} ${project.spent}`);
      if (project.start_date) console.log(`  Start: ${project.start_date}`);
      if (project.end_date) console.log(`  End: ${project.end_date}`);
      if (project.tags.length) console.log(`  Tags: ${project.tags.join(", ")}`);
    }
  });

program
  .command("update")
  .description("Update a project")
  .argument("<id>", "Project ID")
  .option("--name <name>", "Name")
  .option("--description <desc>", "Description")
  .option("--client <client>", "Client")
  .option("--status <status>", "Status")
  .option("--budget <amount>", "Budget")
  .option("--spent <amount>", "Spent")
  .option("--currency <currency>", "Currency")
  .option("--start-date <date>", "Start date")
  .option("--end-date <date>", "End date")
  .option("--owner <owner>", "Owner")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.description !== undefined) input.description = opts.description;
    if (opts.client !== undefined) input.client = opts.client;
    if (opts.status !== undefined) input.status = opts.status;
    if (opts.budget !== undefined) input.budget = parseFloat(opts.budget);
    if (opts.spent !== undefined) input.spent = parseFloat(opts.spent);
    if (opts.currency !== undefined) input.currency = opts.currency;
    if (opts.startDate !== undefined) input.start_date = opts.startDate;
    if (opts.endDate !== undefined) input.end_date = opts.endDate;
    if (opts.owner !== undefined) input.owner = opts.owner;
    if (opts.tags !== undefined) input.tags = opts.tags.split(",").map((t: string) => t.trim());

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

program
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

program
  .command("search")
  .description("Search projects")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .action((query, opts) => {
    const results = searchProjects(query);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log(`No projects matching "${query}".`);
        return;
      }
      for (const p of results) {
        console.log(`  ${p.name} [${p.status}]`);
      }
    }
  });

// --- Milestones ---

const milestoneCmd = program
  .command("milestone")
  .description("Milestone management");

milestoneCmd
  .command("create")
  .description("Create a milestone")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--name <name>", "Milestone name")
  .option("--description <desc>", "Description")
  .option("--due-date <date>", "Due date (ISO)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const milestone = createMilestone({
      project_id: opts.project,
      name: opts.name,
      description: opts.description,
      due_date: opts.dueDate,
    });

    if (opts.json) {
      console.log(JSON.stringify(milestone, null, 2));
    } else {
      console.log(`Created milestone: ${milestone.name} (${milestone.id})`);
    }
  });

milestoneCmd
  .command("list")
  .description("List milestones")
  .option("--project <id>", "Filter by project ID")
  .option("--status <status>", "Filter by status")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const milestones = listMilestones({
      project_id: opts.project,
      status: opts.status,
    });

    if (opts.json) {
      console.log(JSON.stringify(milestones, null, 2));
    } else {
      if (milestones.length === 0) {
        console.log("No milestones found.");
        return;
      }
      for (const m of milestones) {
        const due = m.due_date ? ` (due: ${m.due_date})` : "";
        console.log(`  ${m.name} [${m.status}]${due}`);
      }
      console.log(`\n${milestones.length} milestone(s)`);
    }
  });

milestoneCmd
  .command("complete")
  .description("Mark a milestone as completed")
  .argument("<id>", "Milestone ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const milestone = completeMilestone(id);
    if (!milestone) {
      console.error(`Milestone '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(milestone, null, 2));
    } else {
      console.log(`Completed milestone: ${milestone.name}`);
    }
  });

// --- Deliverables ---

const deliverableCmd = program
  .command("deliverable")
  .description("Deliverable management");

deliverableCmd
  .command("create")
  .description("Create a deliverable")
  .requiredOption("--milestone <id>", "Milestone ID")
  .requiredOption("--name <name>", "Deliverable name")
  .option("--description <desc>", "Description")
  .option("--assignee <assignee>", "Assignee")
  .option("--due-date <date>", "Due date (ISO)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const deliverable = createDeliverable({
      milestone_id: opts.milestone,
      name: opts.name,
      description: opts.description,
      assignee: opts.assignee,
      due_date: opts.dueDate,
    });

    if (opts.json) {
      console.log(JSON.stringify(deliverable, null, 2));
    } else {
      console.log(`Created deliverable: ${deliverable.name} (${deliverable.id})`);
    }
  });

deliverableCmd
  .command("list")
  .description("List deliverables")
  .option("--milestone <id>", "Filter by milestone ID")
  .option("--status <status>", "Filter by status")
  .option("--assignee <assignee>", "Filter by assignee")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const deliverables = listDeliverables({
      milestone_id: opts.milestone,
      status: opts.status,
      assignee: opts.assignee,
    });

    if (opts.json) {
      console.log(JSON.stringify(deliverables, null, 2));
    } else {
      if (deliverables.length === 0) {
        console.log("No deliverables found.");
        return;
      }
      for (const d of deliverables) {
        const assignee = d.assignee ? ` -> ${d.assignee}` : "";
        console.log(`  ${d.name} [${d.status}]${assignee}`);
      }
      console.log(`\n${deliverables.length} deliverable(s)`);
    }
  });

deliverableCmd
  .command("complete")
  .description("Mark a deliverable as completed")
  .argument("<id>", "Deliverable ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const deliverable = completeDeliverable(id);
    if (!deliverable) {
      console.error(`Deliverable '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(deliverable, null, 2));
    } else {
      console.log(`Completed deliverable: ${deliverable.name}`);
    }
  });

// --- Advanced Commands ---

program
  .command("timeline")
  .description("Show project timeline with milestones and deliverables")
  .argument("<project-id>", "Project ID")
  .option("--json", "Output as JSON", false)
  .action((projectId, opts) => {
    const project = getProject(projectId);
    if (!project) {
      console.error(`Project '${projectId}' not found.`);
      process.exit(1);
    }

    const timeline = getProjectTimeline(projectId);

    if (opts.json) {
      console.log(JSON.stringify({ project: project.name, timeline }, null, 2));
    } else {
      console.log(`Timeline for: ${project.name}\n`);
      if (timeline.length === 0) {
        console.log("  No milestones or deliverables.");
        return;
      }
      for (const entry of timeline) {
        const due = entry.due_date ? ` (due: ${entry.due_date})` : "";
        if (entry.type === "milestone") {
          console.log(`  [M] ${entry.name} [${entry.status}]${due}`);
        } else {
          console.log(`      [D] ${entry.name} [${entry.status}]${due}`);
        }
      }
    }
  });

program
  .command("budget")
  .description("Show budget vs actual for a project")
  .argument("<project-id>", "Project ID")
  .option("--json", "Output as JSON", false)
  .action((projectId, opts) => {
    const report = getBudgetVsActual(projectId);
    if (!report) {
      console.error(`Project '${projectId}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Budget Report: ${report.project_name}\n`);
      if (report.budget !== null) {
        console.log(`  Budget:      ${report.currency} ${report.budget}`);
      } else {
        console.log(`  Budget:      Not set`);
      }
      console.log(`  Spent:       ${report.currency} ${report.spent}`);
      if (report.remaining !== null) {
        console.log(`  Remaining:   ${report.currency} ${report.remaining}`);
      }
      if (report.utilization_pct !== null) {
        console.log(`  Utilization: ${report.utilization_pct}%`);
      }
    }
  });

program
  .command("overdue")
  .description("Show overdue projects and milestones")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const projects = getOverdueProjects();
    const milestones = getOverdueMilestones();

    if (opts.json) {
      console.log(JSON.stringify({ overdue_projects: projects, overdue_milestones: milestones }, null, 2));
    } else {
      console.log("Overdue Projects:");
      if (projects.length === 0) {
        console.log("  None");
      } else {
        for (const p of projects) {
          console.log(`  ${p.name} (end: ${p.end_date}) [${p.status}]`);
        }
      }
      console.log("\nOverdue Milestones:");
      if (milestones.length === 0) {
        console.log("  None");
      } else {
        for (const m of milestones) {
          console.log(`  ${m.name} (due: ${m.due_date}) [${m.status}]`);
        }
      }
    }
  });

program
  .command("stats")
  .description("Show project statistics")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getProjectStats();

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(`Project Statistics:\n`);
      console.log(`  Total projects: ${stats.total}`);
      for (const [status, count] of Object.entries(stats.by_status)) {
        console.log(`    ${status}: ${count}`);
      }
      console.log(`  Total budget: ${stats.total_budget}`);
      console.log(`  Total spent:  ${stats.total_spent}`);
    }
  });

program.parse(process.argv);
