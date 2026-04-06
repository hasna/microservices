// --- Prometheus metrics export ---

server.tool(
  "notify_export_prometheus_metrics",
  "Export notify service metrics in Prometheus text format",
  async () => {
    const metrics = getNotifyMetrics();
    return text({ metrics: metrics });
  },
);

server.tool(
  "notify_metrics_json",
  "Export notify service metrics as JSON",
  async () => {
    const metrics = getNotifyMetrics();
    return text({ metrics: metrics });
  },
);

server.tool(
  "notify_export_prometheus_metrics_db",
  "Export notify service metrics in Prometheus text format (fetched from database)",
  async () => text(await exportNotifyMetrics(sql)),
);

server.tool(
  "notify_export_metrics_json_db",
  "Export notify service metrics as JSON (fetched from database)",
  async () => text(await exportNotifyMetricsJSON(sql)),
);

