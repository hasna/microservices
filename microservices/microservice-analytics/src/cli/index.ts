#!/usr/bin/env bun

import { Command } from "commander";
import {
  recordKpi,
  getKpi,
  getKpiTrend,
  listKpis,
  getLatestKpis,
  createDashboard,
  getDashboard,
  listDashboards,
  updateDashboard,
  deleteDashboard,
  generateReport,
  getReport,
  listReports,
  getBusinessHealth,
  generateExecutiveSummary,
} from "../db/analytics.js";

const program = new Command();

program
  .name("microservice-analytics")
  .description("Business analytics microservice")
  .version("0.0.1");

// --- KPIs ---

const kpiCmd = program
  .command("kpi")
  .description("KPI management");

kpiCmd
  .command("record")
  .description("Record a KPI value")
  .requiredOption("--name <name>", "KPI name")
  .requiredOption("--value <value>", "KPI value")
  .option("--category <category>", "Category")
  .option("--source <service>", "Source service")
  .option("--period <period>", "Period (e.g. 2024-Q1)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const kpi = recordKpi({
      name: opts.name,
      value: parseFloat(opts.value),
      category: opts.category,
      source_service: opts.source,
      period: opts.period,
    });

    if (opts.json) {
      console.log(JSON.stringify(kpi, null, 2));
    } else {
      console.log(`Recorded KPI: ${kpi.name} = ${kpi.value} (${kpi.id})`);
    }
  });

kpiCmd
  .command("get")
  .description("Get the latest value for a KPI")
  .argument("<name>", "KPI name")
  .option("--period <period>", "Filter by period")
  .option("--json", "Output as JSON", false)
  .action((name, opts) => {
    const kpi = getKpi(name, opts.period);
    if (!kpi) {
      console.error(`KPI '${name}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(kpi, null, 2));
    } else {
      console.log(`${kpi.name}: ${kpi.value}`);
      if (kpi.category) console.log(`  Category: ${kpi.category}`);
      if (kpi.period) console.log(`  Period: ${kpi.period}`);
      if (kpi.source_service) console.log(`  Source: ${kpi.source_service}`);
      console.log(`  Recorded: ${kpi.recorded_at}`);
    }
  });

kpiCmd
  .command("trend")
  .description("Get KPI trend over time")
  .argument("<name>", "KPI name")
  .option("--days <n>", "Number of days to look back", "30")
  .option("--json", "Output as JSON", false)
  .action((name, opts) => {
    const trend = getKpiTrend(name, parseInt(opts.days));

    if (opts.json) {
      console.log(JSON.stringify(trend, null, 2));
    } else {
      if (trend.length === 0) {
        console.log(`No trend data for '${name}' in the last ${opts.days} days.`);
        return;
      }
      console.log(`Trend for ${name} (last ${opts.days} days):`);
      for (const kpi of trend) {
        console.log(`  ${kpi.recorded_at}: ${kpi.value}`);
      }
    }
  });

kpiCmd
  .command("list")
  .description("List KPIs")
  .option("--category <category>", "Filter by category")
  .option("--source <service>", "Filter by source service")
  .option("--limit <n>", "Limit results")
  .option("--latest", "Show only latest value per KPI", false)
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const kpis = opts.latest
      ? getLatestKpis()
      : listKpis({
          category: opts.category,
          source_service: opts.source,
          limit: opts.limit ? parseInt(opts.limit) : undefined,
        });

    if (opts.json) {
      console.log(JSON.stringify(kpis, null, 2));
    } else {
      if (kpis.length === 0) {
        console.log("No KPIs found.");
        return;
      }
      for (const kpi of kpis) {
        const cat = kpi.category ? ` [${kpi.category}]` : "";
        console.log(`  ${kpi.name}: ${kpi.value}${cat}`);
      }
      console.log(`\n${kpis.length} KPI(s)`);
    }
  });

// --- Dashboards ---

const dashCmd = program
  .command("dashboard")
  .description("Dashboard management");

dashCmd
  .command("create")
  .description("Create a dashboard")
  .requiredOption("--name <name>", "Dashboard name")
  .option("--description <desc>", "Description")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const dashboard = createDashboard({
      name: opts.name,
      description: opts.description,
    });

    if (opts.json) {
      console.log(JSON.stringify(dashboard, null, 2));
    } else {
      console.log(`Created dashboard: ${dashboard.name} (${dashboard.id})`);
    }
  });

dashCmd
  .command("list")
  .description("List dashboards")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const dashboards = listDashboards();

    if (opts.json) {
      console.log(JSON.stringify(dashboards, null, 2));
    } else {
      if (dashboards.length === 0) {
        console.log("No dashboards found.");
        return;
      }
      for (const d of dashboards) {
        const desc = d.description ? ` — ${d.description}` : "";
        console.log(`  ${d.name}${desc} (${d.widgets.length} widgets)`);
      }
      console.log(`\n${dashboards.length} dashboard(s)`);
    }
  });

dashCmd
  .command("get")
  .description("Get a dashboard")
  .argument("<id>", "Dashboard ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const dashboard = getDashboard(id);
    if (!dashboard) {
      console.error(`Dashboard '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(dashboard, null, 2));
    } else {
      console.log(`${dashboard.name}`);
      if (dashboard.description) console.log(`  Description: ${dashboard.description}`);
      console.log(`  Widgets: ${dashboard.widgets.length}`);
      console.log(`  Created: ${dashboard.created_at}`);
    }
  });

dashCmd
  .command("update")
  .description("Update a dashboard")
  .argument("<id>", "Dashboard ID")
  .option("--name <name>", "Name")
  .option("--description <desc>", "Description")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.description !== undefined) input.description = opts.description;

    const dashboard = updateDashboard(id, input);
    if (!dashboard) {
      console.error(`Dashboard '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(dashboard, null, 2));
    } else {
      console.log(`Updated: ${dashboard.name}`);
    }
  });

dashCmd
  .command("delete")
  .description("Delete a dashboard")
  .argument("<id>", "Dashboard ID")
  .action((id) => {
    const deleted = deleteDashboard(id);
    if (deleted) {
      console.log(`Deleted dashboard ${id}`);
    } else {
      console.error(`Dashboard '${id}' not found.`);
      process.exit(1);
    }
  });

// --- Reports ---

const reportCmd = program
  .command("report")
  .description("Report management");

reportCmd
  .command("generate")
  .description("Generate a report")
  .requiredOption("--name <name>", "Report name")
  .requiredOption("--type <type>", "Report type (daily|weekly|monthly|quarterly|annual|custom)")
  .option("--period <period>", "Period (e.g. 2024-Q1)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const report = generateReport({
      name: opts.name,
      type: opts.type,
      period: opts.period,
    });

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Generated report: ${report.name} (${report.id})`);
      console.log(`Type: ${report.type}`);
      if (report.period) console.log(`Period: ${report.period}`);
      console.log(`\n${report.content}`);
    }
  });

reportCmd
  .command("list")
  .description("List reports")
  .option("--type <type>", "Filter by type")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const reports = listReports({
      type: opts.type,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(reports, null, 2));
    } else {
      if (reports.length === 0) {
        console.log("No reports found.");
        return;
      }
      for (const r of reports) {
        const period = r.period ? ` (${r.period})` : "";
        console.log(`  [${r.type}] ${r.name}${period} — ${r.generated_at}`);
      }
      console.log(`\n${reports.length} report(s)`);
    }
  });

reportCmd
  .command("get")
  .description("Get a report")
  .argument("<id>", "Report ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const report = getReport(id);
    if (!report) {
      console.error(`Report '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`${report.name} [${report.type}]`);
      if (report.period) console.log(`Period: ${report.period}`);
      console.log(`Generated: ${report.generated_at}`);
      console.log(`\n${report.content}`);
    }
  });

// --- Health & Summary ---

program
  .command("health")
  .description("Get overall business health summary")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const health = getBusinessHealth();

    if (opts.json) {
      console.log(JSON.stringify(health, null, 2));
    } else {
      console.log("=== Business Health ===");
      console.log(`  Unique KPIs: ${health.total_kpis}`);
      console.log(`  Reports: ${health.report_count}`);
      console.log(`  Dashboards: ${health.dashboard_count}`);

      if (health.categories.length > 0) {
        console.log("\n  Categories:");
        for (const cat of health.categories) {
          console.log(`    ${cat.category}: ${cat.count} KPI(s), latest value: ${cat.latest_value}`);
        }
      }

      if (health.latest_kpis.length > 0) {
        console.log("\n  Latest KPIs:");
        for (const kpi of health.latest_kpis) {
          console.log(`    ${kpi.name}: ${kpi.value}`);
        }
      }
    }
  });

program
  .command("summary")
  .description("Generate an AI-powered executive summary")
  .option("--json", "Output as JSON", false)
  .action(async (opts) => {
    const summary = await generateExecutiveSummary();

    if (opts.json) {
      console.log(JSON.stringify({ summary }, null, 2));
    } else {
      console.log(summary);
    }
  });

program.parse(process.argv);
