#!/usr/bin/env bun

import { Command } from "commander";
import {
  createPipeline,
  listPipelines,
  createStage,
  listStages,
  createDeal,
  getDeal,
  listDeals,
  updateDeal,
  moveDeal,
  closeDeal,
  deleteDeal,
  addActivity,
  listActivities,
  getPipelineSummary,
} from "../db/pipeline.js";

const program = new Command();

program
  .name("microservice-crm")
  .description("CRM pipeline management microservice")
  .version("0.0.1");

// --- Pipelines ---

const pipelineCmd = program
  .command("pipeline")
  .description("Pipeline management");

pipelineCmd
  .command("create")
  .description("Create a new pipeline")
  .requiredOption("--name <name>", "Pipeline name")
  .option("--description <text>", "Pipeline description")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const pipeline = createPipeline({
      name: opts.name,
      description: opts.description,
    });

    if (opts.json) {
      console.log(JSON.stringify(pipeline, null, 2));
    } else {
      console.log(`Created pipeline: ${pipeline.name} (${pipeline.id})`);
    }
  });

pipelineCmd
  .command("list")
  .description("List all pipelines")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const pipelines = listPipelines();

    if (opts.json) {
      console.log(JSON.stringify(pipelines, null, 2));
    } else {
      if (pipelines.length === 0) {
        console.log("No pipelines found.");
        return;
      }
      for (const p of pipelines) {
        const desc = p.description ? ` — ${p.description}` : "";
        console.log(`  ${p.name}${desc} (${p.id})`);
      }
      console.log(`\n${pipelines.length} pipeline(s)`);
    }
  });

pipelineCmd
  .command("summary")
  .description("Show pipeline summary with deals per stage")
  .argument("<id>", "Pipeline ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const summary = getPipelineSummary(id);
    if (!summary) {
      console.error(`Pipeline '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`\n  Pipeline: ${summary.pipeline_name}`);
      console.log(`  Total deals:    ${summary.total_deals}`);
      console.log(`  Open:           ${summary.open_deals}`);
      console.log(`  Won:            ${summary.won_deals}`);
      console.log(`  Lost:           ${summary.lost_deals}`);
      console.log(`  Total value:    $${summary.total_value.toFixed(2)}`);
      console.log(`  Weighted value: $${summary.weighted_value.toFixed(2)}`);
      if (summary.stages.length > 0) {
        console.log(`  Stages:`);
        for (const s of summary.stages) {
          console.log(`    ${s.stage_name}: ${s.deal_count} deal(s), $${s.total_value.toFixed(2)}`);
        }
      }
      console.log();
    }
  });

// --- Stages ---

const stageCmd = program
  .command("stage")
  .description("Stage management");

stageCmd
  .command("create")
  .description("Create a stage in a pipeline")
  .requiredOption("--pipeline <id>", "Pipeline ID")
  .requiredOption("--name <name>", "Stage name")
  .option("--sort-order <n>", "Sort order")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stage = createStage({
      pipeline_id: opts.pipeline,
      name: opts.name,
      sort_order: opts.sortOrder !== undefined ? parseInt(opts.sortOrder) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(stage, null, 2));
    } else {
      console.log(`Created stage: ${stage.name} (${stage.id}) [order: ${stage.sort_order}]`);
    }
  });

stageCmd
  .command("list")
  .description("List stages in a pipeline")
  .argument("<pipeline-id>", "Pipeline ID")
  .option("--json", "Output as JSON", false)
  .action((pipelineId, opts) => {
    const stages = listStages(pipelineId);

    if (opts.json) {
      console.log(JSON.stringify(stages, null, 2));
    } else {
      if (stages.length === 0) {
        console.log("No stages found.");
        return;
      }
      for (const s of stages) {
        console.log(`  [${s.sort_order}] ${s.name} (${s.id})`);
      }
      console.log(`\n${stages.length} stage(s)`);
    }
  });

// --- Deals ---

program
  .command("create")
  .description("Create a new deal")
  .requiredOption("--pipeline <id>", "Pipeline ID")
  .requiredOption("--stage <id>", "Stage ID")
  .requiredOption("--title <title>", "Deal title")
  .option("--value <amount>", "Deal value", "0")
  .option("--currency <code>", "Currency code", "USD")
  .option("--contact-name <name>", "Contact name")
  .option("--contact-email <email>", "Contact email")
  .option("--probability <pct>", "Win probability (0-100)", "0")
  .option("--close-date <date>", "Expected close date (YYYY-MM-DD)")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const deal = createDeal({
      pipeline_id: opts.pipeline,
      stage_id: opts.stage,
      title: opts.title,
      value: parseFloat(opts.value),
      currency: opts.currency,
      contact_name: opts.contactName,
      contact_email: opts.contactEmail,
      probability: parseInt(opts.probability),
      expected_close_date: opts.closeDate,
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(deal, null, 2));
    } else {
      console.log(`Created deal: ${deal.title} — $${deal.value.toFixed(2)} (${deal.id})`);
    }
  });

program
  .command("get")
  .description("Get a deal by ID")
  .argument("<id>", "Deal ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const deal = getDeal(id);
    if (!deal) {
      console.error(`Deal '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(deal, null, 2));
    } else {
      console.log(`Deal: ${deal.title}`);
      console.log(`  Status:      ${deal.status}`);
      console.log(`  Value:       ${deal.currency} ${deal.value.toFixed(2)}`);
      console.log(`  Probability: ${deal.probability}%`);
      if (deal.contact_name) console.log(`  Contact:     ${deal.contact_name}`);
      if (deal.contact_email) console.log(`  Email:       ${deal.contact_email}`);
      if (deal.expected_close_date) console.log(`  Close date:  ${deal.expected_close_date}`);
      if (deal.notes) console.log(`  Notes:       ${deal.notes}`);
      if (deal.closed_at) console.log(`  Closed at:   ${deal.closed_at}`);
    }
  });

program
  .command("list")
  .description("List deals")
  .option("--pipeline <id>", "Filter by pipeline")
  .option("--stage <id>", "Filter by stage")
  .option("--status <status>", "Filter by status: open|won|lost")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const deals = listDeals({
      pipeline_id: opts.pipeline,
      stage_id: opts.stage,
      status: opts.status,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(deals, null, 2));
    } else {
      if (deals.length === 0) {
        console.log("No deals found.");
        return;
      }
      for (const d of deals) {
        const status = d.status.toUpperCase().padEnd(5);
        console.log(`  ${status}  ${d.title}  ${d.currency} ${d.value.toFixed(2)}  ${d.probability}%`);
      }
      console.log(`\n${deals.length} deal(s)`);
    }
  });

program
  .command("update")
  .description("Update a deal")
  .argument("<id>", "Deal ID")
  .option("--title <title>", "Deal title")
  .option("--value <amount>", "Deal value")
  .option("--currency <code>", "Currency code")
  .option("--contact-name <name>", "Contact name")
  .option("--contact-email <email>", "Contact email")
  .option("--probability <pct>", "Win probability (0-100)")
  .option("--close-date <date>", "Expected close date")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.title !== undefined) input.title = opts.title;
    if (opts.value !== undefined) input.value = parseFloat(opts.value);
    if (opts.currency !== undefined) input.currency = opts.currency;
    if (opts.contactName !== undefined) input.contact_name = opts.contactName;
    if (opts.contactEmail !== undefined) input.contact_email = opts.contactEmail;
    if (opts.probability !== undefined) input.probability = parseInt(opts.probability);
    if (opts.closeDate !== undefined) input.expected_close_date = opts.closeDate;
    if (opts.notes !== undefined) input.notes = opts.notes;

    const deal = updateDeal(id, input);
    if (!deal) {
      console.error(`Deal '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(deal, null, 2));
    } else {
      console.log(`Updated: ${deal.title} — ${deal.currency} ${deal.value.toFixed(2)}`);
    }
  });

program
  .command("move")
  .description("Move a deal to a different stage")
  .argument("<id>", "Deal ID")
  .requiredOption("--stage <id>", "Target stage ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const deal = moveDeal(id, opts.stage);
    if (!deal) {
      console.error(`Deal '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(deal, null, 2));
    } else {
      console.log(`Moved deal '${deal.title}' to stage ${deal.stage_id}`);
    }
  });

program
  .command("close")
  .description("Close a deal as won or lost")
  .argument("<id>", "Deal ID")
  .argument("<outcome>", "Outcome: won|lost")
  .option("--json", "Output as JSON", false)
  .action((id, outcome, opts) => {
    if (outcome !== "won" && outcome !== "lost") {
      console.error("Outcome must be 'won' or 'lost'.");
      process.exit(1);
    }

    const deal = closeDeal(id, outcome);
    if (!deal) {
      console.error(`Deal '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(deal, null, 2));
    } else {
      console.log(`Deal '${deal.title}' closed as ${outcome}.`);
    }
  });

program
  .command("delete")
  .description("Delete a deal")
  .argument("<id>", "Deal ID")
  .action((id) => {
    const deleted = deleteDeal(id);
    if (deleted) {
      console.log(`Deleted deal ${id}`);
    } else {
      console.error(`Deal '${id}' not found.`);
      process.exit(1);
    }
  });

// --- Activities ---

const activityCmd = program
  .command("activity")
  .description("Deal activity management");

activityCmd
  .command("add")
  .description("Add an activity to a deal")
  .requiredOption("--deal <id>", "Deal ID")
  .requiredOption("--description <text>", "Activity description")
  .option("--type <type>", "Activity type: note|call|email|meeting", "note")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const activity = addActivity({
      deal_id: opts.deal,
      type: opts.type,
      description: opts.description,
    });

    if (opts.json) {
      console.log(JSON.stringify(activity, null, 2));
    } else {
      console.log(`Added ${activity.type}: ${activity.description} (${activity.id})`);
    }
  });

activityCmd
  .command("list")
  .description("List activities for a deal")
  .argument("<deal-id>", "Deal ID")
  .option("--json", "Output as JSON", false)
  .action((dealId, opts) => {
    const activities = listActivities(dealId);

    if (opts.json) {
      console.log(JSON.stringify(activities, null, 2));
    } else {
      if (activities.length === 0) {
        console.log("No activities found.");
        return;
      }
      for (const a of activities) {
        console.log(`  [${a.type}] ${a.description} (${a.created_at})`);
      }
      console.log(`\n${activities.length} activity(ies)`);
    }
  });

program.parse(process.argv);
