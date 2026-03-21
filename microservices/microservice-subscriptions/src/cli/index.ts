#!/usr/bin/env bun

import { Command } from "commander";
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

// --- Analytics ---

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
