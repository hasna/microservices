  // Trace analytics handlers
  if (name === "traces_latency_percentiles") {
    return text(await getTraceLatencyPercentiles(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  if (name === "traces_error_rate_timeline") {
    return text(await getErrorRateTimeline(
      sql,
      String(a.workspace_id),
      {
        since: a.since ? new Date(String(a.since)) : undefined,
        bucketMinutes: a.bucket_minutes ? Number(a.bucket_minutes) : undefined,
      },
    ));
  }

  if (name === "traces_latency_histogram") {
    return text(await getTraceDurationHistogram(
      sql,
      String(a.workspace_id),
      {
        since: a.since ? new Date(String(a.since)) : undefined,
        bucketCount: a.bucket_count ? Number(a.bucket_count) : undefined,
      },
    ));
  }

  if (name === "traces_flame_graph") {
    const result = await buildTraceFlameGraph(sql, String(a.trace_id));
    if (!result) return text({ error: "Trace not found" });
    return text(result);
  }

  if (name === "traces_time_series") {
    return text(await getTraceTimeSeries(
      sql,
      String(a.workspace_id),
      {
        since: a.since ? new Date(String(a.since)) : undefined,
        bucketMinutes: a.bucket_minutes ? Number(a.bucket_minutes) : undefined,
      },
    ));
  }

