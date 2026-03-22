/**
 * Analytics CRUD operations — KPIs, Dashboards, Reports
 */

import { getDatabase } from "./database.js";

// ─── KPI Types ───

export interface Kpi {
  id: string;
  name: string;
  category: string | null;
  value: number;
  period: string | null;
  source_service: string | null;
  metadata: Record<string, unknown>;
  recorded_at: string;
}

interface KpiRow {
  id: string;
  name: string;
  category: string | null;
  value: number;
  period: string | null;
  source_service: string | null;
  metadata: string;
  recorded_at: string;
}

function rowToKpi(row: KpiRow): Kpi {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

// ─── Dashboard Types ───

export interface Dashboard {
  id: string;
  name: string;
  description: string | null;
  widgets: unknown[];
  created_at: string;
}

interface DashboardRow {
  id: string;
  name: string;
  description: string | null;
  widgets: string;
  created_at: string;
}

function rowToDashboard(row: DashboardRow): Dashboard {
  return {
    ...row,
    widgets: JSON.parse(row.widgets || "[]"),
  };
}

// ─── Report Types ───

export type ReportType = "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "custom";

export interface Report {
  id: string;
  name: string;
  type: ReportType;
  content: string | null;
  period: string | null;
  generated_at: string;
  metadata: Record<string, unknown>;
}

interface ReportRow {
  id: string;
  name: string;
  type: ReportType;
  content: string | null;
  period: string | null;
  generated_at: string;
  metadata: string;
}

function rowToReport(row: ReportRow): Report {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

// ─── KPI Operations ───

export interface RecordKpiInput {
  name: string;
  value: number;
  category?: string;
  source_service?: string;
  period?: string;
  metadata?: Record<string, unknown>;
}

export function recordKpi(input: RecordKpiInput): Kpi {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO kpis (id, name, value, category, source_service, period, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.value,
    input.category || null,
    input.source_service || null,
    input.period || null,
    metadata
  );

  return getKpiById(id)!;
}

export function getKpiById(id: string): Kpi | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM kpis WHERE id = ?").get(id) as KpiRow | null;
  return row ? rowToKpi(row) : null;
}

export function getKpi(name: string, period?: string): Kpi | null {
  const db = getDatabase();
  let sql = "SELECT * FROM kpis WHERE name = ?";
  const params: unknown[] = [name];

  if (period) {
    sql += " AND period = ?";
    params.push(period);
  }

  sql += " ORDER BY recorded_at DESC LIMIT 1";

  const row = db.prepare(sql).get(...params) as KpiRow | null;
  return row ? rowToKpi(row) : null;
}

export function getKpiTrend(name: string, days: number = 30): Kpi[] {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const rows = db
    .prepare(
      "SELECT * FROM kpis WHERE name = ? AND recorded_at >= ? ORDER BY recorded_at ASC"
    )
    .all(name, cutoff) as KpiRow[];

  return rows.map(rowToKpi);
}

export interface ListKpisOptions {
  category?: string;
  source_service?: string;
  limit?: number;
  offset?: number;
}

export function listKpis(options: ListKpisOptions = {}): Kpi[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.category) {
    conditions.push("category = ?");
    params.push(options.category);
  }

  if (options.source_service) {
    conditions.push("source_service = ?");
    params.push(options.source_service);
  }

  let sql = "SELECT * FROM kpis";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY recorded_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as KpiRow[];
  return rows.map(rowToKpi);
}

export function getLatestKpis(): Kpi[] {
  const db = getDatabase();
  // Get the most recent value for each unique KPI name (using MAX(rowid) to break ties)
  const rows = db
    .prepare(
      `SELECT * FROM kpis WHERE rowid IN (
         SELECT MAX(rowid) FROM kpis GROUP BY name
       ) ORDER BY name`
    )
    .all() as KpiRow[];

  return rows.map(rowToKpi);
}

export function deleteKpi(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM kpis WHERE id = ?").run(id);
  return result.changes > 0;
}

// ─── Dashboard Operations ───

export interface CreateDashboardInput {
  name: string;
  description?: string;
  widgets?: unknown[];
}

export function createDashboard(input: CreateDashboardInput): Dashboard {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const widgets = JSON.stringify(input.widgets || []);

  db.prepare(
    `INSERT INTO dashboards (id, name, description, widgets)
     VALUES (?, ?, ?, ?)`
  ).run(id, input.name, input.description || null, widgets);

  return getDashboard(id)!;
}

export function getDashboard(id: string): Dashboard | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM dashboards WHERE id = ?").get(id) as DashboardRow | null;
  return row ? rowToDashboard(row) : null;
}

export function listDashboards(): Dashboard[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM dashboards ORDER BY created_at DESC")
    .all() as DashboardRow[];
  return rows.map(rowToDashboard);
}

export interface UpdateDashboardInput {
  name?: string;
  description?: string;
  widgets?: unknown[];
}

export function updateDashboard(
  id: string,
  input: UpdateDashboardInput
): Dashboard | null {
  const db = getDatabase();
  const existing = getDashboard(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.widgets !== undefined) {
    sets.push("widgets = ?");
    params.push(JSON.stringify(input.widgets));
  }

  if (sets.length === 0) return existing;

  params.push(id);

  db.prepare(
    `UPDATE dashboards SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getDashboard(id);
}

export function deleteDashboard(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM dashboards WHERE id = ?").run(id);
  return result.changes > 0;
}

// ─── Report Operations ───

export interface GenerateReportInput {
  name: string;
  type: ReportType;
  period?: string;
  metadata?: Record<string, unknown>;
}

export function generateReport(input: GenerateReportInput): Report {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  // Build report content from current KPIs
  const latestKpis = getLatestKpis();
  const categories = new Map<string, Kpi[]>();
  for (const kpi of latestKpis) {
    const cat = kpi.category || "Uncategorized";
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(kpi);
  }

  const lines: string[] = [];
  lines.push(`=== ${input.type.toUpperCase()} REPORT: ${input.name} ===`);
  if (input.period) lines.push(`Period: ${input.period}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");

  for (const [category, kpis] of categories) {
    lines.push(`--- ${category} ---`);
    for (const kpi of kpis) {
      lines.push(`  ${kpi.name}: ${kpi.value}${kpi.period ? ` (${kpi.period})` : ""}`);
    }
    lines.push("");
  }

  if (latestKpis.length === 0) {
    lines.push("No KPIs recorded yet.");
  }

  const content = lines.join("\n");

  db.prepare(
    `INSERT INTO reports (id, name, type, content, period, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.name, input.type, content, input.period || null, metadata);

  return getReport(id)!;
}

export function getReport(id: string): Report | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as ReportRow | null;
  return row ? rowToReport(row) : null;
}

export interface ListReportsOptions {
  type?: ReportType;
  limit?: number;
  offset?: number;
}

export function listReports(options: ListReportsOptions = {}): Report[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }

  let sql = "SELECT * FROM reports";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY generated_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as ReportRow[];
  return rows.map(rowToReport);
}

export function deleteReport(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM reports WHERE id = ?").run(id);
  return result.changes > 0;
}

// ─── Business Health ───

export interface BusinessHealth {
  total_kpis: number;
  categories: { category: string; count: number; latest_value: number }[];
  latest_kpis: Kpi[];
  report_count: number;
  dashboard_count: number;
}

export function getBusinessHealth(): BusinessHealth {
  const db = getDatabase();

  const totalKpis = (
    db.prepare("SELECT COUNT(DISTINCT name) as count FROM kpis").get() as { count: number }
  ).count;

  const categoryRows = db
    .prepare(
      `SELECT category, COUNT(DISTINCT name) as count
       FROM kpis WHERE category IS NOT NULL
       GROUP BY category ORDER BY category`
    )
    .all() as { category: string; count: number }[];

  // Get latest value per category
  const categories = categoryRows.map((row) => {
    const latestInCat = db
      .prepare(
        `SELECT value FROM kpis WHERE category = ? ORDER BY recorded_at DESC LIMIT 1`
      )
      .get(row.category) as { value: number } | null;
    return {
      category: row.category,
      count: row.count,
      latest_value: latestInCat?.value ?? 0,
    };
  });

  const latestKpis = getLatestKpis();

  const reportCount = (
    db.prepare("SELECT COUNT(*) as count FROM reports").get() as { count: number }
  ).count;

  const dashboardCount = (
    db.prepare("SELECT COUNT(*) as count FROM dashboards").get() as { count: number }
  ).count;

  return {
    total_kpis: totalKpis,
    categories,
    latest_kpis: latestKpis,
    report_count: reportCount,
    dashboard_count: dashboardCount,
  };
}

// ─── AI Executive Summary ───

export async function generateExecutiveSummary(): Promise<string> {
  const health = getBusinessHealth();
  const latestKpis = getLatestKpis();

  // Build context for AI
  const kpiSummary = latestKpis
    .map((k) => `${k.name} (${k.category || "uncategorized"}): ${k.value}`)
    .join("\n");

  const prompt = `You are a business analyst. Generate a concise executive summary based on these KPIs:

${kpiSummary || "No KPIs recorded yet."}

Total unique KPIs: ${health.total_kpis}
Categories: ${health.categories.map((c) => `${c.category} (${c.count} KPIs)`).join(", ") || "none"}
Reports generated: ${health.report_count}
Dashboards: ${health.dashboard_count}

Provide a brief, actionable executive summary in 3-5 sentences.`;

  // Try Anthropic first, then OpenAI, then fallback
  const anthropicKey = process.env["ANTHROPIC_API_KEY"];
  const openaiKey = process.env["OPENAI_API_KEY"];

  if (anthropicKey) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          content: { type: string; text: string }[];
        };
        return data.content[0].text;
      }
    } catch {
      // Fall through to OpenAI
    }
  }

  if (openaiKey) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 500,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          choices: { message: { content: string } }[];
        };
        return data.choices[0].message.content;
      }
    } catch {
      // Fall through to local summary
    }
  }

  // Local fallback — no AI API keys
  const lines: string[] = [];
  lines.push("=== Executive Summary ===");
  lines.push("");

  if (latestKpis.length === 0) {
    lines.push("No KPIs have been recorded yet. Start tracking key metrics to enable business health reporting.");
    return lines.join("\n");
  }

  lines.push(`Tracking ${health.total_kpis} unique KPI(s) across ${health.categories.length} category(s).`);

  for (const cat of health.categories) {
    lines.push(`- ${cat.category}: ${cat.count} KPI(s), latest value: ${cat.latest_value}`);
  }

  if (health.report_count > 0) {
    lines.push(`\n${health.report_count} report(s) have been generated.`);
  }

  if (health.dashboard_count > 0) {
    lines.push(`${health.dashboard_count} dashboard(s) configured.`);
  }

  return lines.join("\n");
}
