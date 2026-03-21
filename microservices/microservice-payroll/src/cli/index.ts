#!/usr/bin/env bun

import { Command } from "commander";
import {
  createEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
  terminateEmployee,
  createPayPeriod,
  listPayPeriods,
  getPayPeriod,
  processPayroll,
  listPayStubs,
  getPayStub,
  getPayrollReport,
  getYtdReport,
  getTaxSummary,
  createBenefit,
  listBenefits,
  removeBenefit,
  generateAchFile,
  generateW2,
  generate1099,
  setSchedule,
  getNextPayPeriod,
  auditPayroll,
  forecastPayroll,
  checkOvertime,
} from "../db/payroll.js";

const program = new Command();

program
  .name("microservice-payroll")
  .description("Payroll management microservice")
  .version("0.0.1");

// --- Employees ---

const employeeCmd = program
  .command("employee")
  .description("Employee management");

employeeCmd
  .command("add")
  .description("Add a new employee")
  .requiredOption("--name <name>", "Full name")
  .requiredOption("--pay-rate <rate>", "Pay rate (annual salary or hourly rate)")
  .option("--email <email>", "Email address")
  .option("--type <type>", "Type: employee or contractor", "employee")
  .option("--department <dept>", "Department")
  .option("--title <title>", "Job title")
  .option("--pay-type <type>", "Pay type: salary or hourly", "salary")
  .option("--currency <currency>", "Currency code", "USD")
  .option("--start-date <date>", "Start date (YYYY-MM-DD)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const employee = createEmployee({
      name: opts.name,
      email: opts.email,
      type: opts.type,
      department: opts.department,
      title: opts.title,
      pay_rate: parseFloat(opts.payRate),
      pay_type: opts.payType,
      currency: opts.currency,
      start_date: opts.startDate,
    });

    if (opts.json) {
      console.log(JSON.stringify(employee, null, 2));
    } else {
      console.log(`Created employee: ${employee.name} (${employee.id})`);
    }
  });

employeeCmd
  .command("list")
  .description("List employees")
  .option("--status <status>", "Filter by status: active or terminated")
  .option("--department <dept>", "Filter by department")
  .option("--type <type>", "Filter by type: employee or contractor")
  .option("--search <query>", "Search by name, email, or department")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const employees = listEmployees({
      status: opts.status,
      department: opts.department,
      type: opts.type,
      search: opts.search,
    });

    if (opts.json) {
      console.log(JSON.stringify(employees, null, 2));
    } else {
      if (employees.length === 0) {
        console.log("No employees found.");
        return;
      }
      for (const e of employees) {
        const dept = e.department ? ` (${e.department})` : "";
        const status = e.status === "terminated" ? " [TERMINATED]" : "";
        console.log(`  ${e.name}${dept} — ${e.pay_type} $${e.pay_rate}${status}`);
      }
      console.log(`\n${employees.length} employee(s)`);
    }
  });

employeeCmd
  .command("get")
  .description("Get an employee by ID")
  .argument("<id>", "Employee ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const employee = getEmployee(id);
    if (!employee) {
      console.error(`Employee '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(employee, null, 2));
    } else {
      console.log(`${employee.name}`);
      if (employee.email) console.log(`  Email: ${employee.email}`);
      console.log(`  Type: ${employee.type}`);
      console.log(`  Status: ${employee.status}`);
      if (employee.department) console.log(`  Department: ${employee.department}`);
      if (employee.title) console.log(`  Title: ${employee.title}`);
      console.log(`  Pay: ${employee.pay_type} $${employee.pay_rate} ${employee.currency}`);
    }
  });

employeeCmd
  .command("update")
  .description("Update an employee")
  .argument("<id>", "Employee ID")
  .option("--name <name>", "Full name")
  .option("--email <email>", "Email")
  .option("--department <dept>", "Department")
  .option("--title <title>", "Job title")
  .option("--pay-rate <rate>", "Pay rate")
  .option("--pay-type <type>", "Pay type")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.email !== undefined) input.email = opts.email;
    if (opts.department !== undefined) input.department = opts.department;
    if (opts.title !== undefined) input.title = opts.title;
    if (opts.payRate !== undefined) input.pay_rate = parseFloat(opts.payRate);
    if (opts.payType !== undefined) input.pay_type = opts.payType;

    const employee = updateEmployee(id, input);
    if (!employee) {
      console.error(`Employee '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(employee, null, 2));
    } else {
      console.log(`Updated: ${employee.name}`);
    }
  });

employeeCmd
  .command("terminate")
  .description("Terminate an employee")
  .argument("<id>", "Employee ID")
  .option("--end-date <date>", "End date (YYYY-MM-DD)")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const employee = terminateEmployee(id, opts.endDate);
    if (!employee) {
      console.error(`Employee '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(employee, null, 2));
    } else {
      console.log(`Terminated: ${employee.name} (end date: ${employee.end_date})`);
    }
  });

// --- Pay Periods ---

const periodCmd = program
  .command("payperiod")
  .description("Pay period management");

periodCmd
  .command("create")
  .description("Create a new pay period")
  .requiredOption("--start <date>", "Start date (YYYY-MM-DD)")
  .requiredOption("--end <date>", "End date (YYYY-MM-DD)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const period = createPayPeriod({
      start_date: opts.start,
      end_date: opts.end,
    });

    if (opts.json) {
      console.log(JSON.stringify(period, null, 2));
    } else {
      console.log(`Created pay period: ${period.start_date} to ${period.end_date} (${period.id})`);
    }
  });

periodCmd
  .command("list")
  .description("List pay periods")
  .option("--status <status>", "Filter by status")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const periods = listPayPeriods(opts.status);

    if (opts.json) {
      console.log(JSON.stringify(periods, null, 2));
    } else {
      if (periods.length === 0) {
        console.log("No pay periods found.");
        return;
      }
      for (const p of periods) {
        console.log(`  ${p.start_date} to ${p.end_date} [${p.status}] (${p.id})`);
      }
      console.log(`\n${periods.length} pay period(s)`);
    }
  });

periodCmd
  .command("process")
  .description("Process payroll for a pay period")
  .argument("<id>", "Pay period ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    try {
      const stubs = processPayroll(id);
      if (opts.json) {
        console.log(JSON.stringify(stubs, null, 2));
      } else {
        console.log(`Processed payroll: ${stubs.length} pay stub(s) generated.`);
        for (const s of stubs) {
          console.log(`  Employee ${s.employee_id}: gross=$${s.gross_pay} net=$${s.net_pay}`);
        }
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// --- Pay Stubs ---

const stubCmd = program
  .command("paystub")
  .description("Pay stub management");

stubCmd
  .command("list")
  .description("List pay stubs")
  .option("--employee <id>", "Filter by employee ID")
  .option("--period <id>", "Filter by pay period ID")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stubs = listPayStubs({
      employee_id: opts.employee,
      pay_period_id: opts.period,
    });

    if (opts.json) {
      console.log(JSON.stringify(stubs, null, 2));
    } else {
      if (stubs.length === 0) {
        console.log("No pay stubs found.");
        return;
      }
      for (const s of stubs) {
        console.log(`  ${s.id} — Employee ${s.employee_id}: gross=$${s.gross_pay} net=$${s.net_pay}`);
      }
      console.log(`\n${stubs.length} pay stub(s)`);
    }
  });

stubCmd
  .command("get")
  .description("Get a pay stub by ID")
  .argument("<id>", "Pay stub ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const stub = getPayStub(id);
    if (!stub) {
      console.error(`Pay stub '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(stub, null, 2));
    } else {
      console.log(`Pay Stub: ${stub.id}`);
      console.log(`  Employee: ${stub.employee_id}`);
      console.log(`  Period: ${stub.pay_period_id}`);
      console.log(`  Gross Pay: $${stub.gross_pay}`);
      console.log(`  Deductions: ${JSON.stringify(stub.deductions)}`);
      console.log(`  Net Pay: $${stub.net_pay}`);
      if (stub.hours_worked !== null) console.log(`  Hours: ${stub.hours_worked}`);
      if (stub.overtime_hours) console.log(`  Overtime: ${stub.overtime_hours}`);
    }
  });

// --- Run (process payroll shortcut) ---

program
  .command("run")
  .description("Process payroll for a pay period (shortcut)")
  .argument("<period-id>", "Pay period ID")
  .option("--json", "Output as JSON", false)
  .action((periodId, opts) => {
    try {
      const stubs = processPayroll(periodId);
      if (opts.json) {
        console.log(JSON.stringify(stubs, null, 2));
      } else {
        console.log(`Payroll processed: ${stubs.length} pay stub(s) generated.`);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// --- Report ---

program
  .command("report")
  .description("Get payroll report for a pay period")
  .argument("<period-id>", "Pay period ID")
  .option("--json", "Output as JSON", false)
  .action((periodId, opts) => {
    const report = getPayrollReport(periodId);
    if (!report) {
      console.error(`Pay period '${periodId}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Payroll Report: ${report.period.start_date} to ${report.period.end_date}`);
      console.log(`  Status: ${report.period.status}`);
      console.log(`  Employees: ${report.employee_count}`);
      console.log(`  Total Gross: $${report.total_gross}`);
      console.log(`  Total Deductions: $${report.total_deductions}`);
      console.log(`  Total Net: $${report.total_net}`);
    }
  });

// --- Taxes ---

program
  .command("taxes")
  .description("Get tax summary for a year")
  .argument("<year>", "Tax year")
  .option("--json", "Output as JSON", false)
  .action((year, opts) => {
    const summary = getTaxSummary(parseInt(year));

    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      if (summary.length === 0) {
        console.log(`No tax data for ${year}.`);
        return;
      }
      for (const entry of summary) {
        console.log(`  ${entry.employee_name}: gross=$${entry.total_gross} fed=$${entry.total_federal_tax} state=$${entry.total_state_tax} net=$${entry.total_net}`);
      }
    }
  });

// --- Benefits ---

const benefitCmd = program
  .command("benefit")
  .description("Employee benefit management");

benefitCmd
  .command("add")
  .description("Add a benefit to an employee")
  .requiredOption("--employee <id>", "Employee ID")
  .requiredOption("--type <type>", "Benefit type: health, dental, vision, retirement, hsa, other")
  .requiredOption("--amount <amount>", "Deduction amount")
  .option("--description <desc>", "Description")
  .option("--frequency <freq>", "Frequency: per_period, monthly, annual", "per_period")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    try {
      const benefit = createBenefit({
        employee_id: opts.employee,
        type: opts.type,
        amount: parseFloat(opts.amount),
        description: opts.description,
        frequency: opts.frequency,
      });

      if (opts.json) {
        console.log(JSON.stringify(benefit, null, 2));
      } else {
        console.log(`Created benefit: ${benefit.type} $${benefit.amount}/${benefit.frequency} (${benefit.id})`);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

benefitCmd
  .command("list")
  .description("List benefits")
  .option("--employee <id>", "Filter by employee ID")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const benefits = listBenefits(opts.employee);

    if (opts.json) {
      console.log(JSON.stringify(benefits, null, 2));
    } else {
      if (benefits.length === 0) {
        console.log("No benefits found.");
        return;
      }
      for (const b of benefits) {
        const status = b.active ? "" : " [INACTIVE]";
        console.log(`  ${b.type} — $${b.amount}/${b.frequency} (${b.employee_id})${status}`);
      }
      console.log(`\n${benefits.length} benefit(s)`);
    }
  });

benefitCmd
  .command("remove")
  .description("Deactivate a benefit")
  .argument("<id>", "Benefit ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const removed = removeBenefit(id);
    if (opts.json) {
      console.log(JSON.stringify({ removed }));
    } else {
      console.log(removed ? `Benefit ${id} deactivated.` : `Benefit '${id}' not found.`);
    }
  });

// --- ACH File Generation ---

program
  .command("generate-ach")
  .description("Generate NACHA-format ACH file for a pay period")
  .requiredOption("--period <id>", "Pay period ID")
  .requiredOption("--routing <number>", "Bank routing number")
  .requiredOption("--account <number>", "Bank account number")
  .option("--company <name>", "Company name", "PAYROLL CO")
  .action((opts) => {
    try {
      const achContent = generateAchFile(opts.period, opts.routing, opts.account, opts.company);
      console.log(achContent);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// --- W-2 Generation ---

program
  .command("w2")
  .description("Generate W-2 data for an employee")
  .requiredOption("--year <year>", "Tax year")
  .requiredOption("--employee <id>", "Employee ID")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const w2 = generateW2(opts.employee, parseInt(opts.year));
    if (!w2) {
      console.error("No W-2 data found (employee not found, is a contractor, or has no pay stubs).");
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(w2, null, 2));
    } else {
      console.log(`W-2 for ${w2.employee_name} (${w2.year})`);
      console.log(`  Gross Wages: $${w2.gross}`);
      console.log(`  Federal Tax Withheld: $${w2.federal_withheld}`);
      console.log(`  State Tax Withheld: $${w2.state_withheld}`);
      console.log(`  Social Security: $${w2.social_security}`);
      console.log(`  Medicare: $${w2.medicare}`);
    }
  });

// --- 1099-NEC Generation ---

program
  .command("1099")
  .description("Generate 1099-NEC data for contractors")
  .requiredOption("--year <year>", "Tax year")
  .option("--employee <id>", "Specific contractor ID (optional)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const forms = generate1099(opts.employee || null, parseInt(opts.year));

    if (opts.json) {
      console.log(JSON.stringify(forms, null, 2));
    } else {
      if (forms.length === 0) {
        console.log("No 1099-NEC forms to generate (no contractors with >$600 compensation).");
        return;
      }
      for (const f of forms) {
        console.log(`  ${f.employee_name}: $${f.total_compensation} (${f.year})`);
      }
      console.log(`\n${forms.length} form(s)`);
    }
  });

// --- Payroll Schedule ---

const scheduleCmd = program
  .command("schedule")
  .description("Payroll schedule management");

scheduleCmd
  .command("set")
  .description("Set the payroll schedule")
  .requiredOption("--frequency <freq>", "Frequency: weekly, biweekly, semimonthly, monthly")
  .requiredOption("--anchor <date>", "Anchor date (YYYY-MM-DD)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const schedule = setSchedule(opts.frequency, opts.anchor);

    if (opts.json) {
      console.log(JSON.stringify(schedule, null, 2));
    } else {
      console.log(`Schedule set: ${schedule.frequency} starting ${schedule.anchor_date}`);
    }
  });

scheduleCmd
  .command("next")
  .description("Get the next pay period dates based on schedule")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const next = getNextPayPeriod();
    if (!next) {
      console.error("No payroll schedule configured. Use 'schedule set' first.");
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(next, null, 2));
    } else {
      console.log(`Next pay period: ${next.start_date} to ${next.end_date}`);
    }
  });

// --- Audit ---

program
  .command("audit")
  .description("Audit a payroll period for issues")
  .requiredOption("--period <id>", "Pay period ID")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    try {
      const result = auditPayroll(opts.period);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.passed) {
          console.log("PASSED — No issues found.");
        } else {
          console.log(`FAILED — ${result.issues.length} issue(s):`);
          for (const issue of result.issues) {
            console.log(`  - ${issue}`);
          }
        }
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// --- Forecast ---

program
  .command("forecast")
  .description("Forecast future payroll costs")
  .option("--months <n>", "Number of months to forecast", "3")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const result = forecastPayroll(parseInt(opts.months));

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Payroll Forecast (${result.months} months):`);
      for (const p of result.periods) {
        console.log(`  ${p.month}: gross=$${p.estimated_gross} deductions=$${p.estimated_deductions} net=$${p.estimated_net}`);
      }
      console.log(`\nTotal: gross=$${result.total_estimated_gross} deductions=$${result.total_estimated_deductions} net=$${result.total_estimated_net}`);
    }
  });

// --- Overtime Check ---

program
  .command("overtime-check")
  .description("Check for employees exceeding weekly hours threshold")
  .option("--threshold <hours>", "Hours threshold", "40")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const alerts = checkOvertime(parseFloat(opts.threshold));

    if (opts.json) {
      console.log(JSON.stringify(alerts, null, 2));
    } else {
      if (alerts.length === 0) {
        console.log("No overtime alerts.");
        return;
      }
      for (const a of alerts) {
        console.log(`  ${a.employee_name}: ${a.total_hours}h total (${a.overtime_hours}h over ${a.threshold}h threshold)`);
      }
      console.log(`\n${alerts.length} alert(s)`);
    }
  });

program.parse(process.argv);
