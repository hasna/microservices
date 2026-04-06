server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const sql = getDb();
  const { name, arguments: args } = req.params;
  const a = args as any;

  const text = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  if (name === "traces_start_trace") {
    return text(
      await startTrace(sql, {
        workspaceId: String(a.workspace_id),
        name: String(a.name),
        input: a.input,
        metadata: a.metadata as any | undefined,
      }),
    );
  }

  if (name === "traces_end_trace") {
    return text(
      await endTrace(sql, String(a.id), {
        status: a.status as "completed" | "error",
        output: a.output,
        error: a.error ? String(a.error) : undefined,
      }),
    );
  }

  if (name === "traces_start_span") {
    return text(
      await startSpan(sql, {
        traceId: String(a.trace_id),
        parentSpanId: a.parent_span_id ? String(a.parent_span_id) : undefined,
        name: String(a.name),
        type: String(a.type) as
          | "llm"
          | "tool"
          | "retrieval"
          | "guardrail"
          | "embedding"
          | "custom",
        input: a.input,
        model: a.model ? String(a.model) : undefined,
        metadata: a.metadata as any | undefined,
      }),
    );
  }

  if (name === "traces_end_span") {
    return text(
      await endSpan(sql, String(a.id), {
        status: a.status as "completed" | "error",
        output: a.output,
        error: a.error ? String(a.error) : undefined,
        tokens_in: a.tokens_in ? Number(a.tokens_in) : undefined,
        tokens_out: a.tokens_out ? Number(a.tokens_out) : undefined,
        cost_usd: a.cost_usd ? Number(a.cost_usd) : undefined,
      }),
    );
  }

  if (name === "traces_get_trace") {
    const trace = await getTrace(sql, String(a.id));
    if (!trace) return text({ error: "Trace not found" });
    return text(trace);
  }

  if (name === "traces_list_traces") {
    return text(
      await listTraces(sql, String(a.workspace_id), {
        status: a.status ? String(a.status) : undefined,
        name: a.name ? String(a.name) : undefined,
        since: a.since ? new Date(String(a.since)) : undefined,
        until: a.until ? new Date(String(a.until)) : undefined,
        limit: a.limit ? Number(a.limit) : undefined,
        offset: a.offset ? Number(a.offset) : undefined,
      }),
    );
  }

  if (name === "traces_get_stats") {
    return text(
      await getTraceStats(
        sql,
        String(a.workspace_id),
        a.since ? new Date(String(a.since)) : undefined,
      ),
    );
  }

  if (name === "traces_get_trace_tree") {
    const trace = await getTraceTree(sql, String(a.id));
    if (!trace) return text({ error: "Trace not found" });
    return text(trace);
  }

  if (name === "traces_export_otel") {
    const { exportTraceAsOTel } = await import("../lib/export.js");
    const { getTrace } = await import("../lib/query.js");
    const trace = await getTrace(sql, String(a.id));
    if (!trace) return text({ error: "Trace not found" });
    return text(exportTraceAsOTel(trace));
  }

  if (name === "traces_export_zipkin") {
    const { exportTraceAsZipkin } = await import("../lib/export.js");
    const { getTrace } = await import("../lib/query.js");
    const trace = await getTrace(sql, String(a.id));
    if (!trace) return text({ error: "Trace not found" });
    return text({ traces: [exportTraceAsZipkin(trace)] });
  }

  if (name === "traces_get_workspace_analytics") {
    const { getWorkspaceAnalytics } = await import("../lib/analytics.js");
    return text(await getWorkspaceAnalytics(
      sql,
      String(a.workspace_id),
      {
        periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
        periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
      },
    ));
  }

  if (name === "traces_get_span_analytics") {
    const { getSpanAnalytics } = await import("../lib/analytics.js");
    return text(await getSpanAnalytics(
      sql,
      String(a.workspace_id),
      {
        periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
        periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
        limit: a.limit ? Number(a.limit) : undefined,
      },
    ));
  }

  if (name === "traces_get_cost_breakdown") {
    const { getCostBreakdown } = await import("../lib/analytics.js");
    return text(await getCostBreakdown(
      sql,
      String(a.workspace_id),
      {
        periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
        periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
      },
    ));
  }

  if (name === "traces_export_otlp") {
    const result = await export_trace_otlp(sql, String(a.id));
    if (!result) return text({ error: "Trace not found" });
    return text(result);
  }

  if (name === "traces_export_jaeger") {
    const result = await export_traces_jaeger(sql, String(a.id));
    if (!result) return text({ error: "Trace not found" });
    return text(result);
  }

  if (name === "traces_export_zipkin") {
    const result = await export_traces_zipkin(sql, String(a.id));
    if (!result) return text({ error: "Trace not found" });
    return text(result);
  }

  if (name === "traces_span_analytics") {
    return text(await get_span_analytics(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  if (name === "traces_slowest_spans") {
    return text(await get_slowest_spans(
      sql,
      String(a.workspace_id),
      a.limit ? Number(a.limit) : 10,
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  if (name === "traces_error_spans") {
    return text(await get_error_spans(
      sql,
      String(a.workspace_id),
      a.since ? new Date(String(a.since)) : undefined,
    ));
  }

  if (name === "traces_export_session") {
    return text(await exportTraceSession(sql, String(a.workspace_id), {
      timeStart: a.time_start ? new Date(String(a.time_start)) : undefined,
      timeEnd: a.time_end ? new Date(String(a.time_end)) : undefined,
      traceIds: a.trace_ids ? Array.from(a.trace_ids as any).map(String) : undefined,
      maxTraces: a.max_traces ? Number(a.max_traces) : undefined,
      description: a.description ? String(a.description) : undefined,
    }));
  }

  if (name === "traces_export_single_trace") {
    const result = await exportSingleTrace(sql, String(a.trace_id));
    if (!result) return text({ error: "Trace not found" });
    return text(result);
  }

  if (name === "traces_span_dependency_matrix") {
    return text(await getSpanDependencyMatrix(sql, String(a.workspace_id), {
      periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
      periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
    }));
  }

  if (name === "traces_hot_paths") {
    return text(await getHotPaths(sql, String(a.workspace_id), {
      limit: a.limit ? Number(a.limit) : undefined,
      periodStart: a.period_start ? new Date(String(a.period_start)) : undefined,
      periodEnd: a.period_end ? new Date(String(a.period_end)) : undefined,
    }));
  }

  if (name === "traces_critical_path") {
    return text(await getCriticalPath(sql, String(a.workspace_id), String(a.trace_id)));
  }

  if (name === "traces_compare") {
    const result = await compare_traces(sql, String(a.trace_id_a), String(a.trace_id_b));
    if (!result) return text({ error: "One or both traces not found" });
    return text(result);
  }

  if (name === "traces_get_timeline") {
    const result = await get_trace_timeline(sql, String(a.id));
    if (!result) return text({ error: "Trace not found" });
    return text(result);
  }

  if (name === "traces_add_span_tag") {
    return text(await add_span_tag(sql, String(a.span_id), String(a.key), String(a.value)));
  }

  if (name === "traces_get_span_tags") {
    return text(await get_span_tags(sql, String(a.span_id)));
  }

  if (name === "traces_delete_span_tag") {
    const deleted = await delete_span_tag(sql, String(a.span_id), String(a.key));
    return text({ deleted });
  }

  if (name === "traces_add_span_annotation") {
    return text(await add_span_annotation(
      sql,
      String(a.span_id),
      String(a.text),
      a.timestamp ? new Date(String(a.timestamp)) : undefined,
    ));
  }

  if (name === "traces_get_span_annotations") {
    return text(await get_span_annotations(sql, String(a.span_id)));
  }

