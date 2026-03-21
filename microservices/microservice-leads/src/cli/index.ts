#!/usr/bin/env bun

import { Command } from "commander";
import { readFileSync } from "node:fs";
import {
  createLead,
  getLead,
  listLeads,
  updateLead,
  deleteLead,
  searchLeads,
  bulkImportLeads,
  exportLeads,
  addActivity,
  getActivities,
  getLeadTimeline,
  getLeadStats,
  getPipeline,
  deduplicateLeads,
  mergeLeads,
} from "../db/leads.js";
import {
  createList,
  listLists,
  getListMembers,
  addToList,
  removeFromList,
  deleteList,
} from "../db/lists.js";
import { enrichLead, bulkEnrich } from "../lib/enrichment.js";
import { scoreLead, autoScoreAll, getScoreDistribution } from "../lib/scoring.js";

const program = new Command();

program
  .name("microservice-leads")
  .description("Lead generation, storage, scoring, and data enrichment microservice")
  .version("0.0.1");

// --- Lead CRUD ---

program
  .command("add")
  .description("Add a new lead")
  .option("--name <name>", "Lead name")
  .option("--email <email>", "Email address")
  .option("--phone <phone>", "Phone number")
  .option("--company <company>", "Company name")
  .option("--title <title>", "Job title")
  .option("--website <url>", "Website URL")
  .option("--linkedin <url>", "LinkedIn URL")
  .option("--source <source>", "Lead source", "manual")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const lead = createLead({
      name: opts.name,
      email: opts.email,
      phone: opts.phone,
      company: opts.company,
      title: opts.title,
      website: opts.website,
      linkedin_url: opts.linkedin,
      source: opts.source,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(lead, null, 2));
    } else {
      console.log(`Created lead: ${lead.name || lead.email || lead.id} (${lead.id})`);
    }
  });

program
  .command("get")
  .description("Get a lead by ID")
  .argument("<id>", "Lead ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const lead = getLead(id);
    if (!lead) {
      console.error(`Lead '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(lead, null, 2));
    } else {
      console.log(`${lead.name || "(no name)"}`);
      if (lead.email) console.log(`  Email: ${lead.email}`);
      if (lead.phone) console.log(`  Phone: ${lead.phone}`);
      if (lead.company) console.log(`  Company: ${lead.company}`);
      if (lead.title) console.log(`  Title: ${lead.title}`);
      console.log(`  Status: ${lead.status}`);
      console.log(`  Score: ${lead.score}`);
      if (lead.tags.length) console.log(`  Tags: ${lead.tags.join(", ")}`);
      if (lead.notes) console.log(`  Notes: ${lead.notes}`);
    }
  });

program
  .command("list")
  .description("List leads")
  .option("--status <status>", "Filter by status")
  .option("--source <source>", "Filter by source")
  .option("--score-min <n>", "Minimum score")
  .option("--score-max <n>", "Maximum score")
  .option("--enriched", "Only enriched leads")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const leads = listLeads({
      status: opts.status,
      source: opts.source,
      score_min: opts.scoreMin ? parseInt(opts.scoreMin) : undefined,
      score_max: opts.scoreMax ? parseInt(opts.scoreMax) : undefined,
      enriched: opts.enriched ? true : undefined,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(leads, null, 2));
    } else {
      if (leads.length === 0) {
        console.log("No leads found.");
        return;
      }
      for (const l of leads) {
        const email = l.email ? ` <${l.email}>` : "";
        const score = ` [score: ${l.score}]`;
        console.log(`  ${l.name || "(no name)"}${email} — ${l.status}${score}`);
      }
      console.log(`\n${leads.length} lead(s)`);
    }
  });

program
  .command("update")
  .description("Update a lead")
  .argument("<id>", "Lead ID")
  .option("--name <name>", "Name")
  .option("--email <email>", "Email")
  .option("--phone <phone>", "Phone")
  .option("--company <company>", "Company")
  .option("--title <title>", "Title")
  .option("--website <url>", "Website")
  .option("--linkedin <url>", "LinkedIn URL")
  .option("--source <source>", "Source")
  .option("--status <status>", "Status")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.email !== undefined) input.email = opts.email;
    if (opts.phone !== undefined) input.phone = opts.phone;
    if (opts.company !== undefined) input.company = opts.company;
    if (opts.title !== undefined) input.title = opts.title;
    if (opts.website !== undefined) input.website = opts.website;
    if (opts.linkedin !== undefined) input.linkedin_url = opts.linkedin;
    if (opts.source !== undefined) input.source = opts.source;
    if (opts.status !== undefined) input.status = opts.status;
    if (opts.tags !== undefined) input.tags = opts.tags.split(",").map((t: string) => t.trim());
    if (opts.notes !== undefined) input.notes = opts.notes;

    const lead = updateLead(id, input);
    if (!lead) {
      console.error(`Lead '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(lead, null, 2));
    } else {
      console.log(`Updated: ${lead.name || lead.email || lead.id}`);
    }
  });

program
  .command("delete")
  .description("Delete a lead")
  .argument("<id>", "Lead ID")
  .action((id) => {
    const deleted = deleteLead(id);
    if (deleted) {
      console.log(`Deleted lead ${id}`);
    } else {
      console.error(`Lead '${id}' not found.`);
      process.exit(1);
    }
  });

program
  .command("search")
  .description("Search leads by name, email, or company")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .action((query, opts) => {
    const results = searchLeads(query);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log(`No leads matching "${query}".`);
        return;
      }
      for (const l of results) {
        console.log(`  ${l.name || "(no name)"} ${l.email ? `<${l.email}>` : ""} — ${l.status}`);
      }
    }
  });

// --- Import/Export ---

program
  .command("import")
  .description("Import leads from a CSV file")
  .requiredOption("--file <path>", "CSV file path")
  .option("--enrich", "Enrich after import", false)
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const content = readFileSync(opts.file, "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length < 2) {
      console.error("CSV file must have a header row and at least one data row.");
      process.exit(1);
    }

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const data = lines.slice(1).map((line) => {
      const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = values[i] || ""; });
      return {
        name: row["name"] || undefined,
        email: row["email"] || undefined,
        phone: row["phone"] || undefined,
        company: row["company"] || undefined,
        title: row["title"] || undefined,
        website: row["website"] || undefined,
        linkedin_url: row["linkedin_url"] || row["linkedin"] || undefined,
        source: row["source"] || "csv_import",
      };
    });

    const result = bulkImportLeads(data);

    if (opts.enrich) {
      // Enrich all newly imported leads
      const leads = listLeads({ source: "csv_import", enriched: false });
      const enrichResult = bulkEnrich(leads.map((l) => l.id));
      if (opts.json) {
        console.log(JSON.stringify({ ...result, enrichment: enrichResult }, null, 2));
      } else {
        console.log(`Imported: ${result.imported}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`);
        console.log(`Enriched: ${enrichResult.enriched}, Failed: ${enrichResult.failed}`);
      }
    } else {
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Imported: ${result.imported}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`);
        if (result.errors.length > 0) {
          for (const err of result.errors) console.error(`  ${err}`);
        }
      }
    }
  });

program
  .command("export")
  .description("Export leads")
  .option("--format <format>", "Export format (csv or json)", "json")
  .option("--status <status>", "Filter by status")
  .option("--json", "Force JSON format", false)
  .action((opts) => {
    const format = opts.json ? "json" : (opts.format as "csv" | "json");
    const output = exportLeads(format, { status: opts.status });
    console.log(output);
  });

// --- Enrichment ---

program
  .command("enrich")
  .description("Enrich a lead by ID")
  .argument("<id>", "Lead ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const lead = enrichLead(id);
    if (!lead) {
      console.error(`Lead '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(lead, null, 2));
    } else {
      console.log(`Enriched: ${lead.name || lead.email || lead.id}`);
      if (lead.company) console.log(`  Company: ${lead.company}`);
    }
  });

program
  .command("enrich-all")
  .description("Enrich all un-enriched leads")
  .option("--limit <n>", "Limit number of leads to enrich")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const leads = listLeads({ enriched: false, limit: opts.limit ? parseInt(opts.limit) : undefined });
    const result = bulkEnrich(leads.map((l) => l.id));

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Enriched: ${result.enriched}, Failed: ${result.failed}`);
    }
  });

// --- Scoring ---

program
  .command("score")
  .description("Score a lead by ID")
  .argument("<id>", "Lead ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const result = scoreLead(id);
    if (!result) {
      console.error(`Lead '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Score: ${result.score}/100`);
      console.log(`Reason: ${result.reason}`);
    }
  });

program
  .command("score-all")
  .description("Auto-score all leads with score=0")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const result = autoScoreAll();
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Scored ${result.scored} of ${result.total} unscored leads`);
    }
  });

// --- Pipeline & Stats ---

program
  .command("pipeline")
  .description("Show lead pipeline funnel")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const pipeline = getPipeline();

    if (opts.json) {
      console.log(JSON.stringify(pipeline, null, 2));
    } else {
      console.log("Lead Pipeline:");
      for (const stage of pipeline) {
        const bar = "█".repeat(Math.max(1, Math.round(stage.pct / 5)));
        console.log(`  ${stage.status.padEnd(14)} ${String(stage.count).padStart(4)}  ${stage.pct}%  ${bar}`);
      }
    }
  });

program
  .command("stats")
  .description("Show lead statistics")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getLeadStats();

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(`Total leads: ${stats.total}`);
      console.log(`Average score: ${stats.avg_score}`);
      console.log(`Conversion rate: ${stats.conversion_rate}%`);
      console.log("\nBy status:");
      for (const [status, count] of Object.entries(stats.by_status)) {
        console.log(`  ${status}: ${count}`);
      }
      console.log("\nBy source:");
      for (const [source, count] of Object.entries(stats.by_source)) {
        console.log(`  ${source}: ${count}`);
      }
    }
  });

// --- Activity ---

program
  .command("activity")
  .description("Show activity timeline for a lead")
  .argument("<id>", "Lead ID")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const activities = opts.limit
      ? getActivities(id, parseInt(opts.limit))
      : getLeadTimeline(id);

    if (opts.json) {
      console.log(JSON.stringify(activities, null, 2));
    } else {
      if (activities.length === 0) {
        console.log("No activities found.");
        return;
      }
      for (const a of activities) {
        console.log(`  [${a.created_at}] ${a.type}: ${a.description || "(no description)"}`);
      }
    }
  });

// --- Dedup & Merge ---

program
  .command("dedup")
  .description("Find duplicate leads by email")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const pairs = deduplicateLeads();

    if (opts.json) {
      console.log(JSON.stringify(pairs, null, 2));
    } else {
      if (pairs.length === 0) {
        console.log("No duplicates found.");
        return;
      }
      console.log(`Found ${pairs.length} duplicate pair(s):`);
      for (const p of pairs) {
        console.log(`  ${p.email}: ${p.lead1.id} vs ${p.lead2.id}`);
      }
    }
  });

program
  .command("merge")
  .description("Merge two leads (keep first, merge second into it)")
  .argument("<keep-id>", "Lead ID to keep")
  .argument("<merge-id>", "Lead ID to merge and delete")
  .option("--json", "Output as JSON", false)
  .action((keepId, mergeId, opts) => {
    const result = mergeLeads(keepId, mergeId);
    if (!result) {
      console.error("One or both leads not found.");
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Merged lead ${mergeId} into ${keepId}`);
    }
  });

// --- Convert ---

program
  .command("convert")
  .description("Mark a lead as converted")
  .argument("<id>", "Lead ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const lead = updateLead(id, { status: "converted" });
    if (!lead) {
      console.error(`Lead '${id}' not found.`);
      process.exit(1);
    }
    addActivity(id, "status_change", "Lead converted");

    if (opts.json) {
      console.log(JSON.stringify(lead, null, 2));
    } else {
      console.log(`Converted: ${lead.name || lead.email || lead.id}`);
    }
  });

// --- Lists ---

const listCmd = program
  .command("list-cmd")
  .alias("lists")
  .description("Lead list management");

listCmd
  .command("create")
  .description("Create a lead list")
  .requiredOption("--name <name>", "List name")
  .option("--description <desc>", "Description")
  .option("--filter <query>", "Smart filter query (e.g. 'status=qualified AND score>=50')")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const list = createList({
      name: opts.name,
      description: opts.description,
      filter_query: opts.filter,
    });

    if (opts.json) {
      console.log(JSON.stringify(list, null, 2));
    } else {
      console.log(`Created list: ${list.name} (${list.id})`);
    }
  });

listCmd
  .command("list")
  .description("List all lead lists")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const lists = listLists();

    if (opts.json) {
      console.log(JSON.stringify(lists, null, 2));
    } else {
      if (lists.length === 0) {
        console.log("No lists found.");
        return;
      }
      for (const l of lists) {
        const filter = l.filter_query ? ` [smart: ${l.filter_query}]` : "";
        console.log(`  ${l.name}${filter} (${l.id})`);
      }
    }
  });

listCmd
  .command("members")
  .description("Show members of a list")
  .argument("<list-id>", "List ID")
  .option("--json", "Output as JSON", false)
  .action((listId, opts) => {
    const members = getListMembers(listId);

    if (opts.json) {
      console.log(JSON.stringify(members, null, 2));
    } else {
      if (members.length === 0) {
        console.log("No members in this list.");
        return;
      }
      for (const m of members) {
        console.log(`  ${m.name || "(no name)"} ${m.email ? `<${m.email}>` : ""}`);
      }
      console.log(`\n${members.length} member(s)`);
    }
  });

listCmd
  .command("add")
  .description("Add a lead to a list")
  .requiredOption("--list <id>", "List ID")
  .requiredOption("--lead <id>", "Lead ID")
  .action((opts) => {
    const added = addToList(opts.list, opts.lead);
    if (added) {
      console.log(`Added lead ${opts.lead} to list ${opts.list}`);
    } else {
      console.error("Failed to add lead to list.");
      process.exit(1);
    }
  });

listCmd
  .command("remove")
  .description("Remove a lead from a list")
  .requiredOption("--list <id>", "List ID")
  .requiredOption("--lead <id>", "Lead ID")
  .action((opts) => {
    const removed = removeFromList(opts.list, opts.lead);
    if (removed) {
      console.log(`Removed lead ${opts.lead} from list ${opts.list}`);
    } else {
      console.error("Lead not found in list.");
      process.exit(1);
    }
  });

program.parse(process.argv);
