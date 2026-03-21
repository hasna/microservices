#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
  terminateEmployee,
  createPayPeriod,
  getPayPeriod,
  listPayPeriods,
  updatePayPeriodStatus,
  processPayroll,
  listPayStubs,
  getPayStub,
  createPayment,
  getPayment,
  listPayments,
  updatePaymentStatus,
  getPayrollReport,
  getYtdReport,
  getTaxSummary,
} from "../db/payroll.js";

const server = new McpServer({
  name: "microservice-payroll",
  version: "0.0.1",
});

// --- Employees ---

server.registerTool(
  "create_employee",
  {
    title: "Create Employee",
    description: "Create a new employee.",
    inputSchema: {
      name: z.string(),
      email: z.string().optional(),
      type: z.enum(["employee", "contractor"]).optional(),
      department: z.string().optional(),
      title: z.string().optional(),
      pay_rate: z.number(),
      pay_type: z.enum(["salary", "hourly"]).optional(),
      currency: z.string().optional(),
      tax_info: z.record(z.unknown()).optional(),
      start_date: z.string().optional(),
    },
  },
  async (params) => {
    const employee = createEmployee(params);
    return { content: [{ type: "text", text: JSON.stringify(employee, null, 2) }] };
  }
);

server.registerTool(
  "get_employee",
  {
    title: "Get Employee",
    description: "Get an employee by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const employee = getEmployee(id);
    if (!employee) {
      return { content: [{ type: "text", text: `Employee '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(employee, null, 2) }] };
  }
);

server.registerTool(
  "list_employees",
  {
    title: "List Employees",
    description: "List employees with optional filters.",
    inputSchema: {
      search: z.string().optional(),
      status: z.string().optional(),
      department: z.string().optional(),
      type: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const employees = listEmployees(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ employees, count: employees.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_employee",
  {
    title: "Update Employee",
    description: "Update an existing employee.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      email: z.string().optional(),
      type: z.enum(["employee", "contractor"]).optional(),
      department: z.string().optional(),
      title: z.string().optional(),
      pay_rate: z.number().optional(),
      pay_type: z.enum(["salary", "hourly"]).optional(),
      currency: z.string().optional(),
      tax_info: z.record(z.unknown()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const employee = updateEmployee(id, input);
    if (!employee) {
      return { content: [{ type: "text", text: `Employee '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(employee, null, 2) }] };
  }
);

server.registerTool(
  "terminate_employee",
  {
    title: "Terminate Employee",
    description: "Terminate an employee.",
    inputSchema: {
      id: z.string(),
      end_date: z.string().optional(),
    },
  },
  async ({ id, end_date }) => {
    const employee = terminateEmployee(id, end_date);
    if (!employee) {
      return { content: [{ type: "text", text: `Employee '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(employee, null, 2) }] };
  }
);

// --- Pay Periods ---

server.registerTool(
  "create_pay_period",
  {
    title: "Create Pay Period",
    description: "Create a new pay period.",
    inputSchema: {
      start_date: z.string(),
      end_date: z.string(),
    },
  },
  async (params) => {
    const period = createPayPeriod(params);
    return { content: [{ type: "text", text: JSON.stringify(period, null, 2) }] };
  }
);

server.registerTool(
  "get_pay_period",
  {
    title: "Get Pay Period",
    description: "Get a pay period by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const period = getPayPeriod(id);
    if (!period) {
      return { content: [{ type: "text", text: `Pay period '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(period, null, 2) }] };
  }
);

server.registerTool(
  "list_pay_periods",
  {
    title: "List Pay Periods",
    description: "List pay periods with optional status filter.",
    inputSchema: {
      status: z.string().optional(),
    },
  },
  async ({ status }) => {
    const periods = listPayPeriods(status);
    return {
      content: [
        { type: "text", text: JSON.stringify({ periods, count: periods.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_pay_period_status",
  {
    title: "Update Pay Period Status",
    description: "Update the status of a pay period.",
    inputSchema: {
      id: z.string(),
      status: z.enum(["draft", "processing", "completed"]),
    },
  },
  async ({ id, status }) => {
    const period = updatePayPeriodStatus(id, status);
    if (!period) {
      return { content: [{ type: "text", text: `Pay period '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(period, null, 2) }] };
  }
);

// --- Payroll Processing ---

server.registerTool(
  "process_payroll",
  {
    title: "Process Payroll",
    description: "Process payroll for a pay period, auto-generating pay stubs for all active employees.",
    inputSchema: {
      period_id: z.string(),
    },
  },
  async ({ period_id }) => {
    try {
      const stubs = processPayroll(period_id);
      return {
        content: [
          { type: "text", text: JSON.stringify({ stubs, count: stubs.length }, null, 2) },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// --- Pay Stubs ---

server.registerTool(
  "list_pay_stubs",
  {
    title: "List Pay Stubs",
    description: "List pay stubs with optional filters.",
    inputSchema: {
      employee_id: z.string().optional(),
      pay_period_id: z.string().optional(),
    },
  },
  async (params) => {
    const stubs = listPayStubs(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ stubs, count: stubs.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_pay_stub",
  {
    title: "Get Pay Stub",
    description: "Get a pay stub by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const stub = getPayStub(id);
    if (!stub) {
      return { content: [{ type: "text", text: `Pay stub '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(stub, null, 2) }] };
  }
);

// --- Payments ---

server.registerTool(
  "create_payment",
  {
    title: "Create Payment",
    description: "Create a payment for a pay stub.",
    inputSchema: {
      pay_stub_id: z.string(),
      method: z.enum(["direct_deposit", "check", "wire"]).optional(),
      reference: z.string().optional(),
    },
  },
  async (params) => {
    const payment = createPayment(params);
    return { content: [{ type: "text", text: JSON.stringify(payment, null, 2) }] };
  }
);

server.registerTool(
  "get_payment",
  {
    title: "Get Payment",
    description: "Get a payment by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const payment = getPayment(id);
    if (!payment) {
      return { content: [{ type: "text", text: `Payment '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(payment, null, 2) }] };
  }
);

server.registerTool(
  "list_payments",
  {
    title: "List Payments",
    description: "List payments with optional filters.",
    inputSchema: {
      pay_stub_id: z.string().optional(),
      status: z.string().optional(),
    },
  },
  async (params) => {
    const payments = listPayments(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ payments, count: payments.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_payment_status",
  {
    title: "Update Payment Status",
    description: "Update the status of a payment.",
    inputSchema: {
      id: z.string(),
      status: z.enum(["pending", "paid", "failed"]),
    },
  },
  async ({ id, status }) => {
    const payment = updatePaymentStatus(id, status);
    if (!payment) {
      return { content: [{ type: "text", text: `Payment '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(payment, null, 2) }] };
  }
);

// --- Reports ---

server.registerTool(
  "payroll_report",
  {
    title: "Payroll Report",
    description: "Get a payroll report for a pay period.",
    inputSchema: { period_id: z.string() },
  },
  async ({ period_id }) => {
    const report = getPayrollReport(period_id);
    if (!report) {
      return { content: [{ type: "text", text: `Pay period '${period_id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
);

server.registerTool(
  "ytd_report",
  {
    title: "YTD Report",
    description: "Get year-to-date report for an employee.",
    inputSchema: {
      employee_id: z.string(),
      year: z.number().optional(),
    },
  },
  async ({ employee_id, year }) => {
    const report = getYtdReport(employee_id, year);
    if (!report) {
      return { content: [{ type: "text", text: `Employee '${employee_id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
);

server.registerTool(
  "tax_summary",
  {
    title: "Tax Summary",
    description: "Get tax summary for all employees for a given year.",
    inputSchema: { year: z.number() },
  },
  async ({ year }) => {
    const summary = getTaxSummary(year);
    return {
      content: [
        { type: "text", text: JSON.stringify({ summary, count: summary.length }, null, 2) },
      ],
    };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-payroll MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
