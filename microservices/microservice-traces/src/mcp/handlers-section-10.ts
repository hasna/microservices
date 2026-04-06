  // Anomaly detection handlers
  if (name === "traces_refresh_anomaly_baselines") {
    await refreshAllBaselines(sql, String(a.workspace_id));
    return text({ ok: true, message: "Baselines refreshed for all span types" });
  }

  if (name === "traces_detect_anomalies") {
    return text(await detectSpanAnomalies(
      sql,
      String(a.workspace_id),
      {
        since: a.since ? new Date(String(a.since)) : undefined,
        minScore: a.min_score ? Number(a.min_score) : undefined,
        spanTypes: a.span_types,
        limit: a.limit ? Number(a.limit) : undefined,
      },
    ));
  }

  if (name === "traces_anomaly_summary") {
    return text(await getAnomalySummary(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

