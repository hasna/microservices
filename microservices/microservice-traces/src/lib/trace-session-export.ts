/**
 * Trace session export — bundles a set of related traces into a self-contained
 * debugging package that can be shared or analyzed offline.
 *
 * Includes: trace tree, spans, tags, metadata, environment snapshot,
 * and optional prompt/response pairs for LLM spans.
 */

import type { Sql } from "postgres";
import { buildSpanTree, getTraceTree } from "./query.js";
import type { SpanWithChildren } from "./query.js";
import type { WorkspaceAnalytics } from "./analytics.js";
import { getWorkspaceAnalytics } from "./analytics.js";
import type { TraceWithSpans } from "./query.js";

export interface TraceSessionExport {
  version: string;
  exported_at: string;
  workspace_id: string;
  session_id: string;
  description: string;
  time_range: {
    start: string;
    end: string;
  };
  environment: {
    service_name: string;
    service_version: string;
    deployment_id: string | null;
    region: string | null;
    environment: string | null;
  };
  statistics: {
    total_traces: number;
    total_spans: number;
    error_traces: number;
    total_cost_usd: number;
    total_tokens_in: number;
    total_tokens_out: number;
  };
  traces: TraceExport[];
  metadata: Record<string, string>;
}

export interface TraceExport {
  trace_id: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  status: "ok" | "error";
  error_message: string | null;
  workspace_id: string;
  user_id: string | null;
  span_count: number;
  spans: SpanExport[];
  flame_graph: FlameGraphNodeExport | null;
}

export interface SpanExport {
  span_id: string;
  parent_span_id: string | null;
  name: string;
  type: string;
  status: "ok" | "error";
  error_message: string | null;
  started_at: string;
  duration_ms: number;
  started_at_abs: string;
  tags: Record<string, string>;
  input: string | null;
  output: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
}

export interface FlameGraphNodeExport {
  name: string;
  value: number; // duration_ms
  count: number;
  type: string;
  children?: FlameGraphNodeExport[];
}

/**
 * Build a flame graph from a span tree (recursive).
 */
function buildFlameGraph(node: SpanWithChildren): FlameGraphNodeExport {
  return {
    name: node.name,
    value: Number(node.duration_ms),
    count: 1,
    type: node.type,
    children: node.children.length > 0
      ? node.children.map(buildFlameGraph)
      : undefined,
  };
}

/**
 * Convert a span to export format.
 */
function exportSpan(span: any): SpanExport {
  return {
    span_id: span.id,
    parent_span_id: span.parent_span_id ?? null,
    name: span.name,
    type: span.type,
    status: span.status === "error" ? "error" : "ok",
    error_message: span.error_message ?? null,
    started_at: span.started_at?.toISOString() ?? "",
    duration_ms: Number(span.duration_ms ?? 0),
    started_at_abs: span.started_at_abs ?? span.started_at?.toISOString() ?? "",
    tags: span.tags ?? {},
    input: span.input ?? null,
    output: span.output ?? null,
    model: span.model ?? null,
    tokens_in: span.tokens_in ?? null,
    tokens_out: span.tokens_out ?? null,
    cost_usd: span.cost_usd ?? null,
  };
}

/**
 * Export a session: a set of traces for a workspace within a time range.
 */
export async function exportTraceSession(
  sql: Sql,
  workspaceId: string,
  opts: {
    sessionId?: string;
    description?: string;
    timeStart?: Date;
    timeEnd?: Date;
    traceIds?: string[];
    maxTraces?: number;
    includeEnvironment?: boolean;
  } = {},
): Promise<TraceSessionExport> {
  const {
    sessionId = crypto.randomUUID(),
    description = "",
    timeStart = new Date(Date.now() - 60 * 60 * 1000), // last hour
    timeEnd = new Date(),
    traceIds,
    maxTraces = 100,
    includeEnvironment = true,
  } = opts;

  // Get trace IDs
  let query;
  if (traceIds && traceIds.length > 0) {
    query = sql<{ id: string; started_at: Date; completed_at: Date | null; duration_ms: number; status: string; workspace_id: string; user_id: string | null }[]>`
      SELECT t.id, t.started_at, t.completed_at, t.duration_ms, t.status, t.workspace_id, t.user_id
      FROM traces.traces t
      WHERE t.workspace_id = ${workspaceId}
        AND t.id = ANY(${traceIds})
      ORDER BY t.started_at DESC
      LIMIT ${maxTraces}
    `;
  } else {
    query = sql<{ id: string; started_at: Date; completed_at: Date | null; duration_ms: number; status: string; workspace_id: string; user_id: string | null }[]>`
      SELECT t.id, t.started_at, t.completed_at, t.duration_ms, t.status, t.workspace_id, t.user_id
      FROM traces.traces t
      WHERE t.workspace_id = ${workspaceId}
        AND t.started_at >= ${timeStart}
        AND t.started_at <= ${timeEnd}
      ORDER BY t.started_at DESC
      LIMIT ${maxTraces}
    `;
  }

  const traceRows = await query;

  // Get workspace environment info if requested
  let environment = {
    service_name: "unknown",
    service_version: "unknown",
    deployment_id: null as string | null,
    region: null as string | null,
    environment: null as string | null,
  };

  if (includeEnvironment) {
    const [envRow] = await sql<{ service_name: string; service_version: string; deployment_id: string | null; region: string | null; environment: string | null }[]>`
      SELECT
        COALESCE(MAX((tags->>'service.name')), 'unknown') AS service_name,
        COALESCE(MAX((tags->>'service.version')), 'unknown') AS service_version,
        MAX((tags->>'deployment.id')) AS deployment_id,
        MAX((tags->>'cloud.region' )) AS region,
        MAX((tags->>'deployment.environment')) AS environment
      FROM traces.traces
      WHERE workspace_id = ${workspaceId}
        AND tags ? 'service.name'
    `;
    if (envRow) {
      environment = {
        service_name: envRow.service_name,
        service_version: envRow.service_version,
        deployment_id: envRow.deployment_id,
        region: envRow.region,
        environment: envRow.environment,
      };
    }
  }

  // Get overall statistics
  const stats = await getWorkspaceAnalytics(sql, workspaceId, {
    periodStart: timeStart,
    periodEnd: timeEnd,
  });

  // Build trace exports
  const traces: TraceExport[] = [];

  for (const traceRow of traceRows) {
    const traceTree = await getTraceTree(sql, traceRow.id);
    const tree = traceTree?.spans ?? [];

    // Flatten spans for export
    function flattenSpans(nodes: SpanWithChildren[]): any[] {
      const result: any[] = [];
      for (const node of nodes) {
        result.push({
          id: node.id,
          name: node.name,
          type: node.type,
          status: node.status,
          error_message: node.error_message,
          duration_ms: node.duration_ms,
          started_at: node.started_at,
          started_at_abs: node.started_at_abs,
          parent_span_id: node.parent_span_id,
          tags: node.tags,
          input: node.input,
          output: node.output,
          model: node.model,
          tokens_in: node.tokens_in,
          tokens_out: node.tokens_out,
          cost_usd: node.cost_usd,
        });
        if (node.children.length > 0) {
          result.push(...flattenSpans(node.children));
        }
      }
      return result;
    }

    const flatSpans = flattenSpans(tree);

    // Build flame graph from tree
    const flameGraph = tree.length > 0 ? buildFlameGraph(tree[0]) : null;

    traces.push({
      trace_id: traceRow.id,
      started_at: traceRow.started_at?.toISOString() ?? "",
      completed_at: traceRow.completed_at?.toISOString() ?? "",
      duration_ms: Number(traceRow.duration_ms ?? 0),
      status: traceRow.status === "error" ? "error" : "ok",
      error_message: null,
      workspace_id: traceRow.workspace_id,
      user_id: traceRow.user_id,
      span_count: flatSpans.length,
      spans: flatSpans.map(exportSpan),
      flame_graph: flameGraph,
    });
  }

  return {
    version: "1.0.0",
    exported_at: new Date().toISOString(),
    workspace_id: workspaceId,
    session_id: sessionId,
    description,
    time_range: {
      start: timeStart.toISOString(),
      end: timeEnd.toISOString(),
    },
    environment,
    statistics: {
      total_traces: stats.total_traces,
      total_spans: traces.reduce((sum, t) => sum + t.span_count, 0),
      error_traces: stats.error_traces,
      total_cost_usd: Number(stats.total_cost_usd),
      total_tokens_in: stats.total_tokens_in,
      total_tokens_out: stats.total_tokens_out,
    },
    traces,
    metadata: {
      exporter: "microservice-traces",
      format_version: "1.0.0",
    },
  };
}

/**
 * Export a single trace as a compact JSON for quick sharing.
 */
export async function exportSingleTrace(
  sql: Sql,
  traceId: string,
): Promise<TraceExport | null> {
  const [traceRow] = await sql<{ id: string; started_at: Date; completed_at: Date | null; duration_ms: number; status: string; workspace_id: string; user_id: string | null }[]>`
    SELECT t.id, t.started_at, t.completed_at, t.duration_ms, t.status, t.workspace_id, t.user_id
    FROM traces.traces t
    WHERE t.id = ${traceId}
  `;

  if (!traceRow) return null;

  const traceTree = await getTraceTree(sql, traceId);
  const tree = traceTree?.spans ?? [];

  function flattenSpans(nodes: SpanWithChildren[]): any[] {
    const result: any[] = [];
    for (const node of nodes) {
      result.push({
        id: node.id,
        name: node.name,
        type: node.type,
        status: node.status,
        error_message: node.error_message,
        duration_ms: node.duration_ms,
        started_at: node.started_at,
        started_at_abs: node.started_at_abs,
        parent_span_id: node.parent_span_id,
        tags: node.tags,
        input: node.input,
        output: node.output,
        model: node.model,
        tokens_in: node.tokens_in,
        tokens_out: node.tokens_out,
        cost_usd: node.cost_usd,
      });
      if (node.children.length > 0) {
        result.push(...flattenSpans(node.children));
      }
    }
    return result;
  }

  const flatSpans = flattenSpans(tree);
  const flameGraph = tree.length > 0 ? buildFlameGraph(tree[0]) : null;

  return {
    trace_id: traceRow.id,
    started_at: traceRow.started_at?.toISOString() ?? "",
    completed_at: traceRow.completed_at?.toISOString() ?? "",
    duration_ms: Number(traceRow.duration_ms ?? 0),
    status: traceRow.status === "error" ? "error" : "ok",
    error_message: null,
    workspace_id: traceRow.workspace_id,
    user_id: traceRow.user_id,
    span_count: flatSpans.length,
    spans: flatSpans.map(exportSpan),
    flame_graph: flameGraph,
  };
}

/**
 * Export a single trace as a self-contained HTML page for human-readable debugging.
 * Includes a waterfall timeline, span table, and flame graph visualization.
 */
export async function exportTraceAsHTML(
  sql: Sql,
  traceId: string,
): Promise<string | null> {
  const export_ = await exportSingleTrace(sql, traceId);
  if (!export_) return null;

  const spansJson = JSON.stringify(export_.spans);
  const flameGraphJson = JSON.stringify(export_.flame_graph);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Trace ${export_.trace_id} | microservice-traces</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e6edf3; padding: 24px; }
    h1, h2, h3 { color: #58a6ff; }
    .header { margin-bottom: 24px; border-bottom: 1px solid #30363d; padding-bottom: 16px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .badge-ok { background: #238636; color: #fff; }
    .badge-error { background: #da3633; color: #fff; }
    .stats { display: flex; gap: 24px; margin: 16px 0; flex-wrap: wrap; }
    .stat { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px 16px; }
    .stat-label { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 20px; font-weight: 600; margin-top: 4px; }
    .section { margin: 24px 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #30363d; }
    th { background: #161b22; color: #8b949e; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    tr:hover { background: #161b22; }
    .mono { font-family: 'SF Mono', Monaco, monospace; font-size: 13px; }
    .waterfall { display: flex; flex-direction: column; gap: 2px; }
    .waterfall-row { display: flex; align-items: center; gap: 8px; height: 24px; }
    .waterfall-bar { height: 100%; border-radius: 2px; min-width: 2px; }
    .waterfall-label { width: 200px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .waterfall-time { font-size: 11px; color: #8b949e; width: 80px; text-align: right; }
    .type-badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: #30363d; color: #8b949e; }
    .type-llm { background: #1f3a8f; color: #a5d6ff; }
    .type-embed { background: #3d2e00; color: #ffd866; }
    .type-tool { background: #1f4a3e; color: #7ee787; }
    .type-retrieval { background: #4a1942; color: #f778ba; }
    .type-unknown { background: #30363d; color: #8b949e; }
    .error-msg { color: #f85149; font-size: 12px; margin-top: 4px; }
    #flamegraph { height: 300px; overflow: auto; background: #161b22; border-radius: 6px; padding: 8px; }
    .fg-bar { height: 20px; display: flex; align-items: center; padding: 0 4px; border-radius: 2px; margin: 1px 0; font-size: 11px; color: #fff; min-width: 2px; cursor: default; }
    .tab-bar { display: flex; gap: 4px; margin-bottom: 16px; }
    .tab { padding: 8px 16px; background: #161b22; border: 1px solid #30363d; border-radius: 6px 6px 0 0; cursor: pointer; font-size: 13px; }
    .tab.active { background: #1c2128; border-bottom: 1px solid #1c2128; color: #58a6ff; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Trace ${export_.trace_id.slice(0, 8)}</h1>
    <span class="badge ${export_.status === 'ok' ? 'badge-ok' : 'badge-error'}">${export_.status.toUpperCase()}</span>
    <div class="stats">
      <div class="stat"><div class="stat-label">Duration</div><div class="stat-value">${export_.duration_ms}ms</div></div>
      <div class="stat"><div class="stat-label">Spans</div><div class="stat-value">${export_.span_count}</div></div>
      <div class="stat"><div class="stat-label">Started</div><div class="stat-value" style="font-size:14px">${new Date(export_.started_at).toLocaleString()}</div></div>
      ${export_.status === 'error' && export_.error_message ? `<div class="stat"><div class="stat-label">Error</div><div class="stat-value" style="color:#f85149">${export_.error_message}</div></div>` : ''}
    </div>
  </div>

  <div class="tab-bar">
    <div class="tab active" onclick="showTab('waterfall')">Waterfall</div>
    <div class="tab" onclick="showTab('table')">Table</div>
    <div class="tab" onclick="showTab('flamegraph')">Flame Graph</div>
  </div>

  <div id="tab-waterfall" class="tab-content active">
    <div class="waterfall" id="waterfall"></div>
  </div>

  <div id="tab-table" class="tab-content">
    <table>
      <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Duration</th><th>Started</th><th>Error</th></tr></thead>
      <tbody id="span-table"></tbody>
    </table>
  </div>

  <div id="tab-flamegraph" class="tab-content">
    <div id="flamegraph"></div>
  </div>

<script>
const spans = ${spansJson};
const flameGraph = ${flameGraphJson};
const totalMs = ${export_.duration_ms};

function typeClass(t) {
  return 'type-badge type-' + (t || 'unknown');
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelector('.tab[onclick*=' + name + ']').classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}

// Waterfall
const waterfall = document.getElementById('waterfall');
const traceStart = spans.length > 0 ? new Date(spans[0].started_at).getTime() : 0;
spans.forEach(span => {
  const startOffset = traceStart ? new Date(span.started_at).getTime() - traceStart : 0;
  const width = span.duration_ms ? Math.max(2, (span.duration_ms / totalMs) * 100) : 2;
  const color = span.status === 'error' ? '#da3633' : span.type === 'llm' ? '#58a6ff' : span.type === 'embed' ? '#ffd866' : span.type === 'tool' ? '#7ee787' : '#8b949e';
  const row = document.createElement('div');
  row.className = 'waterfall-row';
  row.innerHTML = \`
    <div class="waterfall-label" title="\${span.name}">\${span.name}</div>
    <div class="waterfall-bar" style="width:\${width}%;background:\${color}" title="\${span.duration_ms}ms"></div>
    <div class="waterfall-time">\${span.duration_ms}ms</div>
    <span class="\${typeClass(span.type)}">\${span.type || 'unknown'}</span>
    \${span.error_message ? '<div class="error-msg">⚠ ' + span.error_message + '</div>' : ''}
  \`;
  waterfall.appendChild(row);
});

// Table
const tbody = document.getElementById('span-table');
spans.forEach(span => {
  const tr = document.createElement('tr');
  tr.innerHTML = \`
    <td class="mono">\${span.name}</td>
    <td><span class="\${typeClass(span.type)}">\${span.type || 'unknown'}</span></td>
    <td>\${span.status}</td>
    <td>\${span.duration_ms}ms</td>
    <td class="mono">\${new Date(span.started_at).toLocaleTimeString()}</td>
    <td class="mono" style="color:\${span.error_message ? '#f85149' : 'inherit'}">\${span.error_message || '-'}</td>
  \`;
  tbody.appendChild(tr);
});

// Flame graph
const fg = document.getElementById('flamegraph');
function renderFlame(node, depth) {
  if (!node) return;
  const width = node.value ? Math.max(2, (node.value / totalMs) * 100) : 2;
  const color = node.type === 'llm' ? '#58a6ff' : node.type === 'embed' ? '#ffd866' : node.type === 'tool' ? '#7ee787' : '#8b949e';
  const bar = document.createElement('div');
  bar.className = 'fg-bar';
  bar.style.width = width + '%';
  bar.style.background = color;
  bar.style.marginLeft = (depth * 12) + 'px';
  bar.title = node.name + ' (' + node.value + 'ms, ' + node.count + ')';
  bar.textContent = ' ' + node.name + ' ' + node.value + 'ms';
  fg.appendChild(bar);
  if (node.children) node.children.forEach(c => renderFlame(c, depth + 1));
}
if (flameGraph && flameGraph.nodes && flameGraph.nodes.length > 0) {
  flameGraph.nodes.forEach(n => renderFlame(n, 0));
} else {
  fg.innerHTML = '<p style="color:#8b949e;padding:12px">No flame graph data available</p>';
}
</script>
</body>
</html>`;
}
