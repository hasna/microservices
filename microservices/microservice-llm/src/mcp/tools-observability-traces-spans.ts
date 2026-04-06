// ─── Observability (traces, spans) ───────────────────────────────────────────

server.tool(
  "llm_generate_trace_id",
  "Generate a new trace ID for grouping related LLM calls",
  {},
  async () => {
    const { generateTraceId } = await import("../lib/observability.js");
    return text({ trace_id: generateTraceId() });
  },
);

server.tool(
  "llm_create_trace_context",
  "Create a new trace context with trace and span IDs for a request",
  {
    workspace_id: z.string().optional(),
    user_id: z.string().optional(),
  },
  async ({ workspace_id, user_id }) => {
    const { createTraceContext } = await import("../lib/observability.js");
    return text(createTraceContext(workspace_id, user_id));
  },
);

server.tool(
  "llm_log_call_start",
  "Log the start of an LLM call (creates a span record)",
  {
    trace_id: z.string(),
    span_id: z.string(),
    provider: z.string(),
    model: z.string(),
    workspace_id: z.string().optional(),
    user_id: z.string().optional(),
    message_count: z.number().int().positive(),
    estimated_tokens: z.number().int().nonnegative(),
    temperature: z.number().optional(),
    role: z.string().optional().default("chat"),
  },
  async (opts) => {
    const { logCallStart } = await import("../lib/observability.js");
    await logCallStart(sql, {
      traceId: opts.trace_id,
      spanId: opts.span_id,
      timestamp: new Date().toISOString(),
      provider: opts.provider,
      model: opts.model,
      workspaceId: opts.workspace_id,
      userId: opts.user_id,
      messageCount: opts.message_count,
      estimatedTokens: opts.estimated_tokens,
      temperature: opts.temperature,
      role: opts.role,
    });
    return text({ logged: true });
  },
);

server.tool(
  "llm_log_call_end",
  "Log the end of an LLM call (updates the span with duration, tokens, cost)",
  {
    trace_id: z.string(),
    span_id: z.string(),
    duration_ms: z.number().int().nonnegative(),
    success: z.boolean(),
    error_type: z.string().optional(),
    tokens_used: z.number().int().nonnegative().optional(),
    cost_used: z.number().optional(),
    finish_reason: z.string().optional(),
    model: z.string().optional(),
  },
  async (opts) => {
    const { logCallEnd } = await import("../lib/observability.js");
    await logCallEnd(sql, {
      traceId: opts.trace_id,
      spanId: opts.span_id,
      timestamp: new Date().toISOString(),
      duration_ms: opts.duration_ms,
      success: opts.success,
      errorType: opts.error_type,
      tokensUsed: opts.tokens_used,
      costUsed: opts.cost_used,
      finishReason: opts.finish_reason,
      model: opts.model,
    });
    return text({ logged: true });
  },
);

server.tool(
  "llm_get_trace_spans",
  "Get all spans for a trace (all LLM calls in a request chain)",
  { trace_id: z.string() },
  async ({ trace_id }) => {
    const { getTraceSpans } = await import("../lib/observability.js");
    return text(await getTraceSpans(sql, trace_id));
  },
);

server.tool(
  "llm_list_workspace_traces",
  "List recent traces for a workspace",
  {
    workspace_id: z.string(),
    limit: z.number().int().positive().optional().default(20),
    since: z.string().optional(),
  },
  async ({ workspace_id, limit, since }) => {
    const { listWorkspaceTraces } = await import("../lib/observability.js");
    return text(await listWorkspaceTraces(sql, workspace_id, limit, since));
  },
);

