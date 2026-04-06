  // Period comparison handlers
  if (name === "traces_compare_periods") {
    return text(await comparePeriods(
      sql,
      String(a.workspace_id),
      new Date(String(a.current_start)),
      new Date(String(a.current_end)),
      new Date(String(a.previous_start)),
      new Date(String(a.previous_end)),
    ));
  }

  if (name === "traces_compare_week_over_week") {
    return text(await compareWeekOverWeek(
      sql,
      String(a.workspace_id),
      a.week_end_date ? new Date(String(a.week_end_date)) : undefined,
    ));
  }

  if (name === "traces_compare_month_over_month") {
    return text(await compareMonthOverMonth(
      sql,
      String(a.workspace_id),
      a.month_end_date ? new Date(String(a.month_end_date)) : undefined,
    ));
  }

  // Trace diff summary
  if (name === "traces_diff_summary") {
    const summary = await getTraceDiffSummary(sql, String(a.trace_id_a), String(a.trace_id_b));
    return text({ summary });
  }

  // Span latency trend
  if (name === "traces_latency_trend") {
    return text(await getSpanLatencyTrend(sql, String(a.workspace_id), {
      intervalMinutes: a.interval_minutes ? Number(a.interval_minutes) : 60,
      periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
      periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
      operationName: a.operation_name ? String(a.operation_name) : undefined,
      spanType: a.span_type ? String(a.span_type) : undefined,
    }));
  }

  // Compare latency between two periods
  if (name === "traces_latency_comparison") {
    return text(await compareLatencyBetweenPeriods(sql, String(a.workspace_id), {
      periodAStart: new Date(String(a.period_a_start)),
      periodAEnd: new Date(String(a.period_a_end)),
      periodBStart: new Date(String(a.period_b_start)),
      periodBEnd: new Date(String(a.period_b_end)),
      operationName: a.operation_name ? String(a.operation_name) : undefined,
      spanType: a.span_type ? String(a.span_type) : undefined,
    }));
  }

  // Export trace as HTML
  if (name === "traces_export_html") {
    const html = await exportTraceAsHTML(sql, String(a.trace_id));
    if (!html) return text({ error: "Trace not found" });
    return text({ html });
  }

  // Sampling — should keep trace
  if (name === "traces_should_keep_trace") {
    const result = await shouldKeepTrace(sql, String(a.workspace_id), String(a.trace_id));
    return text({ should_keep: result });
  }

  // Correlation — get traces by external trace ID
  if (name === "traces_get_by_external_trace_id") {
    const traces = await getTracesByExternalTraceId(sql, String(a.external_trace_id));
    return text({ traces });
  }

  // Retention — delete a retention policy
  if (name === "traces_delete_retention_policy") {
    await deleteRetentionPolicy(sql, String(a.workspace_id), String(a.name));
    return text({ deleted: true });
  }

  // Retention — prune by TTL
  if (name === "traces_prune_by_ttl") {
    const pruned = await pruneByTTL(sql, String(a.workspace_id));
    return text({ pruned });
  }

  // Retention — prune by count
  if (name === "traces_prune_by_count") {
    const pruned = await pruneByCount(sql, String(a.workspace_id), Number(a.keep_count));
    return text({ pruned });
  }

  // Span anomaly — refresh baseline for a span type
  if (name === "traces_refresh_span_baseline") {
    await refreshAnomalyBaseline(sql, String(a.workspace_id), String(a.span_type));
    return text({ refreshed: true });
  }

  // Span anomaly — get baseline for a span type
  if (name === "traces_get_span_type_baseline") {
    const baseline = await getSpanTypeBaseline(sql, String(a.workspace_id), String(a.span_type));
    return text(baseline || { error: "Baseline not found" });
  }

  // Trace analytics — build flame graph from raw spans
  if (name === "traces_build_flame_graph") {
    const graph = await buildFlameGraph(a.spans as any[]);
    return text({ flame_graph: graph });
  }

  // Query — list spans for a trace
  if (name === "traces_list_spans") {
    const spans = await listSpans(sql, String(a.trace_id), {
      type: a.type ? String(a.type) : undefined,
      status: a.status ? String(a.status) : undefined,
    });
    return text({ spans });
  }

  // Query — build a span tree from flat spans
  if (name === "traces_build_span_tree") {
    const tree = buildSpanTree(a.spans as any[]);
    return text({ tree });
  }

  // Analytics — upsert span analytics for a trace
  if (name === "traces_upsert_span_analytics") {
    await upsertSpanAnalytics(sql, String(a.trace_id), String(a.workspace_id));
    return text({ ok: true });
  }

  // Stats — compute error rate percentage (pure function)
  if (name === "traces_compute_error_rate") {
    const rate = computeErrorRate(Number(a.errored), Number(a.total));
    return text({ error_rate_pct: rate });
  }

  // Stats — compute percentile from sorted array (pure function)
  if (name === "traces_compute_percentile") {
    const sorted = (a.sorted as number[]).map(Number);
    const p = Number(a.p);
    const value = computePercentile(sorted, p);
    return text({ percentile: value });
  }

  // Export — export multiple traces as OpenTelemetry batch
  if (name === "traces_export_traces_otel") {
    const { getTrace } = await import("../lib/query.js");
    const traceIds = a.trace_ids ? Array.from(a.trace_ids as any).map(String) : undefined;
    let traces: any[] = [];

    if (traceIds && traceIds.length > 0) {
      for (const id of traceIds) {
        const t = await getTrace(sql, id);
        if (t) traces.push(t);
      }
    } else if (a.since) {
      const since = new Date(String(a.since));
      const allTraces = await listTraces(sql, String(a.workspace_id), { since });
      traces = allTraces;
    } else {
      traces = await listTraces(sql, String(a.workspace_id));
    }

    const otel = exportTracesAsOTel(traces);
    return text({ traces: traces.map(t => t.id), otel });
  }

  // Correlation — get correlation data for a trace
  if (name === "traces_get_correlation") {
    const correlation = await getCorrelation(sql, String(a.trace_id));
    return text(correlation || { error: "Correlation not found" });
  }

  // Dependency matrix — get full dependency matrix as structured JSON
  if (name === "traces_dependency_matrix_json") {
    const periodStart = a.period_start ? new Date(String(a.period_start)) : undefined;
    const periodEnd = a.period_end ? new Date(String(a.period_end)) : undefined;
    const matrix = await getSpanDependencyMatrix(sql, String(a.workspace_id), { periodStart, periodEnd });
    return text(matrix);
  }

  // Dependency matrix — identify bottleneck span types (hotspots)
  if (name === "traces_dependency_hotspot") {
    const periodStart = a.period_start ? new Date(String(a.period_start)) : undefined;
    const periodEnd = a.period_end ? new Date(String(a.period_end)) : undefined;
    const limit = a.limit ? Number(a.limit) : 10;
    const paths = await getHotPaths(sql, String(a.workspace_id), { periodStart, periodEnd, limit });
    // Compute impact score: calls * avg_duration_ms * (1 + error_rate/100)
    const hotspots = paths.map(p => ({
      ...p,
      impact_score: Number(p.call_count) * Number(p.avg_duration_ms) * (1 + Number(p.error_rate) / 100),
    }));
    hotspots.sort((a, b) => b.impact_score - a.impact_score);
    return text(hotspots);
  }

  // Flame graph — build flame graph from a trace ID
  if (name === "traces_flame_graph_for_trace") {
    const flameGraph = await buildTraceFlameGraph(sql, String(a.trace_id));
    if (!flameGraph) return text({ error: "Trace not found" });
    return text(flameGraph);
  }

  // Export — export trace as DOT (Graphviz) format
  if (name === "traces_export_dot") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) return text({ error: "Trace not found" });
    const direction = String(a.direction || "TB");
    const lines: string[] = [
      `digraph trace_${trace.id.replace(/[^a-zA-Z0-9]/g, "_")} {`,
      `  rankdir=${direction};`,
      `  label="Trace: ${trace.name}";`,
      `  labelloc="t";`,
      `  fontsize="14";`,
    ];
    for (const span of trace.spans) {
      const label = `${span.name}\\n(${span.type})\\n${span.duration_ms}ms`;
      const color = span.status === "error" ? "red" : span.status === "completed" ? "green" : "gray";
      lines.push(`  "${span.id}" [label="${label}" color=${color}];`);
    }
    for (const span of trace.spans) {
      if (span.parent_span_id) {
        lines.push(`  "${span.parent_span_id}" -> "${span.id}";`);
      }
    }
    lines.push("}");
    return text(lines.join("\n"));
  }

  // Trace timeline — flat list of spans with timing offsets for UI rendering
  if (name === "traces_get_trace_timeline") {
    const { get_trace_timeline } = await import("../lib/compare.js");
    return text(await get_trace_timeline(sql, String(a.trace_id)));
  }

  // Critical path — longest chain of dependent spans (hot path analysis)
  if (name === "traces_get_critical_path") {
    const { getCriticalPath } = await import("../lib/span-dependency-matrix.js");
    return text(await getCriticalPath(sql, String(a.workspace_id), a.trace_id ? String(a.trace_id) : undefined));
  }

  // Trace export as HTML — self-contained debug page for a single trace
  if (name === "traces_export_trace_as_html") {
    const { exportTraceAsHTML } = await import("../lib/trace-session-export.js");
    return text(await exportTraceAsHTML(sql, String(a.trace_id)));
  }

  // Analytics — full workspace analytics summary
  if (name === "traces_workspace_analytics") {
    return text(await getWorkspaceAnalytics(sql, String(a.workspace_id), {
      periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
      periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
    }));
  }

  // Analytics — cost breakdown by span type
  if (name === "traces_cost_breakdown") {
    return text(await getCostBreakdown(sql, String(a.workspace_id), {
      periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
      periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
    }));
  }

  // Analytics — latency histogram for a span type
  if (name === "traces_latency_histogram_for_type") {
    return text(await getLatencyHistogram(sql, String(a.workspace_id), String(a.span_type), {
      buckets: a.buckets ? Number(a.buckets) : undefined,
      periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
      periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
    }));
  }

  // Comparison — structured trace diff
  if (name === "traces_trace_diff") {
    const { compare_traces } = await import("../lib/compare.js");
    const result = await compare_traces(sql, String(a.trace_id_a), String(a.trace_id_b));
    if (!result) return text({ error: "One or both traces not found" });
    return text(result);
  }

  // Period comparison — arbitrary window comparison (uses existing comparePeriods)
  if (name === "traces_compare_periods") {
    return text(await comparePeriods(
      sql,
      String(a.workspace_id),
      new Date(String(a.current_start)),
      new Date(String(a.current_end)),
      new Date(String(a.previous_start)),
      new Date(String(a.previous_end)),
    ));
  }

  // Export — single trace as OpenTelemetry JSON
  if (name === "traces_export_trace_otel") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) return text({ error: "Trace not found" });
    return text(exportTraceAsOTel(trace));
  }

  // Export — single trace as Zipkin JSON
  if (name === "traces_export_trace_zipkin") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) return text({ error: "Trace not found" });
    return text(exportTraceAsZipkin(trace));
  }

  // Export — single trace as Jaeger JSON
  if (name === "traces_export_trace_jaeger") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) return text({ error: "Trace not found" });
    return text(exportTraceAsJaeger(trace));
  }

  // Export — Grafana dashboard JSON for a workspace
  if (name === "traces_grafana_dashboard_json") {
    return text(generateGrafanaDashboard({
      workspaceId: String(a.workspace_id),
      title: a.title ? String(a.title) : undefined,
      uid: a.uid ? String(a.uid) : undefined,
      refreshInterval: a.refresh_interval ? String(a.refresh_interval) : undefined,
    }));
  }

  // ── Gap tool handlers ────────────────────────────────────────────────────────

  // traces_multi_format_export — export a trace in all formats at once
  if (name === "traces_multi_format_export") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) return text({ error: "Trace not found" });
    const formats: string[] = a.formats ?? ["otlp", "zipkin", "jaeger", "datadog", "html"];
    const result: Record<string, unknown> = {};
    if (formats.includes("otlp")) result.otlp = exportTraceAsOTel(trace);
    if (formats.includes("zipkin")) result.zipkin = exportTraceAsZipkin(trace);
    if (formats.includes("jaeger")) result.jaeger = exportTraceAsJaeger(trace);
    if (formats.includes("datadog")) result.datadog = exportTraceAsDatadog(trace, { serviceName: "hasna-agent" });
    if (formats.includes("html")) {
      const { exportTraceAsHTML } = await import("../lib/trace-session-export.js");
      result.html = await exportTraceAsHTML(sql, String(a.trace_id));
    }
    return text(result);
  }

  // traces_get_trace_events — flat timestamped event sequence for waterfall UIs
  if (name === "traces_get_trace_events") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) return text({ error: "Trace not found" });
    const traceStartMs = new Date(trace.started_at).getTime();
    const events = trace.spans.map((s) => ({
      span_id: s.id,
      parent_span_id: s.parent_span_id,
      name: s.name,
      type: s.type,
      status: s.status,
      start_offset_ms: Math.max(0, new Date(s.started_at).getTime() - traceStartMs),
      end_offset_ms: s.ended_at ? Math.max(0, new Date(s.ended_at).getTime() - traceStartMs) : null,
      duration_ms: s.duration_ms,
      error: s.error ?? null,
      tokens_in: s.tokens_in ?? null,
      tokens_out: s.tokens_out ?? null,
      cost_usd: s.cost_usd ?? null,
    }));
    return text({ trace_id: trace.id, trace_name: trace.name, started_at: trace.started_at, total_events: events.length, events });
  }

  // traces_suggest_retention_policy — heuristic retention suggestion
  if (name === "traces_suggest_retention_policy") {
    const since7d = new Date(Date.now() - 7 * 86400000);
    const [row] = await sql<{ total_traces: string; total_spans: string; avg_spans: string; p95_dur_ms: string; traces_90p: string }[]>`
      SELECT
        COUNT(*)::text AS total_traces,
        COALESCE(SUM(s.count), 0)::text AS total_spans,
        ROUND(AVG(s.count)::numeric, 1) AS avg_spans,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY t.total_duration_ms) AS p95_dur_ms,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY t.started_at) AS traces_90p
      FROM traces.traces t
      LEFT JOIN LATERAL (SELECT COUNT(*) AS count FROM traces.spans sp WHERE sp.trace_id = t.id) s ON true
      WHERE t.workspace_id = ${String(a.workspace_id)} AND t.started_at >= ${since7d}
    `;
    const targetGb = Number(a.target_storage_gb ?? 10);
    const traceCount = parseInt(row?.total_traces ?? "0", 10);
    const avgSpans = parseFloat(row?.avg_spans ?? "0");
    // Estimate ~2KB per span, ~500B per trace header
    const bytesPerSpan = 2 * 1024;
    const bytesPerTrace = 512;
    const estimatedGbPerDay = (traceCount * (avgSpans * bytesPerSpan + bytesPerTrace)) / (1024 ** 3);
    // Conservative: keep 30 days if < 5GB/mo, else 7 days
    const suggested_ttl_days = estimatedGbPerDay * 30 < targetGb ? 30 : 7;
    // Suggest max_count = traces_per_day * suggested_ttl_days * 1.5 (safety margin)
    const tracesPerDay = traceCount / 7;
    const suggested_max_count = Math.round(tracesPerDay * suggested_ttl_days * 1.5);
    return text({
      workspace_id: a.workspace_id,
      analysis_period_days: 7,
      estimated_traces_per_day: Math.round(tracesPerDay * 10) / 10,
      estimated_storage_gb_per_month: Math.round(estimatedGbPerDay * 30 * 100) / 100,
      suggested_ttl_days,
      suggested_max_count,
      target_storage_gb: targetGb,
      rationale: estimatedGbPerDay * 30 < targetGb
        ? `Your ~${Math.round(estimatedGbPerDay * 30 * 100) / 100} GB/mo usage is within ${targetGb} GB budget — recommend 30-day TTL`
        : `Your ~${Math.round(estimatedGbPerDay * 30 * 100) / 100} GB/mo exceeds ${targetGb} GB budget — recommend 7-day TTL or reduce max_count`,
    });
  }

  // traces_detect_span_gaps — orphaned child spans with missing parents
  if (name === "traces_detect_span_gaps") {
    const since = a.since ? new Date(String(a.since)) : new Date(Date.now() - 24 * 3600000);
    const limit = Number(a.limit ?? 50);
    const gaps = await sql<any[]>`
      SELECT
        s.id AS child_span_id,
        s.trace_id,
        s.name AS child_name,
        s.type AS child_type,
        s.parent_span_id AS missing_parent_id,
        s.started_at
      FROM traces.spans s
      JOIN traces.traces t ON t.id = s.trace_id
      WHERE t.workspace_id = ${String(a.workspace_id)}
        AND t.started_at >= ${since}
        AND s.parent_span_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM traces.spans p WHERE p.id = s.parent_span_id AND p.trace_id = s.trace_id
        )
      ORDER BY s.started_at DESC
      LIMIT ${limit}
    `;
    return text({
      workspace_id: a.workspace_id,
      period_start: since.toISOString(),
      gaps_found: gaps.length,
      gaps: gaps.map(g => ({
        child_span_id: g.child_span_id,
        trace_id: g.trace_id,
        child_name: g.child_name,
        child_type: g.child_type,
        missing_parent_id: g.missing_parent_id,
        started_at: g.started_at,
      })),
    });
  }

  // traces_span_type_summary — lightweight span type overview
  if (name === "traces_span_type_summary") {
    const since = a.since ? new Date(String(a.since)) : new Date(Date.now() - 24 * 3600000);
    const rows = await sql<any[]>`
      SELECT
        s.type,
        COUNT(*)::int AS total_spans,
        COUNT(*) FILTER (WHERE s.status = 'error')::int AS error_count,
        ROUND(COUNT(*) FILTER (WHERE s.status = 'error')::numeric / NULLIF(COUNT(*), 0) * 100, 2) AS error_rate,
        COALESCE(SUM(s.tokens_in), 0)::bigint AS total_tokens_in,
        COALESCE(SUM(s.tokens_out), 0)::bigint AS total_tokens_out,
        ROUND(COALESCE(AVG(s.duration_ms), 0)::numeric, 2) AS avg_duration_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.duration_ms) AS p95_duration_ms
      FROM traces.spans s
      JOIN traces.traces t ON t.id = s.trace_id
      WHERE t.workspace_id = ${String(a.workspace_id)} AND t.started_at >= ${since}
      GROUP BY s.type
      ORDER BY total_spans DESC
    `;
    return text({
      workspace_id: a.workspace_id,
      period_start: since.toISOString(),
      summary: rows.map(r => ({
        span_type: r.type,
        total_spans: r.total_spans,
        error_count: r.error_count,
        error_rate_pct: parseFloat(r.error_rate),
        total_tokens_in: Number(r.total_tokens_in),
        total_tokens_out: Number(r.total_tokens_out),
        avg_duration_ms: parseFloat(r.avg_duration_ms),
        p95_duration_ms: parseFloat(r.p95_duration_ms),
      })),
    });
  }

  // traces_ingest_otlp — ingest traces from external OTel agents
  if (name === "traces_ingest_otlp") {
    const result = await ingestOtelTraces(sql, String(a.workspace_id), a.otlp_json);
    return text(result);
  }

  // traces_export_flame_speedscope — export flame graph as Speedscope JSON
  if (name === "traces_export_flame_speedscope") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) throw new Error(`Trace not found: ${a.trace_id}`);
    const tree = await getTraceTree(sql, String(a.workspace_id), String(a.trace_id));
    const profile = exportTraceFlameGraphAsSpeedscope(tree);
    return text({ format: "speedscope", trace_id: a.trace_id, profile });
  }

  // traces_export_flame_collapsed_stack — export flame graph as collapsed stack format
  if (name === "traces_export_flame_collapsed_stack") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) throw new Error(`Trace not found: ${a.trace_id}`);
    const tree = await getTraceTree(sql, String(a.workspace_id), String(a.trace_id));
    const lines = exportFlameGraphAsCollapsedStack(tree, a.value_field || "duration_ms");
    return text({ format: "collapsed_stack", trace_id: a.trace_id, lines });
  }

  // traces_analyze_root_cause — AI-powered root cause analysis
  if (name === "traces_analyze_root_cause") {
    const result = await analyzeTraceRootCause(sql, String(a.trace_id), String(a.workspace_id));
    return text(result);
  }

  // traces_explain_anomaly — explain why a trace is anomalous
  if (name === "traces_explain_anomaly") {
    const result = await explainTraceAnomaly(sql, String(a.trace_id), String(a.workspace_id), a.baseline_hours || 24);
    return text(result);
  }

  // traces_self_healing_suggestions — get configuration improvement suggestions
  if (name === "traces_self_healing_suggestions") {
    const suggestions = await getTraceSelfHealingSuggestions(sql, String(a.trace_id), String(a.workspace_id));
    return text({ trace_id: a.trace_id, suggestions });
  }

  // traces_compare_multi — compare stats across multiple workspaces
  if (name === "traces_compare_multi") {
    const ids = (a.workspace_ids as string[]).slice(0, 10);
    const fromDate = a.from_date ? new Date(a.from_date) : new Date(Date.now() - 7 * 86400000);
    const toDate = a.to_date ? new Date(a.to_date) : new Date();
    const results = await Promise.all(ids.map(async (wid) => {
      const stats = await getTraceStats(sql, wid, fromDate);
      return { workspace_id: wid, ...stats };
    }));
    return text({ workspaces: results, from: fromDate.toISOString(), to: toDate.toISOString() });
  }

  // traces_get_traces_by_user — get all traces for a user
  if (name === "traces_get_traces_by_user") {
    const traces = await getTracesByUser(sql, String(a.user_id), a.limit ? Number(a.limit) : 50);
    return text({ user_id: a.user_id, traces });
  }

  // traces_get_traces_by_external_trace_id — get traces by external trace ID
  if (name === "traces_get_traces_by_external_trace_id") {
    const traces = await getTracesByExternalTraceId(sql, String(a.external_trace_id), a.limit ? Number(a.limit) : 50);
    return text({ external_trace_id: a.external_trace_id, traces });
  }

  // traces_get_trace_score — compute health score for a trace
  if (name === "traces_get_trace_score") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) throw new Error(`Trace not found: ${a.trace_id}`);
    const tree = await getTraceTree(sql, String(a.workspace_id), String(a.trace_id));
    const stats = await getTraceStats(sql, String(a.workspace_id), new Date(Date.now() - 7 * 86400000));
    const spanCount = tree ? tree.spans.length : 0;
    const errorCount = trace.error ? 1 : 0;
    // Score components (each 0-25, total 0-100)
    const latencyScore = trace.total_duration_ms && stats.p95_duration_ms
      ? Math.max(0, 25 - ((trace.total_duration_ms / stats.p95_duration_ms) - 1) * 25)
      : 25;
    const errorScore = errorCount === 0 ? 25 : errorCount === 1 ? 10 : 0;
    const costScore = trace.total_cost_usd && stats.avg_cost_usd
      ? Math.max(0, 25 - ((trace.total_cost_usd / Math.max(stats.avg_cost_usd, 0.0001)) - 1) * 25)
      : 25;
    const structureScore = spanCount > 0 && spanCount <= 100 ? 25 : spanCount > 100 ? 15 : 5;
    const total = Math.round(latencyScore + errorScore + costScore + structureScore);
    return text({
      trace_id: a.trace_id,
      score: total,
      grade: total >= 80 ? "healthy" : total >= 50 ? "degraded" : "critical",
      breakdown: { latency: Math.round(latencyScore), error: errorScore, cost: Math.round(costScore), structure: structureScore },
      details: { duration_ms: trace.total_duration_ms, cost_usd: trace.total_cost_usd, span_count: spanCount, is_error: !!trace.error },
    });
  }

  // traces_export_full_bundle — comprehensive debug bundle
  if (name === "traces_export_full_bundle") {
    const trace = await getTrace(sql, String(a.trace_id));
    if (!trace) throw new Error(`Trace not found: ${a.trace_id}`);
    const bundle: any = {
      version: "1.0",
      exported_at: new Date().toISOString(),
      workspace_id: a.workspace_id,
      trace_id: a.trace_id,
      trace: {
        id: trace.id,
        name: trace.name,
        status: trace.status,
        started_at: trace.started_at,
        completed_at: trace.completed_at,
        duration_ms: trace.total_duration_ms,
        error: trace.error,
        total_tokens: trace.total_tokens,
        total_cost_usd: trace.total_cost_usd,
      },
    };
    if (a.include_spans !== false) {
      const tree = await getTraceTree(sql, String(a.workspace_id), String(a.trace_id));
      bundle.spans = tree?.spans ?? [];
      bundle.span_count = tree?.spans.length ?? 0;
    }
    if (a.include_flame_graph !== false) {
      const tree = await getTraceTree(sql, String(a.workspace_id), String(a.trace_id));
      if (tree?.spans) {
        const fg = buildFlameGraph(tree.spans);
        bundle.flame_graph = { nodes: fg, format: "collapsed_stack" };
      }
    }
    return text(bundle);
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  const sql = getDb();
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
