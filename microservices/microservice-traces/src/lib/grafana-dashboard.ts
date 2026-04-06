/**
 * Grafana dashboard generator — produces a Grafana dashboard JSON that can be
 * imported directly into Grafana. Includes trace overview, latency, cost, error,
 * and LLM panels.
 */

import type { Sql } from "postgres";

export interface GrafanaDashboard {
  annotations: { list: unknown[] };
  description: string;
  editable: boolean;
  fiscalYearStartMonth: number;
  graphTooltip: number;
  id: number | null;
  links: unknown[];
  panels: GrafanaPanel[];
  refresh: string;
  schemaVersion: number;
  style: string;
  tags: string[];
  templating: { list: unknown[] };
  time: { from: string; to: string };
  timepicker: unknown;
  timezone: string;
  title: string;
  uid: string;
  version: number;
  variables: { list: unknown[] };
}

export interface GrafanaPanel {
  datasource: { type: string; uid: string };
  fieldConfig: {
    defaults: Record<string, unknown>;
    overrides: unknown[];
  };
  gridPos: { x: number; y: number; w: number; h: number };
  id: number;
  options: Record<string, unknown>;
  targets: GrafanaTarget[];
  title: string;
  type: string;
}

export interface GrafanaTarget {
  datasource: { type: string; uid: string };
  format: string;
  rawSql?: string;
  refId: string;
}

function makePanel(
  id: number,
  title: string,
  type: string,
  gridPos: { x: number; y: number; w: number; h: number },
  targets: GrafanaTarget[],
  options: Record<string, unknown> = {},
): GrafanaPanel {
  return {
    datasource: { type: "grafana-postgresql-datasource", uid: "${datasource}" },
    fieldConfig: { defaults: {}, overrides: [] },
    gridPos,
    id,
    options,
    targets,
    title,
    type,
  };
}

function textPanel(
  id: number,
  title: string,
  gridPos: { x: number; y: number; w: number; h: number },
): GrafanaPanel {
  return makePanel(
    id,
    title,
    "text",
    gridPos,
    [],
    {
      content: "",
      mode: "markdown",
    },
  );
}

function statPanel(
  id: number,
  title: string,
  gridPos: { x: number; y: number; w: number; h: number },
  targets: GrafanaTarget[],
): GrafanaPanel {
  return makePanel(
    id,
    title,
    "stat",
    gridPos,
    targets,
    {
      colorMode: "value",
      graphMode: "area",
      justifyMode: "auto",
      orientation: "auto",
      reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false },
      textMode: "auto",
    },
  );
}

function timeSeriesPanel(
  id: number,
  title: string,
  gridPos: { x: number; y: number; w: number; h: number },
  targets: GrafanaTarget[],
): GrafanaPanel {
  return makePanel(
    id,
    title,
    "timeseries",
    gridPos,
    targets,
    {
      legend: { displayMode: "list", placement: "bottom", showLegend: true },
      tooltip: { mode: "single", sort: "none" },
    },
  );
}

function pieChartPanel(
  id: number,
  title: string,
  gridPos: { x: number; y: number; w: number; h: number },
  targets: GrafanaTarget[],
): GrafanaPanel {
  return makePanel(
    id,
    title,
    "piechartv2",
    gridPos,
    targets,
    { legend: { displayMode: "list", placement: "right", showLegend: true } },
  );
}

function tablePanel(
  id: number,
  title: string,
  gridPos: { x: number; y: number; w: number; h: number },
  targets: GrafanaTarget[],
): GrafanaPanel {
  return makePanel(
    id,
    title,
    "table",
    gridPos,
    targets,
    {
      frameFormat: "Time series",
      showHeader: true,
    },
  );
}

/**
 * Generate a Grafana dashboard for a workspace's traces.
 *
 * Requires the grafana-postgresql-datasource plugin with a datasource named "traces-ds".
 * Import the returned JSON into Grafana, then set the ${datasource} variable to your
 * PostgreSQL datasource name.
 */
export function generateGrafanaDashboard(opts: {
  workspaceId: string;
  title?: string;
  uid?: string;
  refreshInterval?: string;
}): GrafanaDashboard {
  const {
    workspaceId,
    title = "Hasna Traces Overview",
    uid = `hasna-traces-${workspaceId.slice(0, 8)}`,
    refreshInterval = "5m",
  } = opts;

  const ds = "${datasource}";
  const panels: GrafanaPanel[] = [];
  let panelId = 1;
  let y = 0;

  // ── Header row ────────────────────────────────────────────────────────────
  panels.push(
    textPanel(panelId++, "## Trace Overview", { x: 0, y, w: 24, h: 2 }),
  );
  y += 2;

  // ── Stat cards (row 1) ─────────────────────────────────────────────────────
  const statY = y;
  panels.push(
    statPanel(panelId++, "Total Traces (7d)", { x: 0, y: statY, w: 4, h: 4 }, [
      {
        datasource: { type: "grafana-postgresql-datasource", uid: ds },
        format: "short",
        rawSql: `SELECT COUNT(*) FROM traces.traces WHERE workspace_id = '${workspaceId}' AND started_at >= NOW() - INTERVAL '7 days'`,
        refId: "A",
      },
    ]),
  );
  panels.push(
    statPanel(panelId++, "Error Rate (7d)", { x: 4, y: statY, w: 4, h: 4 }, [
      {
        datasource: { type: "grafana-postgresql-datasource", uid: ds },
        format: "percentunit",
        rawSql: `SELECT COUNT(*) FILTER (WHERE status = 'error')::numeric / NULLIF(COUNT(*), 0) FROM traces.traces WHERE workspace_id = '${workspaceId}' AND started_at >= NOW() - INTERVAL '7 days'`,
        refId: "A",
      },
    ]),
  );
  panels.push(
    statPanel(panelId++, "Avg Latency (ms, 7d)", { x: 8, y: statY, w: 4, h: 4 }, [
      {
        datasource: { type: "grafana-postgresql-datasource", uid: ds },
        format: "ms",
        rawSql: `SELECT COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_duration_ms), 0) FROM traces.traces WHERE workspace_id = '${workspaceId}' AND started_at >= NOW() - INTERVAL '7 days'`,
        refId: "A",
      },
    ]),
  );
  panels.push(
    statPanel(panelId++, "Total Cost (7d)", { x: 12, y: statY, w: 4, h: 4 }, [
      {
        datasource: { type: "grafana-postgresql-datasource", uid: ds },
        format: "currencyUSD",
        rawSql: `SELECT COALESCE(SUM(total_cost_usd), 0) FROM traces.traces WHERE workspace_id = '${workspaceId}' AND started_at >= NOW() - INTERVAL '7 days'`,
        refId: "A",
      },
    ]),
  );
  panels.push(
    statPanel(panelId++, "P95 Latency (ms, 7d)", { x: 16, y: statY, w: 4, h: 4 }, [
      {
        datasource: { type: "grafana-postgresql-datasource", uid: ds },
        format: "ms",
        rawSql: `SELECT COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_duration_ms), 0) FROM traces.traces WHERE workspace_id = '${workspaceId}' AND started_at >= NOW() - INTERVAL '7 days'`,
        refId: "A",
      },
    ]),
  );
  panels.push(
    statPanel(panelId++, "Active Sampling Policies", { x: 20, y: statY, w: 4, h: 4 }, [
      {
        datasource: { type: "grafana-postgresql-datasource", uid: ds },
        format: "short",
        rawSql: `SELECT COUNT(*) FROM traces.trace_sampling_policies WHERE (workspace_id = '${workspaceId}' OR workspace_id IS NULL) AND enabled = true`,
        refId: "A",
      },
    ]),
  );
  y += 4;

  // ── Trace volume over time ────────────────────────────────────────────────
  panels.push(
    timeSeriesPanel(
      panelId++,
      "Trace Volume (per hour)",
      { x: 0, y, w: 12, h: 8 },
      [
        {
          datasource: { type: "grafana-postgresql-datasource", uid: ds },
          format: "short",
          rawSql: `SELECT DATE_TRUNC('hour', started_at) AS time, COUNT(*) FROM traces.traces WHERE workspace_id = '${workspaceId}' AND started_at >= NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 1`,
          refId: "A",
        },
      ],
    ),
  );

  // ── Error rate over time ─────────────────────────────────────────────────
  panels.push(
    timeSeriesPanel(
      panelId++,
      "Error Rate (per hour)",
      { x: 12, y, w: 12, h: 8 },
      [
        {
          datasource: { type: "grafana-postgresql-datasource", uid: ds },
          format: "percentunit",
          rawSql: `SELECT DATE_TRUNC('hour', started_at) AS time, COUNT(*) FILTER (WHERE status = 'error')::numeric / NULLIF(COUNT(*), 0) FROM traces.traces WHERE workspace_id = '${workspaceId}' AND started_at >= NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 1`,
          refId: "A",
        },
      ],
    ),
  );
  y += 8;

  // ── Latency percentiles over time ────────────────────────────────────────
  panels.push(
    timeSeriesPanel(
      panelId++,
      "Latency Percentiles (ms, per hour)",
      { x: 0, y, w: 16, h: 8 },
      [
        {
          datasource: { type: "grafana-postgresql-datasource", uid: ds },
          format: "ms",
          rawSql: `SELECT DATE_TRUNC('hour', started_at) AS time, PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_duration_ms) AS p50, PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_duration_ms) AS p95, PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY total_duration_ms) AS p99 FROM traces.traces WHERE workspace_id = '${workspaceId}' AND started_at >= NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 1`,
          refId: "A",
        },
      ],
    ),
  );

  // ── Cost per hour ─────────────────────────────────────────────────────────
  panels.push(
    timeSeriesPanel(
      panelId++,
      "Cost per Hour ($)",
      { x: 16, y, w: 8, h: 8 },
      [
        {
          datasource: { type: "grafana-postgresql-datasource", uid: ds },
          format: "currencyUSD",
          rawSql: `SELECT DATE_TRUNC('hour', started_at) AS time, COALESCE(SUM(total_cost_usd), 0) FROM traces.traces WHERE workspace_id = '${workspaceId}' AND started_at >= NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 1`,
          refId: "A",
        },
      ],
    ),
  );
  y += 8;

  // ── Span type breakdown ───────────────────────────────────────────────────
  panels.push(
    textPanel(panelId++, "### Span Analytics", { x: 0, y, w: 24, h: 2 }),
  );
  y += 2;

  panels.push(
    pieChartPanel(
      panelId++,
      "Span Count by Type (7d)",
      { x: 0, y, w: 8, h: 8 },
      [
        {
          datasource: { type: "grafana-postgresql-datasource", uid: ds },
          format: "short",
          rawSql: `SELECT s.type AS metric, COUNT(*) FROM traces.spans s JOIN traces.traces t ON t.id = s.trace_id WHERE t.workspace_id = '${workspaceId}' AND t.started_at >= NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 2 DESC`,
          refId: "A",
        },
      ],
    ),
  );

  panels.push(
    pieChartPanel(
      panelId++,
      "Cost by Span Type (7d)",
      { x: 8, y, w: 8, h: 8 },
      [
        {
          datasource: { type: "grafana-postgresql-datasource", uid: ds },
          format: "currencyUSD",
          rawSql: `SELECT s.type AS metric, COALESCE(SUM(COALESCE(s.cost_usd, 0)), 0) FROM traces.spans s JOIN traces.traces t ON t.id = s.trace_id WHERE t.workspace_id = '${workspaceId}' AND t.started_at >= NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 2 DESC`,
          refId: "A",
        },
      ],
    ),
  );

  panels.push(
    timeSeriesPanel(
      panelId++,
      "Avg Duration by Span Type (ms)",
      { x: 16, y, w: 8, h: 8 },
      [
        {
          datasource: { type: "grafana-postgresql-datasource", uid: ds },
          format: "ms",
          rawSql: `SELECT DATE_TRUNC('hour', t.started_at) AS time, s.type, COALESCE(AVG(s.duration_ms), 0) FROM traces.spans s JOIN traces.traces t ON t.id = s.trace_id WHERE t.workspace_id = '${workspaceId}' AND t.started_at >= NOW() - INTERVAL '7 days' GROUP BY 1, 2 ORDER BY 1, 2`,
          refId: "A",
        },
      ],
    ),
  );
  y += 8;

  // ── LLM-specific panels ───────────────────────────────────────────────────
  panels.push(
    textPanel(panelId++, "### LLM Span Details", { x: 0, y, w: 24, h: 2 }),
  );
  y += 2;

  panels.push(
    statPanel(panelId++, "LLM Spans (7d)", { x: 0, y, w: 4, h: 4 }, [
      {
        datasource: { type: "grafana-postgresql-datasource", uid: ds },
        format: "short",
        rawSql: `SELECT COUNT(*) FROM traces.spans s JOIN traces.traces t ON t.id = s.trace_id WHERE t.workspace_id = '${workspaceId}' AND s.type = 'llm' AND t.started_at >= NOW() - INTERVAL '7 days'`,
        refId: "A",
      },
    ]),
  );

  panels.push(
    statPanel(panelId++, "Total Tokens In (7d)", { x: 4, y, w: 4, h: 4 }, [
      {
        datasource: { type: "grafana-postgresql-datasource", uid: ds },
        format: "short",
        rawSql: `SELECT COALESCE(SUM(COALESCE(s.tokens_in, 0)), 0) FROM traces.spans s JOIN traces.traces t ON t.id = s.trace_id WHERE t.workspace_id = '${workspaceId}' AND s.type = 'llm' AND t.started_at >= NOW() - INTERVAL '7 days'`,
        refId: "A",
      },
    ]),
  );

  panels.push(
    statPanel(panelId++, "Total Tokens Out (7d)", { x: 8, y, w: 4, h: 4 }, [
      {
        datasource: { type: "grafana-postgresql-datasource", uid: ds },
        format: "short",
        rawSql: `SELECT COALESCE(SUM(COALESCE(s.tokens_out, 0)), 0) FROM traces.spans s JOIN traces.traces t ON t.id = s.trace_id WHERE t.workspace_id = '${workspaceId}' AND s.type = 'llm' AND t.started_at >= NOW() - INTERVAL '7 days'`,
        refId: "A",
      },
    ]),
  );

  panels.push(
    statPanel(panelId++, "LLM Cost (7d)", { x: 12, y, w: 4, h: 4 }, [
      {
        datasource: { type: "grafana-postgresql-datasource", uid: ds },
        format: "currencyUSD",
        rawSql: `SELECT COALESCE(SUM(COALESCE(s.cost_usd, 0)), 0) FROM traces.spans s JOIN traces.traces t ON t.id = s.trace_id WHERE t.workspace_id = '${workspaceId}' AND s.type = 'llm' AND t.started_at >= NOW() - INTERVAL '7 days'`,
        refId: "A",
      },
    ]),
  );

  panels.push(
    statPanel(panelId++, "Avg LLM Latency (ms, 7d)", { x: 16, y, w: 4, h: 4 }, [
      {
        datasource: { type: "grafana-postgresql-datasource", uid: ds },
        format: "ms",
        rawSql: `SELECT COALESCE(AVG(s.duration_ms), 0) FROM traces.spans s JOIN traces.traces t ON t.id = s.trace_id WHERE t.workspace_id = '${workspaceId}' AND s.type = 'llm' AND t.started_at >= NOW() - INTERVAL '7 days'`,
        refId: "A",
      },
    ]),
  );

  y += 4;

  // ── Token usage over time ─────────────────────────────────────────────────
  panels.push(
    timeSeriesPanel(
      panelId++,
      "Token Usage Over Time",
      { x: 0, y, w: 12, h: 8 },
      [
        {
          datasource: { type: "grafana-postgresql-datasource", uid: ds },
          format: "short",
          rawSql: `SELECT DATE_TRUNC('hour', t.started_at) AS time, 'tokens_in' AS metric, COALESCE(SUM(COALESCE(s.tokens_in, 0)), 0) FROM traces.spans s JOIN traces.traces t ON t.id = s.trace_id WHERE t.workspace_id = '${workspaceId}' AND s.type = 'llm' AND t.started_at >= NOW() - INTERVAL '7 days' GROUP BY 1 UNION ALL SELECT DATE_TRUNC('hour', t.started_at) AS time, 'tokens_out' AS metric, COALESCE(SUM(COALESCE(s.tokens_out, 0)), 0) FROM traces.spans s JOIN traces.traces t ON t.id = s.trace_id WHERE t.workspace_id = '${workspaceId}' AND s.type = 'llm' AND t.started_at >= NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 1`,
          refId: "A",
        },
      ],
    ),
  );

  panels.push(
    timeSeriesPanel(
      panelId++,
      "LLM Cost Over Time",
      { x: 12, y, w: 12, h: 8 },
      [
        {
          datasource: { type: "grafana-postgresql-datasource", uid: ds },
          format: "currencyUSD",
          rawSql: `SELECT DATE_TRUNC('hour', t.started_at) AS time, COALESCE(SUM(COALESCE(s.cost_usd, 0)), 0) FROM traces.spans s JOIN traces.traces t ON t.id = s.trace_id WHERE t.workspace_id = '${workspaceId}' AND s.type = 'llm' AND t.started_at >= NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 1`,
          refId: "A",
        },
      ],
    ),
  );
  y += 8;

  // ── Top errors table ──────────────────────────────────────────────────────
  panels.push(
    textPanel(panelId++, "### Top Errors", { x: 0, y, w: 24, h: 2 }),
  );
  y += 2;

  panels.push(
    tablePanel(
      panelId++,
      "Top 10 Errors (7d)",
      { x: 0, y, w: 24, h: 8 },
      [
        {
          datasource: { type: "grafana-postgresql-datasource", uid: ds },
          format: "table",
          rawSql: `SELECT error AS Error, COUNT(*) AS Count FROM traces.traces WHERE workspace_id = '${workspaceId}' AND error IS NOT NULL AND started_at >= NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
          refId: "A",
        },
      ],
    ),
  );
  y += 8;

  // ── Slowest spans table ───────────────────────────────────────────────────
  panels.push(
    textPanel(panelId++, "### Slowest Spans", { x: 0, y, w: 24, h: 2 }),
  );
  y += 2;

  panels.push(
    tablePanel(
      panelId++,
      "Top 10 Slowest Spans (7d)",
      { x: 0, y, w: 24, h: 8 },
      [
        {
          datasource: { type: "grafana-postgresql-datasource", uid: ds },
          format: "table",
          rawSql: `SELECT s.name AS "Span Name", s.type AS "Type", s.duration_ms AS "Duration (ms)", COALESCE(s.cost_usd, 0)::numeric AS "Cost ($)", s.status AS "Status", t.started_at AS "Started At" FROM traces.spans s JOIN traces.traces t ON t.id = s.trace_id WHERE t.workspace_id = '${workspaceId}' AND t.started_at >= NOW() - INTERVAL '7 days' ORDER BY s.duration_ms DESC NULLS LAST LIMIT 10`,
          refId: "A",
        },
      ],
    ),
  );

  return {
    annotations: { list: [] },
    description: `Hasna trace dashboard for workspace ${workspaceId}`,
    editable: true,
    fiscalYearStartMonth: 0,
    graphTooltip: 1,
    id: null,
    links: [],
    panels,
    refresh,
    schemaVersion: 38,
    style: "dark",
    tags: ["hasna", "traces", "llm"],
    templating: {
      list: [
        {
          current: { text: "traces-ds", value: "traces-ds" },
          description: "PostgreSQL datasource for traces",
          name: "datasource",
          query: "postgres",
          refresh: 1,
          type: "datasource",
        },
      ],
    },
    time: { from: "now-7d", to: "now" },
    timepicker: {},
    timezone: "browser",
    title,
    uid,
    version: 0,
    variables: { list: [] },
  };
}
