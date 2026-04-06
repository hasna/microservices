server.tool(
  "llm_chat",
  "Send messages to an LLM provider and get a response",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).describe("Conversation messages"),
    model: z.string().optional().describe("Model to use (optional, defaults to first available)"),
  },
  async ({ workspace_id, messages, model }) => {
    const result = await chat(sql, {
      workspaceId: workspace_id,
      messages: messages as any,
      model,
    });
    return text(result);
  },
);

server.tool(
  "llm_list_models",
  "List available LLM models based on configured API keys",
  {},
  async () => {
    const models = getAvailableModels();
    return text({ models, count: models.length });
  },
);

server.tool(
  "llm_get_usage",
  "Get LLM usage statistics for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    since: z.string().optional().describe("ISO date string to filter from (optional)"),
  },
  async ({ workspace_id, since }) => {
    const sinceDate = since ? new Date(since) : undefined;
    const usage = await getWorkspaceUsage(sql, workspace_id, sinceDate);
    return text(usage);
  },
);

server.tool(
  "llm_chat_stream",
  "Streaming chat with an LLM provider — collects stream into a full response",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z
      .array(
        z.object({
          role: z.enum(["system", "user", "assistant"]),
          content: z.string(),
        }),
      )
      .describe("Conversation messages"),
    model: z
      .string()
      .optional()
      .describe("Model to use (optional, defaults to first available)"),
  },
  async ({ workspace_id, messages, model }) => {
    const { chatStream } = await import("../lib/gateway.js");
    const { getProvider } = await import("../lib/providers.js");
    const modelName = model ?? getAvailableModels()[0]!;
    const providerName = getProvider(modelName, {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      groq: process.env.GROQ_API_KEY,
    });

    const stream = chatStream(sql, {
      workspaceId: workspace_id,
      messages: messages as Message[],
      model: modelName,
    });

    let fullContent = "";
    let requestId = "";
    let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;

    for await (const chunk of stream) {
      fullContent += chunk.delta;
      if (chunk.usage) usage = chunk.usage;
      if (chunk.request_id) requestId = chunk.request_id;
    }

    return text({
      content: fullContent,
      model: modelName,
      provider: providerName,
      stream: true,
      request_id: requestId,
      usage: usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  },
);

server.tool(
  "llm_chat_with_fallback",
  "Chat with a fallback chain — tries each provider in order until one succeeds",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z
      .array(
        z.object({
          role: z.enum(["system", "user", "assistant"]),
          content: z.string(),
        }),
      )
      .describe("Conversation messages"),
    chain: z
      .array(
        z.object({
          provider: z.enum(["openai", "anthropic", "groq"]),
          model: z.string(),
        }),
      )
      .describe("Fallback chain of provider+model pairs"),
  },
  async ({ workspace_id, messages, chain }) => {
    if (chain.length > 1) {
      const result = await callWithFallback(
        chain as FallbackChainItem[],
        messages as Message[],
      );
      return text({
        ...result,
        workspace_id,
      });
    }
    // Single provider — use regular chat
    const { getProvider } = await import("../lib/providers.js");
    const modelName = chain[0]?.model ?? getAvailableModels()[0]!;
    const providerName = getProvider(modelName, {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      groq: process.env.GROQ_API_KEY,
    });
    const result = await chat(sql, {
      workspaceId: workspace_id,
      messages: messages as Message[],
      model: modelName,
    });
    return text({
      ...result,
      fallback_used: 0,
      provider: providerName,
    });
  },
);

server.tool(
  "llm_set_rate_limit",
  "Set rate limit configuration for a workspace+provider combination",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    provider: z.string().describe("Provider name (openai, anthropic, groq)"),
    requests_per_minute: z
      .number()
      .int()
      .positive()
      .describe("Max requests per minute"),
    tokens_per_minute: z
      .number()
      .int()
      .positive()
      .describe("Max tokens per minute"),
  },
  async ({
    workspace_id,
    provider,
    requests_per_minute,
    tokens_per_minute,
  }) => {
    const config: RateLimitConfig = {
      requests_per_minute,
      tokens_per_minute,
    };
    await setRateLimit(sql, workspace_id, provider, config);
    return text({ success: true, workspace_id, provider, config });
  },
);

server.tool(
  "llm_get_rate_limit_status",
  "Get current rate limit status for a workspace+provider",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    provider: z.string().describe("Provider name (openai, anthropic, groq)"),
  },
  async ({ workspace_id, provider }) => {
    const status = await checkRateLimit(sql, workspace_id, provider);
    return text(status as RateLimitStatus);
  },
);

// ---------------------------------------------------------------------------
// Streaming SSE tools
// ---------------------------------------------------------------------------

server.tool(
  "llm_chat_stream_sse",
  "Streaming chat with an LLM provider — returns SSE stream chunks directly",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z
      .array(
        z.object({
          role: z.enum(["system", "user", "assistant"]),
          content: z.string(),
        }),
      )
      .describe("Conversation messages"),
    model: z.string().optional().describe("Model to use (optional, defaults to first available)"),
  },
  async ({ workspace_id, messages, model }) => {
    const stream = chat_stream(sql, {
      workspaceId: workspace_id,
      messages: messages as Message[],
      model,
    });

    // Collect SSE stream into a string for MCP response
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const decoder = new TextDecoder();
    const sseData = decoder.decode(
      chunks.reduce((acc, c) => acc + (acc.length ? "\n" : "") + decoder.decode(c), new Uint8Array()),
    );
    return text({ stream: "sse", chunks: sseData });
  },
);

server.tool(
  "llm_complete_stream",
  "Streaming text completion — returns SSE stream chunks",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    prompt: z.string().describe("Prompt for completion"),
    model: z.string().optional().describe("Model to use (optional, defaults to first available)"),
    max_tokens: z.number().optional().describe("Max tokens to generate"),
  },
  async ({ workspace_id, prompt, model, max_tokens }) => {
    const stream = complete_stream(sql, {
      workspaceId: workspace_id,
      prompt,
      model,
      maxTokens: max_tokens,
    });

    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const decoder = new TextDecoder();
    const sseData = decoder.decode(
      chunks.reduce((acc, c) => acc + (acc.length ? "\n" : "") + decoder.decode(c), new Uint8Array()),
    );
    return text({ stream: "sse", chunks: sseData });
  },
);

// ---------------------------------------------------------------------------
// Streaming utilities
// ---------------------------------------------------------------------------

server.tool(
  "llm_stream_aggregate",
  "Aggregate multiple async LLM streams into a single unified stream — yields combined content, tokens, and metadata across all streams",
  {
    streams: z.array(z.any()).describe("Array of stream generators to aggregate"),
  },
  async ({ streams }) => {
    const { aggregateStreams } = await import("../lib/streaming.js");
    const results = aggregateStreams(...streams);
    const aggregated: ReturnType<typeof aggregateStreams> extends AsyncGenerator<infer T> ? T[] : never[] = [];
    for await (const chunk of results) {
      aggregated.push(chunk);
    }
    return text({ aggregated, count: aggregated.length });
  },
);

server.tool(
  "llm_stream_with_metrics",
  "Wrap a chat stream to collect streaming performance metrics — time-to-first-token, tokens/sec, total latency, completion rate",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).describe("Conversation messages"),
    model: z.string().optional().describe("Model to use"),
  },
  async ({ workspace_id, messages, model }) => {
    const { withStreamingMetrics } = await import("../lib/streaming.js");
    const { chatStream } = await import("../lib/gateway.js");
    const { calculateCost } = await import("../lib/costs.js");

    const stream = chatStream(sql, {
      workspaceId: workspace_id,
      messages: messages as Message[],
      model: model ?? undefined,
    });
    const { stream: decorated, metrics } = withStreamingMetrics(stream, {
      workspaceId: workspace_id,
      model: model ?? "gpt-4o",
      provider: "openai",
    });

    let text = "";
    let totalTokens = 0;
    for await (const chunk of decorated) {
      text += chunk.delta;
      if (chunk.usage) totalTokens += chunk.usage.total_tokens;
    }

    const finalMetrics = await metrics;
    return text({
      text,
      total_tokens: totalTokens,
      metrics: finalMetrics,
      cost_usd: calculateCost(0, finalMetrics.totalTokens, model ?? "gpt-4o"),
    });
  },
);

server.tool(
  "llm_stream_collect_text",
  "Collect all text content from a chat stream into a single string",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).describe("Conversation messages"),
    model: z.string().optional().describe("Model to use"),
  },
  async ({ workspace_id, messages, model }) => {
    const { collectStreamText } = await import("../lib/streaming.js");
    const { chatStream } = await import("../lib/gateway.js");

    const stream = chatStream(sql, {
      workspaceId: workspace_id,
      messages: messages as Message[],
      model: model ?? undefined,
    });
    const text = await collectStreamText(stream);
    return text({ content: text, length: text.length });
  },
);

// ---------------------------------------------------------------------------
// Batch completions
// ---------------------------------------------------------------------------

server.tool(
  "llm_batch_complete",
  "Send multiple prompts to the LLM in parallel and return an array of completions",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    prompts: z.array(z.string()).describe("Array of prompts to complete"),
    model: z.string().optional().describe("Model to use"),
    max_tokens: z.number().optional().describe("Max tokens per completion"),
  },
  async ({ workspace_id, prompts, model, max_tokens }) => {
    const models = getAvailableModels();
    const modelName = model ?? models[0];
    if (!modelName) {
      return text({ error: "No model available. Set OPENAI_API_KEY or ANTHROPIC_API_KEY." });
    }

    const apiKey =
      process.env.OPENAI_API_KEY ??
      process.env.ANTHROPIC_API_KEY ??
      process.env.GROQ_API_KEY;
    if (!apiKey) {
      return text({ error: "No API key configured" });
    }

    const results = await batchComplete(
      { model: modelName, prompts, maxTokens: max_tokens },
      apiKey,
    );

    return text({
      workspace_id,
      model: modelName,
      results,
      count: results.length,
    });
  },
);

// ---------------------------------------------------------------------------
// Token counting
// ---------------------------------------------------------------------------

server.tool(
  "llm_estimate_tokens",
  "Estimate the number of tokens in a text string or message array",
  {
    text: z.string().optional().describe("Text string to count tokens in"),
    messages: z
      .array(
        z.object({
          role: z.enum(["system", "user", "assistant"]),
          content: z.string(),
        }),
      )
      .optional()
      .describe("Message array to count tokens across"),
  },
  async ({ text, messages }) => {
    let estimate: number;
    if (text !== undefined) {
      estimate = countTokens(text);
    } else if (messages !== undefined) {
      estimate = countMessageTokens(messages as Message[]);
    } else {
      return text({ error: "Provide either 'text' or 'messages'" });
    }
    return text({ estimate, note: "Approximate token count using cl100k_base-style estimator" });
  },
);

// ---------------------------------------------------------------------------
// Token counting (explicit)
// ---------------------------------------------------------------------------

server.tool(
  "llm_count_tokens",
  "Count tokens in a text string or message array using the cl100k_base estimator",
  {
    text: z.string().optional().describe("Text string to count tokens in"),
    messages: z
      .array(
        z.object({
          role: z.enum(["system", "user", "assistant"]),
          content: z.string(),
        }),
      )
      .optional()
      .describe("Message array to count tokens across"),
  },
  async ({ text, messages }) => {
    let estimate: number;
    if (text !== undefined) {
      estimate = countTokens(text);
    } else if (messages !== undefined) {
      estimate = countMessageTokens(messages as Message[]);
    } else {
      return text({ error: "Provide either 'text' or 'messages'" });
    }
    return text({ estimate, note: "Token count using cl100k_base-style estimator" });
  },
);

// ---------------------------------------------------------------------------
// Fallback chain management
// ---------------------------------------------------------------------------

server.tool(
  "llm_set_fallback_chain",
  "Set the fallback provider chain for a workspace (tried in order on failure)",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    chain: z.array(z.array(z.string())).describe("Array of provider name arrays, e.g. [['openai'], ['anthropic']]"),
  },
  async ({ workspace_id, chain }) => {
    await setFallbackStrategy(sql, workspace_id, chain);
    return text({ ok: true, workspace_id, chain });
  },
);

server.tool(
  "llm_get_fallback_chain",
  "Get the fallback provider chain for a workspace",
  { workspace_id: z.string().describe("Workspace UUID") },
  async ({ workspace_id }) => {
    const chain = await getFallbackStrategy(sql, workspace_id);
    return text({ workspace_id, chain });
  },
);

// ---------------------------------------------------------------------------
// Budget alerts
// ---------------------------------------------------------------------------

server.tool(
  "llm_set_budget_alert",
  "Create a budget alert record for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    alert_type: z.enum(["threshold", "exceeded"]).describe("Type of alert"),
    threshold_cents: z.number().int().positive().describe("Threshold amount in cents"),
    current_spend_cents: z.number().int().nonnegative().describe("Current spend in cents"),
  },
  async ({ workspace_id, alert_type, threshold_cents, current_spend_cents }) => {
    const alert = await setBudgetAlert(sql, {
      workspaceId: workspace_id,
      alertType: alert_type,
      thresholdCents: threshold_cents,
      currentSpendCents: current_spend_cents,
    });
    return text(alert);
  },
);

server.tool(
  "llm_get_budget_alerts",
  "Get recent budget alerts for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    limit: z.number().int().positive().optional().default(20).describe("Max alerts to return"),
  },
  async ({ workspace_id, limit }) => {
    const alerts = await getBudgetAlertsTyped(sql, workspace_id, limit);
    return text({ alerts, count: alerts.length });
  },
);

// ---------------------------------------------------------------------------
// Prompt templates
// ---------------------------------------------------------------------------

server.tool(
  "llm_create_template",
  "Create a new prompt template with variable placeholders",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    name: z.string().describe("Template name"),
    template: z.string().describe("Template content with {{variable}} placeholders"),
    description: z.string().optional().describe("Template description"),
    variables: z.array(z.string()).optional().describe("List of variable names"),
    model_provider: z.string().optional().describe("Preferred provider"),
    model_name: z.string().optional().describe("Preferred model"),
  },
  async ({ workspace_id, name, template, description, variables, model_provider, model_name }) => {
    const result = await createPromptTemplate(sql, {
      workspace_id,
      name,
      template,
      description,
      variables,
      model_provider,
      model_name,
    });
    return text(result);
  },
);

server.tool(
  "llm_render_template",
  "Render a prompt template with variable substitution",
  {
    template_id: z.string().describe("Template UUID"),
    variables: z.record(z.string()).describe("Map of variable names to values"),
  },
  async ({ template_id, variables }) => {
    const result = await renderPromptTemplate(sql, template_id, variables);
    if (!result) return text({ error: "Template not found or inactive" });
    return text(result);
  },
);

server.tool(
  "llm_get_template",
  "Get a prompt template by ID",
  {
    template_id: z.string().describe("Template UUID"),
  },
  async ({ template_id }) => {
    const result = await getPromptTemplate(sql, template_id);
    if (!result) return text({ error: "Template not found" });
    return text(result);
  },
);

server.tool(
  "llm_get_template_version_history",
  "Get the version history for a prompt template",
  {
    template_id: z.string().describe("Template UUID"),
  },
  async ({ template_id }) => {
    const history = await getTemplateVersionHistory(sql, template_id);
    return text({ template_id, versions: history });
  },
);

server.tool(
  "llm_list_templates",
  "List prompt templates for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    is_active: z.boolean().optional().describe("Filter by active status"),
    limit: z.number().int().positive().optional().default(50).describe("Max results"),
  },
  async ({ workspace_id, is_active, limit }) => {
    const templates = await listPromptTemplates(sql, workspace_id, { is_active, limit });
    return text({ templates, count: templates.length });
  },
);

server.tool(
  "llm_update_template",
  "Update a prompt template (creates new version)",
  {
    template_id: z.string().describe("Template UUID"),
    name: z.string().optional().describe("New name"),
    template: z.string().optional().describe("New template content"),
    variables: z.array(z.string()).optional().describe("New variables list"),
    is_active: z.boolean().optional().describe("Active status"),
  },
  async ({ template_id, name, template, variables, is_active }) => {
    const result = await updatePromptTemplate(sql, template_id, { name, template, variables, is_active });
    if (!result) return text({ error: "Template not found" });
    return text(result);
  },
);

server.tool(
  "llm_delete_template",
  "Soft-delete a prompt template",
  {
    template_id: z.string().describe("Template UUID"),
  },
  async ({ template_id }) => {
    const success = await deletePromptTemplate(sql, template_id);
    return text({ success });
  },
);

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

server.tool(
  "llm_generate_embedding",
  "Generate text embedding via OpenAI API",
  {
    text: z.string().describe("Text to embed"),
    model: z.string().optional().describe("Embedding model (default: text-embedding-3-small)"),
    dimensions: z.number().int().positive().optional().describe("Embedding dimensions"),
  },
  async ({ text, model, dimensions }) => {
    const embedding = await generateEmbedding(text, { model, dimensions });
    return text({ embedding, model: model ?? "text-embedding-3-small", dimensions: dimensions ?? 1536 });
  },
);

server.tool(
  "llm_cache_embedding",
  "Cache an embedding for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    text: z.string().describe("Original text"),
    embedding: z.array(z.number()).describe("Embedding vector"),
    model: z.string().describe("Embedding model used"),
    dimensions: z.number().int().positive().describe("Embedding dimensions"),
  },
  async ({ workspace_id, text, embedding, model, dimensions }) => {
    const cached = await cacheEmbedding(sql, { workspace_id, text, embedding, model, dimensions });
    return text(cached);
  },
);

server.tool(
  "llm_get_cached_embedding",
  "Retrieve a cached embedding by text",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    text: z.string().describe("Text to look up"),
  },
  async ({ workspace_id, text }) => {
    const cached = await getCachedEmbedding(sql, workspace_id, text);
    if (!cached) return text({ hit: false });
    return text({ hit: true, ...cached });
  },
);

server.tool(
  "llm_prune_embedding_cache",
  "Delete old cached embeddings",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    older_than_days: z.number().int().positive().optional().default(30).describe("Delete entries older than N days"),
  },
  async ({ workspace_id, older_than_days }) => {
    const deleted = await pruneEmbeddingCache(sql, workspace_id, older_than_days ?? 30);
    return text({ deleted, workspace_id });
  },
);

// ---------------------------------------------------------------------------
// Model registry
// ---------------------------------------------------------------------------

server.tool(
  "llm_register_model",
  "Register a new model in the model registry",
  {
    provider: z.string().describe("Provider type (openai, anthropic, google, mistral, ollama, custom)"),
    name: z.string().describe("Model internal name"),
    display_name: z.string().optional().describe("Human-readable name"),
    description: z.string().optional().describe("Model description"),
    context_window: z.number().int().positive().optional().describe("Context window size"),
    max_output_tokens: z.number().int().positive().optional().describe("Max output tokens"),
    cost_per_1k_input: z.number().positive().optional().describe("Cost per 1K input tokens (USD)"),
    cost_per_1k_output: z.number().positive().optional().describe("Cost per 1K output tokens (USD)"),
    capabilities: z.array(z.string()).optional().describe("Array of capabilities"),
  },
  async (opts) => {
    const model = await registerModel(sql, {
      provider: opts.provider as any,
      name: opts.name,
      display_name: opts.display_name,
      description: opts.description,
      context_window: opts.context_window,
      max_output_tokens: opts.max_output_tokens,
      cost_per_1k_input: opts.cost_per_1k_input,
      cost_per_1k_output: opts.cost_per_1k_output,
      capabilities: opts.capabilities as any,
    });
    return text(model);
  },
);

server.tool(
  "llm_list_registered_models",
  "List all registered models in the model registry",
  {
    provider: z.string().optional().describe("Filter by provider"),
    capability: z.string().optional().describe("Filter by capability"),
    is_active: z.boolean().optional().describe("Filter by active status"),
  },
  async ({ provider, capability, is_active }) => {
    const models = await listModels(sql, {
      provider: provider as any,
      capability: capability as any,
      is_active,
    });
    return text({ models, count: models.length });
  },
);

server.tool(
  "llm_get_model",
  "Get a model by ID or alias",
  {
    identifier: z.string().describe("Model ID or alias"),
    workspace_id: z.string().optional().describe("Workspace UUID for alias lookup"),
  },
  async ({ identifier, workspace_id }) => {
    const model = await getModel(sql, identifier, workspace_id);
    if (!model) return text({ error: "Model not found" });
    return text(model);
  },
);

server.tool(
  "llm_get_model_fallback_chain",
  "Get the fallback chain of models for a given model ID",
  { model_id: z.string().describe("Model UUID") },
  async ({ model_id }) => text(await getModelFallbackChain(sql, model_id)),
);

server.tool(
  "llm_create_model_alias",
  "Create a model alias for a workspace or globally",
  {
    alias: z.string().describe("Alias string"),
    model_id: z.string().describe("Target model UUID"),
    workspace_id: z.string().optional().describe("Workspace UUID (null for global)"),
  },
  async ({ alias, model_id, workspace_id }) => {
    const result = await createModelAlias(sql, alias, model_id, workspace_id);
    return text(result);
  },
);

server.tool(
  "llm_get_workspace_models",
  "Get available models for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    capability: z.string().optional().describe("Filter by capability (chat, completion, embedding, etc)"),
  },
  async ({ workspace_id, capability }) => {
    const models = await getWorkspaceModels(sql, workspace_id, capability as any);
    return text({ models, count: models.length });
  },
);

server.tool(
  "llm_list_providers",
  "List all registered LLM providers",
  {},
  async () => {
    const providers = await listProviders(sql);
    return text({ providers, count: providers.length });
  },
);

// Function calling tools
server.tool(
  "llm_register_tools",
  "Register tool definitions for a workspace (function calling)",
  {
    workspace_id: z.string(),
    tools: z.array(z.object({
      name: z.string(),
      description: z.string(),
      parameters: z.object({
        type: z.literal("object"),
        properties: z.record(z.any()),
        required: z.array(z.string()).optional(),
      }),
    })),
  },
  async ({ workspace_id, tools }) => text(await registerTools(sql, workspace_id, tools as any)),
);

server.tool(
  "llm_list_tools",
  "List registered tools for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await listTools(sql, workspace_id)),
);

server.tool(
  "llm_delete_tool",
  "Delete a tool from a workspace",
  { workspace_id: z.string(), name: z.string() },
  async ({ workspace_id, name }) => text({ deleted: await deleteTool(sql, workspace_id, name) }),
);

// Semantic cache tools
server.tool(
  "llm_cache_response",
  "Cache an LLM response for semantic reuse",
  {
    workspace_id: z.string(),
    prompt: z.string(),
    prompt_embedding: z.array(z.number()).optional(),
    response_content: z.string(),
    model: z.string(),
    provider: z.string(),
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    cost_usd: z.number(),
  },
  async (opts) => text(await cacheResponse(sql, opts as any)),
);

server.tool(
  "llm_get_cached_by_hash",
  "Fast-path cache lookup by exact prompt hash",
  { workspace_id: z.string(), prompt_hash: z.string() },
  async ({ workspace_id, prompt_hash }) => text(await getCachedByHash(sql, workspace_id, prompt_hash)),
);

server.tool(
  "llm_get_cached_by_embedding",
  "Semantic cache lookup by embedding similarity",
  {
    workspace_id: z.string(),
    query_embedding: z.array(z.number()),
    similarity_threshold: z.number().optional().default(0.95),
    limit: z.number().optional().default(5),
  },
  async ({ workspace_id, query_embedding, similarity_threshold, limit }) =>
    text(await getCachedByEmbedding(sql, workspace_id, query_embedding, similarity_threshold, limit)),
);

server.tool(
  "llm_list_cached_responses",
  "List cached responses for a workspace",
  {
    workspace_id: z.string(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ workspace_id, limit, offset }) =>
    text(await listCachedResponses(sql, workspace_id, limit, offset)),
);

server.tool(
  "llm_invalidate_cache",
  "Invalidate cache entries for a workspace",
  { workspace_id: z.string(), model: z.string().optional() },
  async ({ workspace_id, model }) => text(await invalidateCache(sql, workspace_id, model)),
);

server.tool(
  "llm_cache_stats",
  "Get cache statistics for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => text(await getCacheStats(sql, workspace_id)),
);

// Vision tools
server.tool(
  "llm_vision",
  "Process a text + image prompt with a vision-capable model",
  {
    model: z.string().describe("Vision model (e.g. gpt-4o, claude-3-5-sonnet)"),
    text: z.string().describe("Text prompt"),
    images: z.array(z.object({
      url: z.string().optional(),
      base64: z.string().optional(),
      detail: z.enum(["low", "high", "auto"]).optional(),
    })).describe("Images to include"),
    api_key: z.string().optional(),
    max_tokens: z.number().optional().default(4096),
  },
  async ({ model, text, images, api_key, max_tokens }) => {
    const content = buildVisionContent(text, images.map((i: any) => i.url ? { url: i.url, detail: i.detail } : { base64: i.base64, detail: i.detail }));
    const result = await chatVision({
      model,
      messages: [{ role: "user", content }],
      maxTokens: max_tokens,
      apiKey: api_key,
    });
    return text(result);
  },
);

server.tool(
  "llm_supports_vision",
  "Check if a model supports vision/multi-modal",
  { model: z.string() },
  async ({ model }) => text({ supports_vision: modelSupportsVision(model) }),
);

// Circuit Breaker tools
server.tool(
  "llm_get_circuit_breaker_stats",
  "Get circuit breaker status for a provider",
  { provider: z.string().describe("Provider name (openai, anthropic, groq)") },
  async ({ provider }) => {
    const { getCircuitBreakerStats } = await import("../lib/circuit-breaker.js");
    return text(await getCircuitBreakerStats(provider));
  },
);

server.tool(
  "llm_record_provider_success",
  "Record a successful provider call (decrements failure count)",
  { provider: z.string() },
  async ({ provider }) => {
    const { recordSuccess } = await import("../lib/circuit-breaker.js");
    recordSuccess(provider);
    const stats = await import("../lib/circuit-breaker.js").then(m => m.getCircuitBreakerStats(provider));
    return text({ success: true, stats });
  },
);

server.tool(
  "llm_record_provider_failure",
  "Record a failed provider call (increments failure count, may open circuit)",
  { provider: z.string() },
  async ({ provider }) => {
    const { recordFailure } = await import("../lib/circuit-breaker.js");
    recordFailure(provider);
    const stats = await import("../lib/circuit-breaker.js").then(m => m.getCircuitBreakerStats(provider));
    return text({ success: true, stats });
  },
);

server.tool(
  "llm_reset_circuit_breaker",
  "Reset a provider's circuit breaker to closed state",
  { provider: z.string() },
  async ({ provider }) => {
    const { resetCircuitBreaker } = await import("../lib/circuit-breaker.js");
    return text(await resetCircuitBreaker(provider));
  },
);

server.tool(
  "llm_is_provider_available",
  "Check if a provider's circuit breaker allows requests",
  { provider: z.string() },
  async ({ provider }) => {
    const { isProviderAvailable } = await import("../lib/circuit-breaker.js");
    return text({ available: await isProviderAvailable(provider) });
  },
);

// Model Budget tools
server.tool(
  "llm_set_model_budget",
  "Set a monthly spending limit for a specific model in a workspace",
  {
    workspace_id: z.string(),
    model_name: z.string(),
    monthly_limit_usd: z.number().positive(),
    alert_threshold_pct: z.number().int().min(1).max(100).optional().default(80),
    enabled: z.boolean().optional().default(true),
  },
  async ({ workspace_id, model_name, monthly_limit_usd, alert_threshold_pct, enabled }) => {
    const { setModelBudget } = await import("../lib/model-budgets.js");
    return text(await setModelBudget(sql, workspace_id, model_name, {
      monthlyLimitUsd: monthly_limit_usd,
      alertThresholdPct: alert_threshold_pct ?? 80,
      enabled: enabled ?? true,
    }));
  },
);

server.tool(
  "llm_get_model_budget",
  "Get the current budget status for a model in a workspace",
  {
    workspace_id: z.string(),
    model_name: z.string(),
  },
  async ({ workspace_id, model_name }) => {
    const { getModelBudget } = await import("../lib/model-budgets.js");
    return text(await getModelBudget(sql, workspace_id, model_name));
  },
);

server.tool(
  "llm_check_model_budget",
  "Check if a model request would exceed the workspace's model budget",
  {
    workspace_id: z.string(),
    model_name: z.string(),
    estimated_cost_usd: z.number().describe("Estimated cost of the request"),
  },
  async ({ workspace_id, model_name, estimated_cost_usd }) => {
    const { checkModelBudget } = await import("../lib/model-budgets.js");
    return text(await checkModelBudget(sql, workspace_id, model_name, estimated_cost_usd));
  },
);

server.tool(
  "llm_list_model_budgets",
  "List all model budgets for a workspace",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const { listModelBudgets } = await import("../lib/model-budgets.js");
    return text(await listModelBudgets(sql, workspace_id));
  },
);

server.tool(
  "llm_delete_model_budget",
  "Delete a model budget for a workspace",
  {
    workspace_id: z.string(),
    model_name: z.string(),
  },
  async ({ workspace_id, model_name }) => {
    const { deleteModelBudget } = await import("../lib/model-budgets.js");
    return text(await deleteModelBudget(sql, workspace_id, model_name));
  },
);

