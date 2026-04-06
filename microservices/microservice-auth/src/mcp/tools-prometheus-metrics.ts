// --- Prometheus metrics ---

server.tool(
  "auth_export_prometheus_metrics",
  "Export auth metrics in Prometheus text format",
  {
    workspace_id: z.string().optional(),
    include_histograms: z.boolean().optional().default(true),
  },
  async ({ workspace_id, include_histograms }) =>
    text(await toPrometheusTextFormat(
      await exportAuthMetrics(sql, workspace_id),
      include_histograms,
    )),
);

server.tool(
  "auth_export_metrics_json",
  "Export auth metrics as structured JSON",
  { workspace_id: z.string().optional() },
  async ({ workspace_id }) =>
    text(await exportAuthMetricsJSON(sql, workspace_id)),
);

