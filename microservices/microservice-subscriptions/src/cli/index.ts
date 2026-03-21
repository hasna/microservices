#!/usr/bin/env bun

import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
  createSubscriber,
  getSubscriber,
  listSubscribers,
  cancelSubscriber,
  upgradeSubscriber,
  downgradeSubscriber,
  listEvents,
  getMrr,
  getArr,
  getChurnRate,
  listExpiring,
  getSubscriberStats,
  pauseSubscriber,
  resumeSubscriber,
  extendTrial,
  createDunning,
  listDunning,
  updateDunning,
  bulkImportSubscribers,
  exportSubscribers,
  parseImportCsv,
  getLtv,
  getNrr,
  getCohortReport,
  comparePlans,
  getExpiringRenewals,
} from "../db/subscriptions.js";

const program = new Command();

program
  .name("microservice-subscriptions")
  .description("Subscription and recurring billing management microservice")
  .version("0.0.1");

// --- Plans ---

const planCmd = program
  .command("plan")
  .description("Plan management");

planCmd
  .command("create")
  .description("Create a new plan")
  .requiredOption("--name <name>", "Plan name")
  .requiredOption("--price <price>", "Price")
  .option("--interval <interval>", "Billing interval (monthly/yearly/lifetime)", "monthly")
  .option("--features <features>", "Comma-separated features")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const plan = createPlan({
      name: opts.name,
      price: parseFloat(opts.price),
      interval: opts.interval,
      features: opts.features ? opts.features.split(",").map((f: string) => f.trim()) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.log(`Created plan: ${plan.name} — $${plan.price}/${plan.interval} (${plan.id})`);
    }
  });

planCmd
  .command("list")
  .description("List plans")
  .option("--active", "Show active plans only")
  .option("--interval <interval>", "Filter by interval")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const plans = listPlans({
      active_only: opts.active,
      interval: opts.interval,
    });

    if (opts.json) {
      console.log(JSON.stringify(plans, null, 2));
    } else {
      if (plans.length === 0) {
        console.log("No plans found.");
        return;
      }
      for (const p of plans) {
        const status = p.active ? "" : " [inactive]";
        console.log(`  ${p.name} — $${p.price}/${p.interval}${status} (${p.id})`);
      }
      console.log(`\n${plans.length} plan(s)`);
    }
  });

planCmd
  .command("get")
  .description("Get a plan by ID")
  .argument("<id>", "Plan ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const plan = getPlan(id);
    if (!plan) {
      console.error(`Plan '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.log(`${plan.name}`);
      console.log(`  Price: $${plan.price}/${plan.interval}`);
      console.log(`  Active: ${plan.active}`);
      if (plan.features.length) console.log(`  Features: ${plan.features.join(", ")}`);
    }
  });

planCmd
  .command("update")
  .description("Update a plan")
  .argument("<id>", "Plan ID")
  .option("--name <name>", "Plan name")
  .option("--price <price>", "Price")
  .option("--interval <interval>", "Billing interval")
  .option("--features <features>", "Comma-separated features")
  .option("--active <active>", "Active status (true/false)")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.price !== undefined) input.price = parseFloat(opts.price);
    if (opts.interval !== undefined) input.interval = opts.interval;
    if (opts.features !== undefined) input.features = opts.features.split(",").map((f: string) => f.trim());
    if (opts.active !== undefined) input.active = opts.active === "true";

    const plan = updatePlan(id, input);
    if (!plan) {
      console.error(`Plan '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.log(`Updated: ${plan.name} — $${plan.price}/${plan.interval}`);
    }
  });

// --- Subscribers ---

const subCmd = program
  .command("subscriber")
  .alias("sub")
  .description("Subscriber management");

subCmd
  .command("add")
  .description("Add a new subscriber")
  .requiredOption("--plan <id>", "Plan ID")
  .requiredOption("--name <name>", "Customer name")
  .requiredOption("--email <email>", "Customer email")
  .option("--status <status>", "Initial status", "active")
  .option("--trial-ends <date>", "Trial end date (YYYY-MM-DD)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const subscriber = createSubscriber({
      plan_id: opts.plan,
      customer_name: opts.name,
      customer_email: opts.email,
      status: opts.status,
      trial_ends_at: opts.trialEnds,
    });

    if (opts.json) {
      console.log(JSON.stringify(subscriber, null, 2));
    } else {
      console.log(`Added subscriber: ${subscriber.customer_name} <${subscriber.customer_email}> (${subscriber.id})`);
    }
  });

subCmd
  .command("list")
  .description("List subscribers")
  .option("--plan <id>", "Filter by plan ID")
  .option("--status <status>", "Filter by status")
  .option("--search <query>", "Search by name or email")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const subscribers = listSubscribers({
      plan_id: opts.plan,
      status: opts.status,
      search: opts.search,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(subscribers, null, 2));
    } else {
      if (subscribers.length === 0) {
        console.log("No subscribers found.");
        return;
      }
      for (const s of subscribers) {
        console.log(`  ${s.customer_name} <${s.customer_email}> — ${s.status} (${s.id})`);
      }
      console.log(`\n${subscribers.length} subscriber(s)`);
    }
  });

subCmd
  .command("get")
  .description("Get a subscriber by ID")
  .argument("<id>", "Subscriber ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const subscriber = getSubscriber(id);
    if (!subscriber) {
      console.error(`Subscriber '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(subscriber, null, 2));
    } else {
      console.log(`${subscriber.customer_name} <${subscriber.customer_email}>`);
      console.log(`  Status: ${subscriber.status}`);
      console.log(`  Plan: ${subscriber.plan_id}`);
      console.log(`  Period: ${subscriber.current_period_start} — ${subscriber.current_period_end || "N/A"}`);
      if (subscriber.canceled_at) console.log(`  Canceled: ${subscriber.canceled_at}`);
    }
  });

subCmd
  .command("cancel")
  .description("Cancel a subscription")
  .argument("<id>", "Subscriber ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const subscriber = cancelSubscriber(id);
    if (!subscriber) {
      console.error(`Subscriber '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(subscriber, null, 2));
    } else {
      console.log(`Canceled subscription for ${subscriber.customer_name}`);
    }
  });

subCmd
  .command("upgrade")
  .description("Upgrade a subscriber to a new plan")
  .argument("<id>", "Subscriber ID")
  .requiredOption("--plan <id>", "New plan ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const subscriber = upgradeSubscriber(id, opts.plan);
    if (!subscriber) {
      console.error(`Subscriber '${id}' not found or plan not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(subscriber, null, 2));
    } else {
      console.log(`Upgraded ${subscriber.customer_name} to plan ${subscriber.plan_id}`);
    }
  });

subCmd
  .command("downgrade")
  .description("Downgrade a subscriber to a new plan")
  .argument("<id>", "Subscriber ID")
  .requiredOption("--plan <id>", "New plan ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const subscriber = downgradeSubscriber(id, opts.plan);
    if (!subscriber) {
      console.error(`Subscriber '${id}' not found or plan not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(subscriber, null, 2));
    } else {
      console.log(`Downgraded ${subscriber.customer_name} to plan ${subscriber.plan_id}`);
    }
  });

// --- Pause / Resume ---

subCmd
  .command("pause")
  .description("Pause a subscription")
  .argument("<id>", "Subscriber ID")
  .option("--resume-date <date>", "Scheduled resume date (YYYY-MM-DD)")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const subscriber = pauseSubscriber(id, opts.resumeDate);
    if (!subscriber) {
      console.error(`Subscriber '${id}' not found or cannot be paused.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(subscriber, null, 2));
    } else {
      console.log(`Paused subscription for ${subscriber.customer_name}`);
      if (subscriber.resume_at) console.log(`  Scheduled resume: ${subscriber.resume_at}`);
    }
  });

subCmd
  .command("resume")
  .description("Resume a paused subscription")
  .argument("<id>", "Subscriber ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const subscriber = resumeSubscriber(id);
    if (!subscriber) {
      console.error(`Subscriber '${id}' not found or not paused.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(subscriber, null, 2));
    } else {
      console.log(`Resumed subscription for ${subscriber.customer_name}`);
    }
  });

// --- Trial Extension ---

subCmd
  .command("extend-trial")
  .description("Extend a subscriber's trial period")
  .argument("<id>", "Subscriber ID")
  .requiredOption("--days <days>", "Number of days to extend")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const subscriber = extendTrial(id, parseInt(opts.days));
    if (!subscriber) {
      console.error(`Subscriber '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(subscriber, null, 2));
    } else {
      console.log(`Extended trial for ${subscriber.customer_name} by ${opts.days} days`);
      console.log(`  New trial end: ${subscriber.trial_ends_at}`);
    }
  });

// --- Bulk Import/Export ---

subCmd
  .command("import")
  .description("Bulk import subscribers from a CSV file")
  .requiredOption("--file <path>", "Path to CSV file")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const csvContent = readFileSync(opts.file, "utf-8");
    const data = parseImportCsv(csvContent);
    const imported = bulkImportSubscribers(data);

    if (opts.json) {
      console.log(JSON.stringify({ imported: imported.length, subscribers: imported }, null, 2));
    } else {
      console.log(`Imported ${imported.length} subscriber(s) from ${opts.file}`);
      for (const s of imported) {
        console.log(`  ${s.customer_name} <${s.customer_email}> (${s.id})`);
      }
    }
  });

subCmd
  .command("export")
  .description("Export subscribers")
  .option("--format <format>", "Output format (csv/json)", "csv")
  .option("--file <path>", "Output file path (prints to stdout if omitted)")
  .action((opts) => {
    const output = exportSubscribers(opts.format as "csv" | "json");
    if (opts.file) {
      writeFileSync(opts.file, output, "utf-8");
      console.log(`Exported to ${opts.file}`);
    } else {
      console.log(output);
    }
  });

// --- Dunning ---

const dunningCmd = program
  .command("dunning")
  .description("Dunning attempt management");

dunningCmd
  .command("list")
  .description("List dunning attempts")
  .option("--subscriber <id>", "Filter by subscriber ID")
  .option("--status <status>", "Filter by status")
  .option("--limit <n>", "Limit results", "20")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const attempts = listDunning({
      subscriber_id: opts.subscriber,
      status: opts.status,
      limit: parseInt(opts.limit),
    });

    if (opts.json) {
      console.log(JSON.stringify(attempts, null, 2));
    } else {
      if (attempts.length === 0) {
        console.log("No dunning attempts found.");
        return;
      }
      for (const a of attempts) {
        console.log(`  [${a.created_at}] #${a.attempt_number} ${a.status} — subscriber: ${a.subscriber_id}`);
        if (a.next_retry_at) console.log(`    Next retry: ${a.next_retry_at}`);
      }
      console.log(`\n${attempts.length} attempt(s)`);
    }
  });

dunningCmd
  .command("create")
  .description("Create a dunning attempt")
  .requiredOption("--subscriber <id>", "Subscriber ID")
  .option("--attempt <n>", "Attempt number", "1")
  .option("--status <status>", "Status", "pending")
  .option("--next-retry <date>", "Next retry date")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const attempt = createDunning({
      subscriber_id: opts.subscriber,
      attempt_number: parseInt(opts.attempt),
      status: opts.status,
      next_retry_at: opts.nextRetry,
    });

    if (opts.json) {
      console.log(JSON.stringify(attempt, null, 2));
    } else {
      console.log(`Created dunning attempt #${attempt.attempt_number} for subscriber ${attempt.subscriber_id}`);
    }
  });

dunningCmd
  .command("update")
  .description("Update a dunning attempt")
  .argument("<id>", "Dunning attempt ID")
  .option("--status <status>", "New status")
  .option("--next-retry <date>", "Next retry date")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.status) input.status = opts.status;
    if (opts.nextRetry !== undefined) input.next_retry_at = opts.nextRetry;

    const attempt = updateDunning(id, input);
    if (!attempt) {
      console.error(`Dunning attempt '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(attempt, null, 2));
    } else {
      console.log(`Updated dunning attempt ${attempt.id} — status: ${attempt.status}`);
    }
  });

// --- Analytics ---

program
  .command("ltv")
  .description("Show lifetime value per subscriber and average")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const result = getLtv();

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.subscribers.length === 0) {
        console.log("No subscribers found.");
        return;
      }
      console.log("Lifetime Value Report:");
      for (const s of result.subscribers) {
        console.log(`  ${s.customer_name} <${s.customer_email}> — $${s.ltv.toFixed(2)} (${s.months_active}mo on ${s.plan_name})`);
      }
      console.log(`\nAverage LTV: $${result.average_ltv.toFixed(2)}`);
    }
  });

program
  .command("nrr")
  .description("Calculate net revenue retention for a month")
  .requiredOption("--month <month>", "Month in YYYY-MM format")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const result = getNrr(opts.month);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`NRR for ${result.month}:`);
      console.log(`  Start MRR: $${result.start_mrr.toFixed(2)}`);
      console.log(`  Expansion: +$${result.expansion.toFixed(2)}`);
      console.log(`  Contraction: -$${result.contraction.toFixed(2)}`);
      console.log(`  Churn: -$${result.churn.toFixed(2)}`);
      console.log(`  NRR: ${result.nrr.toFixed(2)}%`);
    }
  });

program
  .command("cohort-report")
  .description("Show cohort retention analysis")
  .option("--months <n>", "Number of months to analyze", "6")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const report = getCohortReport(parseInt(opts.months));

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      if (report.length === 0) {
        console.log("No cohort data available.");
        return;
      }
      console.log("Cohort Retention Report:");
      console.log("  Cohort     | Total | Retained | Retention");
      console.log("  -----------|-------|----------|----------");
      for (const c of report) {
        console.log(`  ${c.cohort}   | ${String(c.total).padStart(5)} | ${String(c.retained).padStart(8)} | ${c.retention_rate.toFixed(1)}%`);
      }
    }
  });

planCmd
  .command("compare")
  .description("Compare two plans side by side")
  .argument("<id1>", "First plan ID")
  .argument("<id2>", "Second plan ID")
  .option("--json", "Output as JSON", false)
  .action((id1, id2, opts) => {
    const result = comparePlans(id1, id2);
    if (!result) {
      console.error("One or both plans not found.");
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Plan Comparison:`);
      console.log(`  ${result.plan1.name} vs ${result.plan2.name}`);
      console.log(`  Price: $${result.plan1.price}/${result.plan1.interval} vs $${result.plan2.price}/${result.plan2.interval}`);
      console.log(`  Price diff: $${result.price_diff} (${result.price_diff_pct > 0 ? "+" : ""}${result.price_diff_pct}%)`);
      console.log(`  Interval match: ${result.interval_match ? "Yes" : "No"}`);
      if (result.common_features.length) console.log(`  Common features: ${result.common_features.join(", ")}`);
      if (result.features_only_in_plan1.length) console.log(`  Only in ${result.plan1.name}: ${result.features_only_in_plan1.join(", ")}`);
      if (result.features_only_in_plan2.length) console.log(`  Only in ${result.plan2.name}: ${result.features_only_in_plan2.join(", ")}`);
    }
  });

program
  .command("expiring-renewals")
  .description("List subscribers with renewals expiring soon")
  .option("--days <days>", "Days ahead to check", "7")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const expiring = getExpiringRenewals(parseInt(opts.days));

    if (opts.json) {
      console.log(JSON.stringify(expiring, null, 2));
    } else {
      if (expiring.length === 0) {
        console.log(`No renewals expiring in the next ${opts.days} days.`);
        return;
      }
      for (const s of expiring) {
        console.log(`  ${s.customer_name} <${s.customer_email}> — renews ${s.current_period_end}`);
      }
      console.log(`\n${expiring.length} upcoming renewal(s)`);
    }
  });

program
  .command("mrr")
  .description("Get monthly recurring revenue")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const mrr = getMrr();
    if (opts.json) {
      console.log(JSON.stringify({ mrr }));
    } else {
      console.log(`MRR: $${mrr.toFixed(2)}`);
    }
  });

program
  .command("arr")
  .description("Get annual recurring revenue")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const arr = getArr();
    if (opts.json) {
      console.log(JSON.stringify({ arr }));
    } else {
      console.log(`ARR: $${arr.toFixed(2)}`);
    }
  });

program
  .command("churn")
  .description("Get churn rate")
  .option("--period <days>", "Period in days", "30")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const rate = getChurnRate(parseInt(opts.period));
    if (opts.json) {
      console.log(JSON.stringify({ churn_rate: rate, period_days: parseInt(opts.period) }));
    } else {
      console.log(`Churn rate (${opts.period}d): ${rate}%`);
    }
  });

program
  .command("events")
  .description("List subscription events")
  .option("--subscriber <id>", "Filter by subscriber ID")
  .option("--type <type>", "Filter by event type")
  .option("--limit <n>", "Limit results", "20")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const events = listEvents({
      subscriber_id: opts.subscriber,
      type: opts.type,
      limit: parseInt(opts.limit),
    });

    if (opts.json) {
      console.log(JSON.stringify(events, null, 2));
    } else {
      if (events.length === 0) {
        console.log("No events found.");
        return;
      }
      for (const e of events) {
        console.log(`  [${e.occurred_at}] ${e.type} — subscriber: ${e.subscriber_id}`);
      }
      console.log(`\n${events.length} event(s)`);
    }
  });

program
  .command("expiring")
  .description("List subscriptions expiring soon")
  .option("--days <days>", "Days ahead to check", "7")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const expiring = listExpiring(parseInt(opts.days));

    if (opts.json) {
      console.log(JSON.stringify(expiring, null, 2));
    } else {
      if (expiring.length === 0) {
        console.log(`No subscriptions expiring in the next ${opts.days} days.`);
        return;
      }
      for (const s of expiring) {
        console.log(`  ${s.customer_name} <${s.customer_email}> — expires ${s.current_period_end}`);
      }
      console.log(`\n${expiring.length} expiring subscription(s)`);
    }
  });

program
  .command("stats")
  .description("Get subscriber statistics")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getSubscriberStats();
    const mrr = getMrr();
    const arr = getArr();

    if (opts.json) {
      console.log(JSON.stringify({ ...stats, mrr, arr }, null, 2));
    } else {
      console.log("Subscriber Statistics:");
      console.log(`  Total: ${stats.total}`);
      console.log(`  Active: ${stats.active}`);
      console.log(`  Trialing: ${stats.trialing}`);
      console.log(`  Past Due: ${stats.past_due}`);
      console.log(`  Canceled: ${stats.canceled}`);
      console.log(`  Expired: ${stats.expired}`);
      console.log(`  MRR: $${mrr.toFixed(2)}`);
      console.log(`  ARR: $${arr.toFixed(2)}`);
    }
  });

program.parse(process.argv);
