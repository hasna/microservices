  // Datadog export handlers
  if (name === "traces_export_datadog") {
    const { getTrace } = await import("../lib/query.js");
    const trace = await getTrace(sql, String(a.id));
    if (!trace) return text({ error: "Trace not found" });
    const spans = exportTraceAsDatadog(trace, { serviceName: a.service_name ? String(a.service_name) : undefined });
    return text({ trace_id: a.id, spans });
  }

  if (name === "traces_datadog_stats") {
    return text(await getDatadogStatsForWorkspace(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

