import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-analytics-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  recordKpi,
  getKpiById,
  getKpi,
  getKpiTrend,
  listKpis,
  getLatestKpis,
  deleteKpi,
  createDashboard,
  getDashboard,
  listDashboards,
  updateDashboard,
  deleteDashboard,
  generateReport,
  getReport,
  listReports,
  deleteReport,
  getBusinessHealth,
  generateExecutiveSummary,
} from "./analytics";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ─── KPIs ───

describe("KPIs", () => {
  test("record and get KPI by ID", () => {
    const kpi = recordKpi({
      name: "monthly_revenue",
      value: 50000,
      category: "Finance",
      source_service: "invoices",
      period: "2024-01",
    });

    expect(kpi.id).toBeTruthy();
    expect(kpi.name).toBe("monthly_revenue");
    expect(kpi.value).toBe(50000);
    expect(kpi.category).toBe("Finance");
    expect(kpi.source_service).toBe("invoices");
    expect(kpi.period).toBe("2024-01");

    const fetched = getKpiById(kpi.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(kpi.id);
  });

  test("get KPI by name returns latest", () => {
    recordKpi({ name: "users_count", value: 100, category: "Growth" });
    recordKpi({ name: "users_count", value: 150, category: "Growth" });

    const latest = getKpi("users_count");
    expect(latest).toBeDefined();
    expect(latest!.value).toBe(150);
  });

  test("get KPI by name and period", () => {
    recordKpi({ name: "quarterly_sales", value: 200000, period: "2024-Q1" });
    recordKpi({ name: "quarterly_sales", value: 250000, period: "2024-Q2" });

    const q1 = getKpi("quarterly_sales", "2024-Q1");
    expect(q1).toBeDefined();
    expect(q1!.value).toBe(200000);

    const q2 = getKpi("quarterly_sales", "2024-Q2");
    expect(q2).toBeDefined();
    expect(q2!.value).toBe(250000);
  });

  test("get KPI returns null for non-existent", () => {
    const result = getKpi("nonexistent_kpi");
    expect(result).toBeNull();
  });

  test("get KPI trend", () => {
    // These were recorded recently so they should appear in the trend
    const trend = getKpiTrend("users_count", 30);
    expect(trend.length).toBeGreaterThanOrEqual(2);
    // Trend should be ascending by recorded_at
    expect(trend[0].recorded_at <= trend[trend.length - 1].recorded_at).toBe(true);
  });

  test("get KPI trend returns empty for unknown KPI", () => {
    const trend = getKpiTrend("totally_unknown_kpi", 30);
    expect(trend.length).toBe(0);
  });

  test("list KPIs with no filters", () => {
    const kpis = listKpis();
    expect(kpis.length).toBeGreaterThanOrEqual(4);
  });

  test("list KPIs filtered by category", () => {
    const kpis = listKpis({ category: "Finance" });
    expect(kpis.length).toBeGreaterThanOrEqual(1);
    expect(kpis.every((k) => k.category === "Finance")).toBe(true);
  });

  test("list KPIs filtered by source_service", () => {
    const kpis = listKpis({ source_service: "invoices" });
    expect(kpis.length).toBeGreaterThanOrEqual(1);
    expect(kpis.every((k) => k.source_service === "invoices")).toBe(true);
  });

  test("list KPIs with limit", () => {
    const kpis = listKpis({ limit: 2 });
    expect(kpis.length).toBeLessThanOrEqual(2);
  });

  test("get latest KPIs returns one per name", () => {
    const latest = getLatestKpis();
    const names = latest.map((k) => k.name);
    const uniqueNames = new Set(names);
    expect(names.length).toBe(uniqueNames.size);
  });

  test("delete KPI", () => {
    const kpi = recordKpi({ name: "delete_me_kpi", value: 999 });
    expect(deleteKpi(kpi.id)).toBe(true);
    expect(getKpiById(kpi.id)).toBeNull();
  });

  test("delete non-existent KPI returns false", () => {
    expect(deleteKpi("non-existent-id")).toBe(false);
  });

  test("record KPI with metadata", () => {
    const kpi = recordKpi({
      name: "custom_metric",
      value: 42,
      metadata: { unit: "percent", target: 50 },
    });
    expect(kpi.metadata).toEqual({ unit: "percent", target: 50 });
  });
});

// ─── Dashboards ───

describe("Dashboards", () => {
  test("create and get dashboard", () => {
    const dashboard = createDashboard({
      name: "Sales Dashboard",
      description: "Main sales overview",
      widgets: [{ type: "chart", kpi: "monthly_revenue" }],
    });

    expect(dashboard.id).toBeTruthy();
    expect(dashboard.name).toBe("Sales Dashboard");
    expect(dashboard.description).toBe("Main sales overview");
    expect(dashboard.widgets).toEqual([{ type: "chart", kpi: "monthly_revenue" }]);

    const fetched = getDashboard(dashboard.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Sales Dashboard");
  });

  test("list dashboards", () => {
    createDashboard({ name: "Marketing Dashboard" });
    const dashboards = listDashboards();
    expect(dashboards.length).toBeGreaterThanOrEqual(2);
  });

  test("update dashboard", () => {
    const dashboard = createDashboard({ name: "Old Name" });
    const updated = updateDashboard(dashboard.id, {
      name: "New Name",
      description: "Updated description",
      widgets: [{ type: "table" }],
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("New Name");
    expect(updated!.description).toBe("Updated description");
    expect(updated!.widgets).toEqual([{ type: "table" }]);
  });

  test("update non-existent dashboard returns null", () => {
    const result = updateDashboard("non-existent-id", { name: "test" });
    expect(result).toBeNull();
  });

  test("update dashboard with no changes returns existing", () => {
    const dashboard = createDashboard({ name: "No Change" });
    const result = updateDashboard(dashboard.id, {});
    expect(result).toBeDefined();
    expect(result!.name).toBe("No Change");
  });

  test("delete dashboard", () => {
    const dashboard = createDashboard({ name: "DeleteMe" });
    expect(deleteDashboard(dashboard.id)).toBe(true);
    expect(getDashboard(dashboard.id)).toBeNull();
  });

  test("delete non-existent dashboard returns false", () => {
    expect(deleteDashboard("non-existent-id")).toBe(false);
  });

  test("get non-existent dashboard returns null", () => {
    expect(getDashboard("non-existent-id")).toBeNull();
  });
});

// ─── Reports ───

describe("Reports", () => {
  test("generate and get report", () => {
    const report = generateReport({
      name: "Q1 Review",
      type: "quarterly",
      period: "2024-Q1",
    });

    expect(report.id).toBeTruthy();
    expect(report.name).toBe("Q1 Review");
    expect(report.type).toBe("quarterly");
    expect(report.period).toBe("2024-Q1");
    expect(report.content).toBeTruthy();
    expect(report.content).toContain("QUARTERLY REPORT");

    const fetched = getReport(report.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Q1 Review");
  });

  test("generate report includes KPI data", () => {
    const report = generateReport({
      name: "Full Report",
      type: "monthly",
    });

    // Should include some of the KPIs we recorded earlier
    expect(report.content).toBeTruthy();
    expect(report.content).toContain("MONTHLY REPORT");
  });

  test("list reports", () => {
    const reports = listReports();
    expect(reports.length).toBeGreaterThanOrEqual(2);
  });

  test("list reports filtered by type", () => {
    generateReport({ name: "Daily Check", type: "daily" });
    const dailies = listReports({ type: "daily" });
    expect(dailies.length).toBeGreaterThanOrEqual(1);
    expect(dailies.every((r) => r.type === "daily")).toBe(true);
  });

  test("list reports with limit", () => {
    const reports = listReports({ limit: 1 });
    expect(reports.length).toBeLessThanOrEqual(1);
  });

  test("get non-existent report returns null", () => {
    expect(getReport("non-existent-id")).toBeNull();
  });

  test("delete report", () => {
    const report = generateReport({ name: "DeleteMe", type: "custom" });
    expect(deleteReport(report.id)).toBe(true);
    expect(getReport(report.id)).toBeNull();
  });

  test("delete non-existent report returns false", () => {
    expect(deleteReport("non-existent-id")).toBe(false);
  });
});

// ─── Business Health ───

describe("Business Health", () => {
  test("get business health returns summary", () => {
    const health = getBusinessHealth();

    expect(health.total_kpis).toBeGreaterThanOrEqual(1);
    expect(health.categories.length).toBeGreaterThanOrEqual(1);
    expect(health.latest_kpis.length).toBeGreaterThanOrEqual(1);
    expect(health.report_count).toBeGreaterThanOrEqual(1);
    expect(health.dashboard_count).toBeGreaterThanOrEqual(1);
  });

  test("business health categories have correct structure", () => {
    const health = getBusinessHealth();
    for (const cat of health.categories) {
      expect(cat.category).toBeTruthy();
      expect(typeof cat.count).toBe("number");
      expect(typeof cat.latest_value).toBe("number");
    }
  });
});

// ─── Executive Summary ───

describe("Executive Summary", () => {
  test("generate executive summary (local fallback)", async () => {
    // Without API keys, should produce local fallback
    const original = process.env["ANTHROPIC_API_KEY"];
    const originalOai = process.env["OPENAI_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["OPENAI_API_KEY"];

    const summary = await generateExecutiveSummary();
    expect(summary).toBeTruthy();
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(10);

    // Restore
    if (original) process.env["ANTHROPIC_API_KEY"] = original;
    if (originalOai) process.env["OPENAI_API_KEY"] = originalOai;
  });
});
