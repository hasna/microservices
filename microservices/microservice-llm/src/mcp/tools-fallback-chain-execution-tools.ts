// --- Fallback chain execution tools ---

server.tool(
  "llm_chat_with_fallback_logged",
  "Chat with a fallback chain and log execution details (providers tried, latency, cost)",
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
    const result = await executeChainWithLog(
      sql,
      workspace_id,
      chain as FallbackChainItem[],
      messages as Message[],
    );
    return text(result);
  },
);

server.tool(
  "llm_list_chain_executions",
  "List recent fallback chain executions for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    limit: z.number().optional().default(50).describe("Max results"),
    offset: z.number().optional().default(0).describe("Offset for pagination"),
  },
  async ({ workspace_id, limit, offset }) =>
    text(await listChainExecutions(sql, workspace_id, limit, offset)),
);

server.tool(
  "llm_chain_execution_details",
  "Get detailed per-provider attempts for a chain execution",
  {
    execution_id: z.string().describe("Chain execution UUID"),
  },
  async ({ execution_id }) =>
    text(await getChainExecutionDetails(sql, execution_id)),
);

server.tool(
  "llm_execute_streaming_chain_with_log",
  "Stream a fallback chain with execution logging — tries each provider/model in order until one succeeds, yielding chunks as they arrive",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    chain: z.array(z.object({
      provider: z.enum(["openai", "anthropic", "groq"]),
      model: z.string(),
    })),
    opts: z.object({
      model: z.string(),
      messages: z.array(z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      })),
    }),
  },
  async ({ workspace_id, chain, opts }) => {
    const result = await executeStreamingChainWithLog(sql, workspace_id, chain as FallbackChainItem[], opts as any);
    return text({ chain_execution_id: result.chain_execution_id, fallback_used: result.fallback_used });
  },
);

server.tool(
  "llm_check_budget_and_alert",
  "Check if a cost amount is within a workspace budget, firing an alert if the threshold is crossed",
  {
    workspace_id: z.string(),
    cost_usd: z.number().describe("Cost in USD to check against the budget"),
  },
  async ({ workspace_id, cost_usd }) => text(await checkBudgetAndAlert(sql, workspace_id, cost_usd)),
);

server.tool(
  "llm_provider_chain_stats",
  "Get aggregate fallback chain stats per provider",
  {
    workspace_id: z.string().optional().describe("Workspace UUID (optional, omit for all workspaces)"),
  },
  async ({ workspace_id }) =>
    text(await getProviderChainStats(sql, workspace_id)),
);

server.tool(
  "llm_popular_chains",
  "Get the most commonly used fallback chains for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    limit: z.number().optional().default(10).describe("Max chains to return"),
  },
  async ({ workspace_id, limit }) =>
    text(await getPopularChains(sql, workspace_id, limit)),
);

server.tool(
  "llm_prune_chain_logs",
  "Delete fallback chain logs older than N days",
  {
    older_than_days: z.number().optional().default(30).describe("Delete logs older than this many days"),
  },
  async ({ older_than_days }) => {
    const count = await pruneChainLogs(sql, older_than_days);
    return text({ deleted: count });
  },
);

