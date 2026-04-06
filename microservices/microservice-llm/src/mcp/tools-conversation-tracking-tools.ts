// --- Conversation tracking tools ---

server.tool(
  "llm_start_conversation",
  "Start a new tracked multi-turn conversation",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    user_id: z.string().optional().describe("User UUID"),
    title: z.string().optional().describe("Conversation title"),
    model: z.string().optional().describe("Model name for this conversation"),
  },
  async (opts) => {
    const conv = await startConversation(sql, {
      workspaceId: opts.workspace_id,
      userId: opts.user_id,
      title: opts.title,
      model: opts.model,
    });
    return text(conv);
  },
);

server.tool(
  "llm_add_conversation_message",
  "Add a message to a tracked conversation and attribute cost",
  {
    conversation_id: z.string().describe("Conversation UUID"),
    request_id: z.string().optional().describe("Associated request UUID"),
    role: z.enum(["system", "user", "assistant"]).describe("Message role"),
    content: z.string().describe("Message content"),
    model: z.string().optional().describe("Model used for this message"),
    tokens_in: z.number().optional().default(0).describe("Input tokens"),
    tokens_out: z.number().optional().default(0).describe("Output tokens"),
    cost_usd: z.number().optional().default(0).describe("Cost in USD"),
  },
  async (opts) => {
    await addConversationMessage(sql, {
      conversationId: opts.conversation_id,
      requestId: opts.request_id,
      role: opts.role,
      content: opts.content,
      model: opts.model,
      tokensIn: opts.tokens_in,
      tokensOut: opts.tokens_out,
      costUsd: opts.cost_usd,
    });
    return text({ ok: true });
  },
);

server.tool(
  "llm_get_conversation_cost",
  "Get cost breakdown for a multi-turn conversation",
  {
    conversation_id: z.string().describe("Conversation UUID"),
  },
  async ({ conversation_id }) => {
    const result = await getConversationCost(sql, conversation_id);
    if (!result) return text({ error: "Conversation not found" });
    return text(result);
  },
);

server.tool(
  "llm_batch_chat",
  "Execute multiple chat completions in parallel with concurrency control, caching, and cost tracking",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    items: z.array(z.object({
      conversation_id: z.string().describe("Conversation UUID for the chat session"),
      messages: z.array(z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      })).describe("Messages to send"),
      model: z.string().optional().describe("Model to use"),
      max_tokens: z.number().optional().describe("Max tokens in response"),
      temperature: z.number().optional().describe("Sampling temperature"),
      cache: z.boolean().optional().describe("Enable semantic caching (default true)"),
    })).describe("Batch of chat items to process"),
    concurrency: z.number().optional().describe("Max parallel requests (default 5)"),
    skip_cache: z.boolean().optional().describe("Skip cache lookups"),
  },
  async ({ workspace_id, items, concurrency, skip_cache }) => {
    const opts: BatchChatOptions = {
      workspaceId: workspace_id,
      items: items as BatchChatItem[],
      concurrency: concurrency ?? 5,
      skipCache: skip_cache ?? false,
    };
    const results = await batchChat(sql, opts);
    const summary = summarizeBatchResults(results);
    return text({ results, summary });
  },
);

server.tool(
  "llm_summarize_batch_results",
  "Summarize a batch of chat results into aggregate statistics (total, successful, failed, cached, cost, latency)",
  {
    results: z.array(z.object({
      success: z.boolean(),
      cached: z.boolean().optional(),
      costUsd: z.number().optional(),
      latencyMs: z.number().optional(),
      error: z.string().optional(),
    })).describe("Batch results to summarize"),
  },
  async ({ results }) => {
    const summary = summarizeBatchResults(results as BatchChatResult[]);
    return text(summary);
  },
);

server.tool(
  "llm_detect_usage_anomalies",
  "Detect usage anomalies (spend, requests, tokens, error rate) using statistical Z-score/IQR analysis",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    metric: z.enum(["spend", "requests", "tokens", "error_rate"]).optional().describe("Metric to analyze (default all)"),
    z_threshold: z.number().optional().describe("Z-score threshold (default 2.5)"),
    iqr_multiplier: z.number().optional().describe("IQR multiplier (default 1.5)"),
    window_days: z.number().optional().describe("Analysis window in days (default 14)"),
  },
  async ({ workspace_id, metric, z_threshold, iqr_multiplier, window_days }) => {
    const config: UsageAnomalyConfig = {
      metric: metric ?? "spend",
      zThreshold: z_threshold ?? 2.5,
      iqrMultiplier: iqr_multiplier ?? 1.5,
      windowDays: window_days ?? 14,
    };
    const alerts = await detectUsageAnomalies(sql, workspace_id, config);
    return text(alerts);
  },
);

server.tool(
  "llm_get_recent_anomalies",
  "Get recent usage anomaly alerts for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    limit: z.number().optional().describe("Max alerts to return (default 20)"),
    acknowledged: z.boolean().optional().describe("Filter by acknowledged status"),
  },
  async ({ workspace_id, limit, acknowledged }) => {
    const result = await getRecentAnomalies(sql, workspace_id, {
      limit: limit ?? 20,
      acknowledged,
    });
    return text(result);
  },
);

server.tool(
  "llm_acknowledge_anomaly",
  "Acknowledge a usage anomaly alert",
  {
    alert_id: z.string().describe("Anomaly alert UUID"),
    acknowledged_by: z.string().optional().describe("User who acknowledged"),
  },
  async ({ alert_id, acknowledged_by }) => {
    await acknowledgeAnomaly(sql, alert_id, acknowledged_by);
    return text({ ok: true });
  },
);

