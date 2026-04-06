// --- Prometheus Metrics tools ---

server.tool(
  "auth_export_prometheus_metrics",
  "Export auth metrics in Prometheus text format",
  {
    workspace_id: z.string().optional(),
    since_hours: z.number().optional().default(1),
  },
  async ({ workspace_id, since_hours }) => {
    const { exportAuthMetrics } = await import("../lib/auth-prometheus-metrics.js");
    const since = new Date(Date.now() - since_hours * 3600_000);
    return text(await exportAuthMetrics(sql, workspace_id, since));
  },
);

server.tool(
  "auth_metrics_json",
  "Export auth metrics as structured JSON",
  {
    workspace_id: z.string().optional(),
    since_hours: z.number().optional().default(1),
  },
  async ({ workspace_id, since_hours }) => {
    const { exportAuthMetricsJSON } = await import("../lib/auth-prometheus-metrics.js");
    const since = new Date(Date.now() - since_hours * 3600_000);
    return text(await exportAuthMetricsJSON(sql, workspace_id, since));
  },
);

