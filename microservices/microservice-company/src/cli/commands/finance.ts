import { Command } from "commander";
import {
  generatePnl,
  createPeriod,
  closePeriod,
  listPeriods,
  generateCashflow,
  setBudget,
  getBudgetVsActual,
  listBudgets,
} from "../../lib/finance.js";

export function registerFinanceCommands(program: Command): void {
  // ─── P&L ──────────────────────────────────────────────────────────────────

  program
    .command("pnl")
    .description("Generate a Profit & Loss report")
    .requiredOption("--org <id>", "Organization ID")
    .requiredOption("--from <date>", "Start date (YYYY-MM-DD)")
    .requiredOption("--to <date>", "End date (YYYY-MM-DD)")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const report = generatePnl(opts.org, opts.from, opts.to);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`P&L Report (${opts.from} to ${opts.to})`);
        console.log(`  Revenue:    ${report.revenue.toFixed(2)}`);
        console.log(`  Expenses:   ${report.expenses.toFixed(2)}`);
        console.log(`  Net Income: ${report.net_income.toFixed(2)}`);
        const services = Object.keys(report.breakdown_by_service);
        if (services.length > 0) {
          console.log("  Breakdown:");
          for (const svc of services) {
            const b = report.breakdown_by_service[svc];
            console.log(`    ${svc}: rev=${b.revenue.toFixed(2)} exp=${b.expenses.toFixed(2)}`);
          }
        }
      }
    });

  // ─── Cashflow ─────────────────────────────────────────────────────────────

  program
    .command("cashflow")
    .description("Generate a cashflow report")
    .requiredOption("--org <id>", "Organization ID")
    .requiredOption("--from <date>", "Start date (YYYY-MM-DD)")
    .requiredOption("--to <date>", "End date (YYYY-MM-DD)")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const report = generateCashflow(opts.org, opts.from, opts.to);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`Cashflow Report (${opts.from} to ${opts.to})`);
        console.log(`  Cash In:      ${report.cash_in.toFixed(2)}`);
        console.log(`  Cash Out:     ${report.cash_out.toFixed(2)}`);
        console.log(`  Net Cashflow: ${report.net_cashflow.toFixed(2)}`);
      }
    });

  // ─── Financial Periods ────────────────────────────────────────────────────

  const periodCmd = program.command("period").description("Financial period management");

  periodCmd
    .command("create")
    .description("Create a financial period")
    .requiredOption("--org <id>", "Organization ID")
    .requiredOption("--name <name>", "Period name")
    .requiredOption("--type <type>", "Period type (month/quarter/year)")
    .requiredOption("--from <date>", "Start date (YYYY-MM-DD)")
    .requiredOption("--to <date>", "End date (YYYY-MM-DD)")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const period = createPeriod(opts.org, opts.name, opts.type, opts.from, opts.to);

      if (opts.json) {
        console.log(JSON.stringify(period, null, 2));
      } else {
        console.log(`Created period: ${period.name} (${period.id})`);
      }
    });

  periodCmd
    .command("list")
    .description("List financial periods")
    .requiredOption("--org <id>", "Organization ID")
    .option("--type <type>", "Filter by type (month/quarter/year)")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const periods = listPeriods(opts.org, opts.type);

      if (opts.json) {
        console.log(JSON.stringify(periods, null, 2));
      } else {
        if (periods.length === 0) {
          console.log("No financial periods found.");
          return;
        }
        for (const p of periods) {
          console.log(`  ${p.name} [${p.type}] ${p.status} (${p.start_date} to ${p.end_date})`);
        }
        console.log(`\n${periods.length} period(s)`);
      }
    });

  periodCmd
    .command("close")
    .description("Close a financial period with final figures")
    .argument("<id>", "Period ID")
    .requiredOption("--revenue <amount>", "Total revenue")
    .requiredOption("--expenses <amount>", "Total expenses")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const period = closePeriod(id, parseFloat(opts.revenue), parseFloat(opts.expenses));
      if (!period) {
        console.error(`Period '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(period, null, 2));
      } else {
        console.log(`Closed period: ${period.name}`);
        console.log(`  Revenue:    ${period.revenue.toFixed(2)}`);
        console.log(`  Expenses:   ${period.expenses.toFixed(2)}`);
        console.log(`  Net Income: ${period.net_income.toFixed(2)}`);
      }
    });

  // ─── Budgets ──────────────────────────────────────────────────────────────

  const budgetCmd = program.command("budget").description("Budget management");

  budgetCmd
    .command("set")
    .description("Set a department budget")
    .requiredOption("--org <id>", "Organization ID")
    .requiredOption("--department <dept>", "Department name")
    .requiredOption("--amount <amount>", "Monthly budget amount")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const budget = setBudget(opts.org, opts.department, parseFloat(opts.amount));

      if (opts.json) {
        console.log(JSON.stringify(budget, null, 2));
      } else {
        console.log(`Budget set: ${budget.department} = ${budget.monthly_amount}/month`);
      }
    });

  budgetCmd
    .command("list")
    .description("List all budgets")
    .requiredOption("--org <id>", "Organization ID")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const budgets = listBudgets(opts.org);

      if (opts.json) {
        console.log(JSON.stringify(budgets, null, 2));
      } else {
        if (budgets.length === 0) {
          console.log("No budgets found.");
          return;
        }
        for (const b of budgets) {
          console.log(`  ${b.department}: ${b.monthly_amount}/month (${b.currency})`);
        }
        console.log(`\n${budgets.length} budget(s)`);
      }
    });

  budgetCmd
    .command("check")
    .description("Check budget vs actual spending")
    .requiredOption("--org <id>", "Organization ID")
    .requiredOption("--department <dept>", "Department name")
    .requiredOption("--month <month>", "Month (YYYY-MM)")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const result = getBudgetVsActual(opts.org, opts.department, opts.month);
      if (!result) {
        console.error(`No budget found for department '${opts.department}'.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Budget vs Actual: ${result.department} (${opts.month})`);
        console.log(`  Budget:   ${result.budget.toFixed(2)}`);
        console.log(`  Actual:   ${result.actual.toFixed(2)}`);
        console.log(`  Variance: ${result.variance.toFixed(2)} (${result.variance_pct}%)`);
      }
    });
}
