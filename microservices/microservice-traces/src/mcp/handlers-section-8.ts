  // Prometheus export handlers
  if (name === "traces_export_prometheus_text") {
    const metrics = await exportPrometheusMetrics(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    );
    return { content: [{ type: "text", text: toPrometheusTextFormat(metrics.metrics) }] };
  }

  if (name === "traces_prometheus_metrics") {
    return text(await exportPrometheusMetrics(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  if (name === "traces_get_count_gauge") {
    return text(await getTraceCountGauge(sql, String(a.workspace_id)));
  }

  if (name === "traces_get_error_rate_gauge") {
    return text(await getErrorRateGauge(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  if (name === "traces_get_span_type_metrics") {
    return text(await getSpanTypeMetrics(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

