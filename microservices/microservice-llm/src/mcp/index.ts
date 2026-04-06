#!/usr/bin/env bun
/**
 * MCP server for microservice-llm.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";
import {
  chat,
  chat_stream,
  complete_stream,
} from "../lib/gateway.js";
import {
  batchComplete,
  callWithFallback,
  collectStream,
  countMessageTokens,
  countTokens,
  getAvailableModels,
  getProvider,
  chatAnthropic,
  chatOpenAI,
  chatGroq,
  chatAnthropicStream,
  chatOpenAIStream,
  chatCompleteStream,
  completeOpenAI,
  completeOpenAIStream,
  callProvider,
  streamToSSE,
  type FallbackChainItem,
  type Message,
} from "../lib/providers.js";
import {
  registerTools,
  listTools,
  deleteTool,
  executeToolCallsParallel,
  parseToolCalls,
  buildOpenAITools,
  executeToolCall,
} from "../lib/function-calling.js";
import {
  cacheResponse,
  getCachedByHash,
  getCachedByEmbedding,
  listCachedResponses,
  invalidateCache,
  getCacheStats,
} from "../lib/semantic-cache.js";
import {
  chatVision,
  chatOpenAIVision,
  chatAnthropicVision,
  buildVisionContent,
  modelSupportsVision,
} from "../lib/vision.js";
import {
  cacheEmbedding,
  generateEmbedding,
  generateEmbeddings,
  getCachedEmbedding,
  pruneEmbeddingCache,
} from "../lib/embeddings.js";
import {
  createModelAlias,
  deactivateModel,
  getModel,
  getModelFallbackChain,
  getWorkspaceModels,
  listModels,
  listProviders,
  registerModel,
  registerProvider,
  updateModel,
} from "../lib/model-registry.js";
import {
  createPromptTemplate,
  deletePromptTemplate,
  getPromptTemplate,
  getTemplateVersionHistory,
  listPromptTemplates,
  renderPromptTemplate,
  updatePromptTemplate,
} from "../lib/prompt-templates.js";
import {
  checkRateLimit,
  setRateLimit,
  type RateLimitConfig,
  type RateLimitStatus,
} from "../lib/ratelimit.js";
import {
  getBudgetAlertsTyped,
  setBudgetAlert,
  setFallbackStrategy,
  calculateCost,
  getWorkspaceBudget,
  recordSpend,
  setWorkspaceBudget,
  type BudgetAlert,
} from "../lib/costs.js";
import { getWorkspaceUsage } from "../lib/usage.js";
import {
  registerWebhook,
  deleteWebhook,
  listWebhooks,
  fireWebhook,
  notifyBudgetAlert,
  type WebhookEndpoint,
  type WebhookEventType,
} from "../lib/webhook-notifier.js";
import {
  getProviderHealth,
  listProviderHealth,
  getProviderCircuitStatus,
  getAllCircuitStates,
  resetProviderCircuit,
} from "../lib/provider-health.js";
import {
  getWorkspaceUsageSummary,
  getModelBreakdown,
  getDailyUsage,
  getTopUsers,
  getProviderBreakdown,
} from "../lib/usage-analytics.js";
import {
  executeChainWithLog,
  executeStreamingChainWithLog,
  listChainExecutions,
  getChainExecutionDetails,
  getProviderChainStats,
  getPopularChains,
  pruneChainLogs,
} from "../lib/fallback-chains.js";
import {
  createBudgetSchedule,
  listBudgetSchedules,
  getBudgetSchedule,
  cancelBudgetSchedule,
  deleteBudgetSchedule,
  runBudgetSchedule,
  processDueSchedules,
  getBudgetCheckHistory,
} from "../lib/budget-scheduler.js";
import {
  forecastUsage,
  forecastAllWorkspaces,
} from "../lib/usage-forecast.js";
import {
  getTokenUsageStats,
  getTokenOptimizationSuggestions,
  getTokenOptimizationReport,
} from "../lib/token-usage-optimizer.js";
import {
  parseSSELine,
  parseSSEBody,
  sseEncode,
  streamToText,
} from "../lib/streaming.js";
import {
  computeModelLatencyStats,
  getModelLatencyStats,
  getAllModelLatencyStats,
  recordQualityScore,
  getModelQualityStats,
  startConversation,
  addConversationMessage,
  getConversationCost,
} from "../lib/model-latency.js";
import {
  getCircuitBreaker,
} from "../lib/circuit-breaker.js";
import {
  batchChat,
  summarizeBatchResults,
  type BatchChatItem,
  type BatchChatOptions,
  type BatchChatResult,
} from "../lib/batch-chat.js";
import {
  detectUsageAnomalies,
  acknowledgeAnomaly,
  getRecentAnomalies,
  type UsageAnomalyConfig,
} from "../lib/usage-anomaly.js";
import {
  computePromptDiff,
  getPromptVersionSideBySide,
} from "../lib/index.js";

const server = new McpServer({
  name: "microservice-llm",
  version: "0.0.1",
});

const sql = getDb();

// Helper to wrap response in standard MCP format
// --- Budget management tools ---

server.tool(
  "llm_get_workspace_budget",
  "Get the current monthly budget for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
  },
  async ({ workspace_id }) => {
    const budget = await getWorkspaceBudget(sql, workspace_id);
    return text(budget ?? { error: "No budget set for workspace" });
  },
);

server.tool(
  "llm_set_workspace_budget",
  "Set a monthly spending budget for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    monthly_limit_cents: z.number().int().nonnegative().describe("Monthly limit in cents"),
    alert_threshold_pct: z.number().int().min(1).max(99).optional().default(80).describe("Alert threshold percentage"),
    enabled: z.boolean().optional().default(true),
  },
  async ({ workspace_id, monthly_limit_cents, alert_threshold_pct, enabled }) => {
    const budget = await setWorkspaceBudget(sql, {
      workspaceId: workspace_id,
      monthlyLimitCents: monthly_limit_cents,
      alertThresholdPct: alert_threshold_pct ?? 80,
      enabled: enabled ?? true,
    });
    return text(budget);
  },
);

server.tool(
  "llm_record_spend",
  "Record a spend event for a workspace (for manual tracking)",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    amount_cents: z.number().int().describe("Amount spent in cents"),
    model: z.string().describe("Model used"),
    provider: z.string().describe("Provider used"),
    tokens_used: z.number().int().optional().describe("Total tokens used"),
    request_id: z.string().optional().describe("Optional request UUID"),
  },
  async ({ workspace_id, amount_cents, model, provider, tokens_used, request_id }) => {
    const record = await recordSpend(sql, {
      workspaceId: workspace_id,
      amountCents: amount_cents,
      model,
      provider,
      tokensUsed: tokens_used,
      requestId: request_id,
    });
    return text(record);
  },
);

server.tool(
  "llm_calculate_cost",
  "Calculate the cost of a request based on token usage",
  {
    model: z.string().describe("Model name"),
    prompt_tokens: z.number().int().describe("Number of prompt tokens"),
    completion_tokens: z.number().int().describe("Number of completion tokens"),
  },
  async ({ model, prompt_tokens, completion_tokens }) => {
    const cost = calculateCost(model, prompt_tokens, completion_tokens);
    return text({ cost_usd: cost, model, prompt_tokens, completion_tokens });
  },
);


// --- Budget scheduler tools ---

server.tool(
  "llm_create_budget_schedule",
  "Create a budget monitoring schedule for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    schedule_type: z.enum(["periodic", "on_demand"]).optional().default("on_demand").describe("Schedule type"),
    cron_expression: z.string().optional().describe("Cron expression (e.g. '0 0 * * *' for daily)"),
    action: z.string().optional().default("check_threshold").describe("Action: check_threshold, check_exceeded, reset_monthly, alert_webhook"),
    alert_at_pct: z.number().optional().describe("Alert at this percentage (0-100)"),
    webhook_on_threshold: z.boolean().optional().default(false).describe("Send webhook on threshold"),
    auto_rollover: z.boolean().optional().default(false).describe("Auto-reset spend on new month"),
  },
  async ({ workspace_id, schedule_type, cron_expression, action, alert_at_pct, webhook_on_threshold, auto_rollover }) => {
    const schedule = await createBudgetSchedule(sql, workspace_id, {
      scheduleType: schedule_type,
      cronExpression: cron_expression,
      action: action as any,
      config: { alert_at_pct, webhook_on_threshold, auto_rollover },
    });
    return text(schedule);
  },
);

server.tool(
  "llm_list_budget_schedules",
  "List all budget schedules for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
  },
  async ({ workspace_id }) =>
    text(await listBudgetSchedules(sql, workspace_id)),
);

server.tool(
  "llm_get_budget_schedule",
  "Get a specific budget schedule by ID",
  {
    schedule_id: z.string().describe("Schedule UUID"),
  },
  async ({ schedule_id }) => {
    const schedule = await getBudgetSchedule(sql, schedule_id);
    return text(schedule ?? { error: "Not found" });
  },
);

server.tool(
  "llm_run_budget_schedule",
  "Trigger a budget schedule immediately (on-demand)",
  {
    schedule_id: z.string().describe("Schedule UUID"),
  },
  async ({ schedule_id }) => {
    const result = await runBudgetSchedule(sql, schedule_id);
    return text(result);
  },
);

server.tool(
  "llm_cancel_budget_schedule",
  "Cancel a pending or failed budget schedule",
  {
    schedule_id: z.string().describe("Schedule UUID"),
  },
  async ({ schedule_id }) => {
    const schedule = await cancelBudgetSchedule(sql, schedule_id);
    return text(schedule ?? { error: "Not found or not cancellable" });
  },
);

server.tool(
  "llm_delete_budget_schedule",
  "Delete a budget schedule",
  {
    schedule_id: z.string().describe("Schedule UUID"),
  },
  async ({ schedule_id }) => {
    const deleted = await deleteBudgetSchedule(sql, schedule_id);
    return text({ deleted });
  },
);

server.tool(
  "llm_budget_check_history",
  "Get budget check history for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    limit: z.number().optional().default(50).describe("Max results"),
  },
  async ({ workspace_id, limit }) =>
    text(await getBudgetCheckHistory(sql, workspace_id, limit)),
);

server.tool(
  "llm_process_due_schedules",
  "Process all periodic budget schedules that are due (for cron-triggered workers)",
  {},
  async () => {
    const processed = await processDueSchedules(sql);
    return text({ processed });
  },
);

// Usage forecasting

server.tool(
  "llm_forecast_usage",
  "Forecast end-of-month spend for a workspace based on current usage trends",
  { workspace_id: z.string() },
  async ({ workspace_id }) => {
    const forecast = await forecastUsage(sql, workspace_id);
    return forecast ? text(forecast) : text({ error: "No budget found for workspace" });
  },
);

server.tool(
  "llm_forecast_all_workspaces",
  "Get usage forecasts for all workspaces with budgets",
  {},
  async () => text(await forecastAllWorkspaces(sql)),
);

// Token usage optimizer

server.tool(
  "llm_get_token_usage_stats",
  "Get token usage statistics for a workspace over a time period",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    period_start: z.string().optional().describe("ISO date string for period start (default: 30 days ago)"),
    period_end: z.string().optional().describe("ISO date string for period end (default: now)"),
  },
  async ({ workspace_id, period_start, period_end }) => {
    const stats = await getTokenUsageStats(sql, workspace_id, {
      periodStart: period_start ? new Date(period_start) : undefined,
      periodEnd: period_end ? new Date(period_end) : undefined,
    });
    return stats ? text(stats) : text({ error: "No usage data found for workspace" });
  },
);

server.tool(
  "llm_get_token_optimization_suggestions",
  "Get cost optimization suggestions for a workspace based on usage patterns",
  {
    workspace_id: z.string().describe("Workspace UUID"),
  },
  async ({ workspace_id }) => {
    const suggestions = await getTokenOptimizationSuggestions(sql, workspace_id);
    return text({ suggestions, count: suggestions.length });
  },
);

server.tool(
  "llm_get_token_optimization_report",
  "Get a complete optimization report with stats and actionable suggestions",
  {
    workspace_id: z.string().describe("Workspace UUID"),
  },
  async ({ workspace_id }) => {
    const report = await getTokenOptimizationReport(sql, workspace_id);
    return report ? text(report) : text({ error: "No usage data found for workspace" });
  },
);


// --- Circuit breaker tools ---

server.tool(
  "llm_get_circuit_breaker",
  "Get the full circuit breaker object for a provider (state, config, stats)",
  { provider: z.string().describe("Provider name (openai, anthropic, groq)") },
  async ({ provider }) => {
    return text(await getCircuitBreaker(provider));
  },
);


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


// --- Direct provider chat tools ---

server.tool(
  "llm_chat_anthropic",
  "Send a chat request directly to Anthropic API",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).describe("Conversation messages"),
    model: z.string().optional().describe("Model (e.g. claude-3-5-sonnet-20241022)"),
    max_tokens: z.number().optional().describe("Max tokens to generate"),
    temperature: z.number().optional().describe("Sampling temperature"),
    api_key: z.string().optional().describe("Override ANTHROPIC_API_KEY"),
  },
  async ({ workspace_id, messages, model, max_tokens, temperature, api_key }) => {
    const result = await chatAnthropic({
      workspaceId: workspace_id,
      messages: messages as any,
      model,
      maxTokens: max_tokens,
      temperature,
      apiKey: api_key,
    });
    return text(result);
  },
);

server.tool(
  "llm_chat_openai",
  "Send a chat request directly to OpenAI API",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).describe("Conversation messages"),
    model: z.string().optional().describe("Model (e.g. gpt-4o)"),
    max_tokens: z.number().optional().describe("Max tokens to generate"),
    temperature: z.number().optional().describe("Sampling temperature"),
    api_key: z.string().optional().describe("Override OPENAI_API_KEY"),
  },
  async ({ workspace_id, messages, model, max_tokens, temperature, api_key }) => {
    const result = await chatOpenAI({
      workspaceId: workspace_id,
      messages: messages as any,
      model,
      maxTokens: max_tokens,
      temperature,
      apiKey: api_key,
    });
    return text(result);
  },
);

server.tool(
  "llm_chat_groq",
  "Send a chat request directly to Groq API",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).describe("Conversation messages"),
    model: z.string().optional().describe("Model (e.g. llama-3.1-70b-versatile)"),
    temperature: z.number().optional().describe("Sampling temperature"),
    api_key: z.string().optional().describe("Override GROQ_API_KEY"),
  },
  async ({ workspace_id, messages, model, temperature, api_key }) => {
    const result = await chatGroq({
      workspaceId: workspace_id,
      messages: messages as any,
      model,
      temperature,
      apiKey: api_key,
    });
    return text(result);
  },
);

server.tool(
  "llm_complete_openai",
  "Send a text completion request directly to OpenAI API",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    prompt: z.string().describe("Text prompt"),
    model: z.string().optional().describe("Model (e.g. gpt-4o-mini)"),
    max_tokens: z.number().optional().describe("Max tokens to generate"),
    temperature: z.number().optional().describe("Sampling temperature"),
    api_key: z.string().optional().describe("Override OPENAI_API_KEY"),
  },
  async ({ workspace_id, prompt, model, max_tokens, temperature, api_key }) => {
    const result = await completeOpenAI({
      workspaceId: workspace_id,
      prompt,
      model,
      maxTokens: max_tokens,
      temperature,
      apiKey: api_key,
    });
    return text(result);
  },
);


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


// ─── Fallback Chain Simulation ───────────────────────────────────────────────

server.tool(
  "llm_simulate_cascade",
  "Simulate a fallback chain cascade — test how a chain behaves when specific providers fail. Returns which step would be called and what error would occur at each stage.",
  {
    workspace_id: z.string().describe("Workspace ID"),
    messages: z.array(z.object({ role: z.string(), content: z.string() })).describe("Chat messages"),
    chain: z.array(z.object({ provider: z.string(), model: z.string() })).describe("Fallback chain steps"),
    fail_at_step: z.number().optional().describe("Simulate failure at this step index (1-based)"),
  },
  async ({ workspace_id, messages, chain, fail_at_step }) => {
    const { callWithFallback } = await import("../lib/providers.js");
    const steps: string[] = [];
    const errors: string[] = [];
    let reachedStep = 0;
    for (let i = 0; i < chain.length; i++) {
      const step = chain[i];
      if (fail_at_step && i + 1 >= fail_at_step) {
        errors.push(`Step ${i + 1}: Simulated failure for ${step.provider}/${step.model}`);
        steps.push(`${step.provider}/${step.model} → FAILED`);
        continue;
      }
      try {
        const result = await callWithFallback(sql, workspace_id, messages, step.model);
        steps.push(`${step.provider}/${step.model} → SUCCESS`);
        reachedStep = i + 1;
        break;
      } catch (e) {
        errors.push(`Step ${i + 1}: ${step.provider}/${step.model} → ${String(e)}`);
        steps.push(`${step.provider}/${step.model} → ERROR: ${String(e).slice(0, 100)}`);
      }
    }
    return text({
      cascade: steps,
      would_reach_step: reachedStep,
      total_steps: chain.length,
      simulation: { fail_at_step, errors },
    });
  },
);


// --- Function calling tools ---

server.tool(
  "llm_parse_tool_calls",
  "Parse a model response into structured tool calls",
  {
    model_output: z.string().describe("Raw model output text to parse"),
    tools: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      parameters: z.record(z.any()),
    })).describe("Tool definitions to match against"),
  },
  async ({ model_output, tools }) => {
    const calls = parseToolCalls(model_output, tools as any);
    return text({ tool_calls: calls, count: calls.length });
  },
);

server.tool(
  "llm_build_openai_tools",
  "Convert tool definitions to OpenAI function-calling format",
  {
    tools: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      parameters: z.record(z.any()),
    })).describe("Tool definitions"),
  },
  async ({ tools }) => {
    const openaiTools = buildOpenAITools(tools as any);
    return text({ tools: openaiTools, count: openaiTools.length });
  },
);

server.tool(
  "llm_execute_tool_call",
  "Execute a single tool call by invoking the registered function",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    tool_name: z.string().describe("Name of the tool to execute"),
    arguments: z.record(z.any()).describe("Tool arguments as key-value pairs"),
  },
  async ({ workspace_id, tool_name, arguments: args }) => {
    const result = await executeToolCall(sql, workspace_id, tool_name, args);
    return text(result);
  },
);


// --- Model latency and quality tools ---

server.tool(
  "llm_get_model_latency_stats",
  "Get latency percentiles (p50/p95/p99) for a specific model",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    model: z.string().describe("Model name"),
  },
  async ({ workspace_id, model }) => {
    const stats = await getModelLatencyStats(sql, workspace_id, model);
    if (!stats) return text({ error: "No latency data found for this model" });
    return text(stats);
  },
);

server.tool(
  "llm_get_all_model_latency_stats",
  "Get latency percentiles for all models in a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    period_hours: z.number().optional().default(24).describe("Time window in hours"),
  },
  async ({ workspace_id, period_hours }) => {
    const stats = await getAllModelLatencyStats(sql, workspace_id, period_hours);
    return text({ stats, count: stats.length });
  },
);

server.tool(
  "llm_compute_model_latency_stats",
  "Compute and persist latency percentiles for a model (writes to llm.model_latency_stats)",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    model: z.string().describe("Model name"),
    period_hours: z.number().optional().default(24).describe("Time window in hours"),
  },
  async ({ workspace_id, model, period_hours }) => {
    const stats = await computeModelLatencyStats(sql, workspace_id, model, period_hours);
    if (!stats) return text({ error: "No latency data found" });
    return text(stats);
  },
);

server.tool(
  "llm_record_quality_score",
  "Record a quality score for an LLM response (user or automated feedback)",
  {
    request_id: z.string().describe("Request UUID from the original LLM call"),
    workspace_id: z.string().describe("Workspace UUID"),
    model: z.string().describe("Model name"),
    score: z.number().min(0).max(100).describe("Quality score 0-100"),
    feedback: z.string().optional().describe("Optional text feedback"),
    scoring_type: z.enum(["user", "automated", "task_completion"]).optional().default("user"),
  },
  async (opts) => {
    const result = await recordQualityScore(sql, {
      requestId: opts.request_id,
      workspaceId: opts.workspace_id,
      model: opts.model,
      score: opts.score,
      feedback: opts.feedback,
      scoringType: opts.scoring_type,
    });
    return text(result);
  },
);

server.tool(
  "llm_get_model_quality_stats",
  "Get average quality scores per model for a workspace",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    period_days: z.number().optional().default(30).describe("Time window in days"),
  },
  async ({ workspace_id, period_days }) => {
    const stats = await getModelQualityStats(sql, workspace_id, period_days);
    return text({ stats, count: stats.length });
  },
);


// ─── Model Recommendation ────────────────────────────────────────────────────

server.tool(
  "llm_get_model_recommendation",
  "Get a model recommendation based on task type, quality requirements, and budget. Considers cost, latency, and capability match.",
  {
    workspace_id: z.string().describe("Workspace ID"),
    task: z.enum(["chat", "completion", "vision", "embedding", "function_calling"]).describe("Task type"),
    min_quality: z.number().min(0).max(100).optional().default(70).describe("Minimum quality score (0-100)"),
    max_latency_ms: z.number().optional().describe("Maximum acceptable latency in ms"),
    max_cost_per_1k: z.number().optional().describe("Maximum cost per 1K tokens"),
  },
  async ({ workspace_id, task, min_quality, max_latency_ms, max_cost_per_1k }) => {
    const { listModels } = await import("../lib/model-registry.js");
    const { computeModelLatencyStats } = await import("../lib/model-latency.js");
    const { COST_PER_1K_TOKENS } = await import("../lib/costs.js");
    const models = await listModels(sql, workspace_id);
    const candidates = models
      .filter(m => m.capabilities?.includes(task))
      .map(m => {
        const cost = COST_PER_1K_TOKENS[m.model_id] ?? COST_PER_1K_TOKENS.default;
        const avgCost = (cost.input + cost.output) / 2;
        const latencyStats = computeModelLatencyStats({ modelId: m.model_id, workspaceId: workspace_id });
        return { model: m, avgCost, latencyP50: latencyStats?.p50_ms ?? 9999, qualityScore: m.quality_score ?? 70 };
      })
      .filter(m => m.qualityScore >= min_quality)
      .filter(m => !max_latency_ms || m.latencyP50 <= max_latency_ms)
      .filter(m => !max_cost_per_1k || m.avgCost <= max_cost_per_1k)
      .sort((a, b) => {
        const costDiff = a.avgCost - b.avgCost;
        const latDiff = a.latencyP50 - b.latencyP50;
        return costDiff * 0.4 + latDiff * 0.0001; // cost-weighted
      });
    const recommended = candidates[0];
    return text({
      recommended: recommended?.model ?? null,
      alternatives: candidates.slice(1, 4).map(m => ({ model: m.model.model_id, cost_per_1k: m.avgCost, latency_p50_ms: m.latencyP50 })),
      filters: { task, min_quality, max_latency_ms, max_cost_per_1k },
    });
  },
);

server.tool(
  "llm_cost_preview",
  "Preview the estimated cost for an LLM request BEFORE making the call — estimates token count and calculates USD cost based on current model pricing",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).optional().describe("Conversation messages (mutually exclusive with text)"),
    text: z.string().optional().describe("Single text prompt (mutually exclusive with messages)"),
    model: z.string().optional().default("gpt-4o").describe("Model to estimate cost for"),
  },
  async ({ workspace_id, messages, text, model }) => {
    const content = text ?? (messages ? messages.map(m => `${m.role}: ${m.content}`).join("\n") : "");
    const estimated = countMessageTokens(content);
    const cost = calculateCost(model ?? "gpt-4o", estimated, Math.round(estimated * 0.4));
    return text({
      model: model ?? "gpt-4o",
      estimated_prompt_tokens: estimated,
      estimated_completion_tokens: Math.round(estimated * 0.4),
      estimated_total_tokens: Math.round(estimated * 1.4),
      estimated_cost_usd: cost,
      cost_per_1k_input: (cost / Math.max(estimated, 1)) * 1000,
      cost_per_1k_output: (cost / Math.max(Math.round(estimated * 0.4), 1)) * 1000,
      workspace_id,
    });
  },
);

server.tool(
  "llm_batch_stream",
  "Stream multiple prompts in parallel as individual SSE streams — yields a collection of Server-Sent Event streams, one per prompt, with full metadata per item",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    items: z.array(z.object({
      id: z.string().describe("Unique caller-provided ID to match results"),
      messages: z.array(z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      })).describe("Conversation messages"),
      model: z.string().optional(),
      temperature: z.number().optional(),
    })).min(1).max(50).describe("Array of prompts to stream (max 50)"),
    model: z.string().optional().describe("Default model if not specified per item"),
    max_concurrency: z.number().int().positive().optional().default(5).describe("Max parallel streams"),
  },
  async ({ workspace_id, items, model, max_concurrency }) => {
    const results: Array<{
      id: string;
      model: string;
      status: string;
      error?: string;
    }> = [];
    let active = 0;
    const queue = [...items];
    const start = Date.now();

    async function processNext(): Promise<void> {
      while (queue.length > 0) {
        const item = queue.shift()!;
        active++;
        try {
          const modelToUse = item.model ?? model ?? "gpt-4o";
          results.push({ id: item.id, model: modelToUse, status: "streaming" });
          const response = await chat(sql, {
            workspaceId: workspace_id,
            messages: item.messages as any,
            model: modelToUse,
          });
          const idx = results.findIndex(r => r.id === item.id);
          if (idx !== -1) results[idx] = { id: item.id, model: modelToUse, status: "done" };
        } catch (err: any) {
          const idx = results.findIndex(r => r.id === item.id);
          if (idx !== -1) results[idx] = { id: item.id, model: item.model ?? model ?? "gpt-4o", status: "error", error: err?.message ?? "Unknown error" };
        }
        active--;
      }
    }

    const workers = Array.from({ length: Math.min(max_concurrency, items.length) }, () => processNext());
    await Promise.all(workers);

    return text({
      workspace_id,
      total_items: items.length,
      results,
      duration_ms: Date.now() - start,
      summary: {
        done: results.filter(r => r.status === "done").length,
        errors: results.filter(r => r.status === "error").length,
        streaming: results.filter(r => r.status === "streaming").length,
      },
    });
  },
);

server.tool(
  "llm_provider_latency_ranking",
  "Get providers ranked by latency for a workspace — returns sorted list of providers by p50, p95, p99 latency so you can route to the fastest",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    period_hours: z.number().int().positive().optional().default(24).describe("Hours to look back"),
    sort_by: z.enum(["p50", "p95", "p99", "avg"]).optional().default("p95").describe("Latency percentile to sort by"),
  },
  async ({ workspace_id, period_hours, sort_by }) => {
    const since = new Date(Date.now() - period_hours * 3_600_000);
    const rows = await sql.unsafe(`
      SELECT
        provider,
        COUNT(*)::int AS total_requests,
        ROUND(AVG(latency_ms)::numeric, 2)::numeric AS avg_ms,
        ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms))::int AS p50_ms,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))::int AS p95_ms,
        ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms))::int AS p99_ms,
        ROUND(
          COUNT(*) FILTER (WHERE error IS NOT NULL)::numeric / NULLIF(COUNT(*), 0) * 100, 2
        )::numeric AS error_rate
      FROM llm.requests
      WHERE workspace_id = $1 AND created_at >= $2
      GROUP BY provider
      ORDER BY ${sort_by === "p50" ? "p50_ms" : sort_by === "p99" ? "p99_ms" : sort_by === "avg" ? "avg_ms" : "p95_ms"} ASC
    `, [workspace_id, since]) as any[];

    return text({
      workspace_id,
      period_hours,
      sort_by,
      rankings: rows.map((r, i) => ({
        rank: i + 1,
        provider: r.provider,
        total_requests: r.total_requests,
        avg_ms: Number(r.avg_ms),
        p50_ms: Number(r.p50_ms),
        p95_ms: Number(r.p95_ms),
        p99_ms: Number(r.p99_ms),
        error_rate: Number(r.error_rate),
      })),
      fastest: rows[0] ? { provider: rows[0].provider, p95_ms: Number(rows[0].p95_ms) } : null,
    });
  },
);

async function main(): Promise<void> {
  await migrate(sql);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);

// ─── Model Router ─────────────────────────────────────────────────────────────

server.tool(
  "llm_route_model",
  "Get the best model routes for a task given cost/latency constraints",
  {
    workspace_id: z.string(),
    task: z.enum(["chat", "completion", "embedding", "vision", "function_calling"]),
    max_cost: z.number().optional(),
    max_latency_ms: z.number().optional(),
    prefer_latency_ms: z.number().optional(),
    require_vision: z.boolean().optional(),
    require_function_calling: z.boolean().optional(),
    min_quality_score: z.number().optional(),
  },
  async (opts) => {
    const { routeModel } = await import("../lib/model-router.js");
    return text(await routeModel(sql, opts.workspace_id, opts.task as any, {
      maxCost: opts.max_cost,
      maxLatencyMs: opts.max_latency_ms,
      preferLatencyMs: opts.prefer_latency_ms,
      requireVision: opts.require_vision,
      requireFunctionCalling: opts.require_function_calling,
      minQualityScore: opts.min_quality_score,
    }));
  },
);

server.tool(
  "llm_route_by_cost",
  "Pick the cheapest model that satisfies a max cost constraint",
  {
    workspace_id: z.string(),
    task: z.enum(["chat", "completion", "embedding", "vision", "function_calling"]),
    max_cost_per_1k: z.number(),
  },
  async ({ workspace_id, task, max_cost_per_1k }) => {
    const { routeByCost } = await import("../lib/model-router.js");
    return text(await routeByCost(sql, workspace_id, task as any, max_cost_per_1k));
  },
);

server.tool(
  "llm_route_by_latency",
  "Pick the fastest model meeting a minimum quality threshold",
  {
    workspace_id: z.string(),
    task: z.enum(["chat", "completion", "embedding", "vision", "function_calling"]),
    min_quality: z.number().optional().default(70),
  },
  async ({ workspace_id, task, min_quality }) => {
    const { routeByLatency } = await import("../lib/model-router.js");
    return text(await routeByLatency(sql, workspace_id, task as any, min_quality));
  },
);


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


// --- Provider health tools ---

server.tool(
  "llm_get_provider_health",
  "Get health metrics for a specific provider (latency, error rate, uptime)",
  {
    provider: z.string().describe("Provider name"),
    period_hours: z.number().optional().default(24).describe("Time window in hours"),
  },
  async ({ provider, period_hours }) =>
    text(await getProviderHealth(sql, { provider, periodHours: period_hours })),
);

server.tool(
  "llm_list_provider_health",
  "Get health metrics for all providers",
  { period_hours: z.number().optional().default(24).describe("Time window in hours") },
  async ({ period_hours }) => text(await listProviderHealth(sql, { periodHours: period_hours })),
);

server.tool(
  "llm_get_circuit_status",
  "Get circuit breaker state for a provider",
  { provider: z.string().describe("Provider name") },
  async ({ provider }) => text(await getProviderCircuitStatus(sql, provider)),
);

server.tool(
  "llm_list_circuit_states",
  "Get circuit breaker state for all providers",
  {},
  async () => text(await getAllCircuitStates(sql)),
);

server.tool(
  "llm_reset_circuit",
  "Reset (force close) a provider's circuit breaker",
  { provider: z.string().describe("Provider name") },
  async ({ provider }) => {
    await resetProviderCircuit(sql, provider);
    return text({ provider, state: "closed" });
  },
);


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


// --- Streaming utilities ---

server.tool(
  "llm_parse_sse_line",
  "Parse a single SSE-formatted line into event data",
  {
    line: z.string().describe("One line from an SSE stream (format: 'data: {...}')"),
  },
  async ({ line }) => {
    const event = parseSSELine(line);
    return text(event ?? { parsed: false });
  },
);

server.tool(
  "llm_parse_sse_body",
  "Parse a complete SSE body string into structured events",
  {
    body: z.string().describe("Full SSE response body text"),
  },
  async ({ body }) => {
    const events = parseSSEBody(body);
    return text({ events, count: events.length });
  },
);

server.tool(
  "llm_sse_encode",
  "Encode a data object as an SSE-formatted string",
  {
    event: z.string().optional().describe("Event name (e.g. 'chunk', 'done')"),
    data: z.union([z.string(), z.record(z.any())]).describe("Data to encode"),
    id: z.string().optional().describe("Optional event ID"),
  },
  async ({ event, data, id }) => {
    const encoded = sseEncode(event ?? "", data, id);
    return text({ encoded });
  },
);

server.tool(
  "llm_stream_to_text",
  "Convert a streaming response into full text by collecting all chunks",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).describe("Conversation messages"),
    model: z.string().optional().describe("Model to use"),
  },
  async ({ workspace_id, messages, model }) => {
    const { chatStream } = await import("../lib/gateway.js");
    const stream = chatStream(sql, {
      workspaceId: workspace_id,
      messages: messages as Message[],
      model: model ?? undefined,
    });
    const fullText = await streamToText(stream);
    return text({ content: fullText });
  },
);

server.tool(
  "llm_stream_to_sse",
  "Convert a chat stream into SSE (Server-Sent Events) format — yields data chunks as SSE events",
  {
    workspace_id: z.string().describe("Workspace UUID for usage tracking"),
    messages: z.array(z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })).describe("Conversation messages"),
    model: z.string().optional().describe("Model to use"),
    provider: z.enum(["openai", "anthropic", "groq"]).optional().describe("Provider to use"),
  },
  async ({ workspace_id, messages, model, provider }) => {
    const { chatStream } = await import("../lib/gateway.js");
    const stream = chatStream(sql, {
      workspaceId: workspace_id,
      messages: messages as Message[],
      model: model ?? undefined,
    });
    const sseStream = streamToSSE(stream as any, { model, provider });
    // Collect SSE stream into an array of strings for the response
    const reader = sseStream.getReader();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = new TextDecoder().decode(value);
      chunks.push(text);
    }
    return text({ sse_chunks: chunks.join("") });
  },
);


// ─── Token Usage Optimizer ────────────────────────────────────────────────────

server.tool(
  "llm_get_token_stats",
  "Get detailed token usage statistics for a workspace — breakdown by model, daily usage, cost per request",
  {
    workspace_id: z.string().uuid().describe("Workspace UUID"),
    period_start: z.string().optional().describe("ISO date — start of analysis window (default 30 days ago)"),
    period_end: z.string().optional().describe("ISO date — end of analysis window (default now)"),
  },
  async ({ workspace_id, period_start, period_end }) => {
    const { getTokenUsageStats } = await import("../lib/token-usage-optimizer.js");
    const stats = await getTokenUsageStats(sql, workspace_id, {
      periodStart: period_start ? new Date(period_start) : undefined,
      periodEnd: period_end ? new Date(period_end) : undefined,
    });
    return text(stats);
  },
);

server.tool(
  "llm_get_token_stats",
  "Get detailed token usage statistics for a workspace — breakdown by model, daily usage, cost per request",
  {
    workspace_id: z.string().uuid().describe("Workspace UUID"),
    period_start: z.string().optional().describe("ISO date — start of analysis window (default 30 days ago)"),
    period_end: z.string().optional().describe("ISO date — end of analysis window (default now)"),
  },
  async ({ workspace_id, period_start, period_end }) => {
    const { getTokenUsageStats } = await import("../lib/token-usage-optimizer.js");
    const stats = await getTokenUsageStats(sql, workspace_id, {
      periodStart: period_start ? new Date(period_start) : undefined,
      periodEnd: period_end ? new Date(period_end) : undefined,
    });
    return text(stats);
  },
);

server.tool(
  "llm_get_optimization_suggestions",
  "Get token optimization suggestions for a workspace — identify opportunities to reduce token usage and costs",
  {
    workspace_id: z.string().uuid().describe("Workspace UUID"),
  },
  async ({ workspace_id }) => {
    const { getTokenOptimizationSuggestions } = await import("../lib/token-usage-optimizer.js");
    const suggestions = await getTokenOptimizationSuggestions(sql, workspace_id);
    return text({ suggestions });
  },
);

server.tool(
  "llm_get_optimization_report",
  "Get a full token optimization report with statistics and actionable suggestions",
  {
    workspace_id: z.string().uuid().describe("Workspace UUID"),
  },
  async ({ workspace_id }) => {
    const { getTokenOptimizationReport } = await import("../lib/token-usage-optimizer.js");
    const report = await getTokenOptimizationReport(sql, workspace_id);
    return text(report);
  },
);

// --- Fallback strategy management ---

server.tool(
  "llm_set_fallback_strategy",
  "Set a fallback chain for a model — requests fail over to the next model in the chain on errors or circuit breaker open",
  {
    model_name: z.string().describe("Primary model name"),
    fallback_models: z.array(z.string()).describe("Ordered list of fallback models"),
    enabled: z.boolean().optional().default(true),
  },
  async ({ model_name, fallback_models, enabled }) => {
    const { setFallbackStrategy } = await import("../lib/costs.js");
    return text(await setFallbackStrategy(sql, model_name, fallback_models, enabled));
  },
);

server.tool(
  "llm_get_fallback_strategy",
  "Get the configured fallback chain for a model",
  { model_name: z.string().describe("Model name to get fallback chain for") },
  async ({ model_name }) => {
    const { getFallbackStrategy } = await import("../lib/costs.js");
    return text(await getFallbackStrategy(sql, model_name));
  },
);

// --- Model budget spend recording ---

server.tool(
  "llm_record_model_spend",
  "Record spend against a model's budget in a workspace — used for tracking costs per model",
  {
    workspace_id: z.string(),
    model_name: z.string(),
    cost_usd: z.number().describe("Cost in USD"),
    tokens_used: z.number().int().optional().describe("Total tokens used (prompt + completion)"),
  },
  async ({ workspace_id, model_name, cost_usd, tokens_used }) => {
    const { recordModelSpend } = await import("../lib/model-budgets.js");
    await recordModelSpend(sql, workspace_id, model_name, cost_usd, tokens_used);
    return text({ recorded: true });
  },
);

// --- Prompt versioning ---

server.tool(
  "llm_create_prompt_version",
  "Create a versioned snapshot of a prompt template before updating it — enables rollback and audit trail",
  {
    template_id: z.string().describe("Template ID to version"),
    content: z.string().describe("Current template content"),
    variables: z.array(z.string()).describe("Template variable names"),
    description: z.string().optional().describe("Version description"),
    changed_by: z.string().optional().describe("User who made the change"),
    change_reason: z.string().optional().describe("Reason for the change"),
  },
  async ({ template_id, content, variables, description, changed_by, change_reason }) => {
    const { createPromptVersion } = await import("../lib/prompt-versioning.js");
    const version = await createPromptVersion(sql, { templateId: template_id, content, variables, description, changedBy: changed_by, changeReason: change_reason });
    return text(version);
  },
);

server.tool(
  "llm_get_prompt_versions",
  "List all versions of a prompt template",
  { template_id: z.string().describe("Template ID to get versions for") },
  async ({ template_id }) => {
    const { getPromptVersions } = await import("../lib/prompt-versioning.js");
    const versions = await getPromptVersions(sql, template_id);
    return text({ versions, count: versions.length });
  },
);

server.tool(
  "llm_get_prompt_version",
  "Get a specific version of a prompt template",
  {
    template_id: z.string().describe("Template ID"),
    version_number: z.number().int().describe("Version number to retrieve"),
  },
  async ({ template_id, version_number }) => {
    const { getPromptVersion } = await import("../lib/prompt-versioning.js");
    const version = await getPromptVersion(sql, template_id, version_number);
    return text(version);
  },
);

server.tool(
  "llm_compare_prompt_versions",
  "Compare two versions of a prompt template side by side",
  {
    template_id: z.string().describe("Template ID"),
    version_a: z.number().int().describe("First version number"),
    version_b: z.number().int().describe("Second version number"),
  },
  async ({ template_id, version_a, version_b }) => {
    const { comparePromptVersions } = await import("../lib/prompt-versioning.js");
    const comparison = await comparePromptVersions(sql, template_id, version_a, version_b);
    return text(comparison);
  },
);

server.tool(
  "llm_restore_prompt_version",
  "Restore a prompt template to a previous version",
  {
    template_id: z.string().describe("Template ID to restore"),
    version_number: z.number().int().describe("Version number to restore to"),
    changed_by: z.string().optional().describe("User performing the restore"),
  },
  async ({ template_id, version_number, changed_by }) => {
    const { restorePromptVersion } = await import("../lib/prompt-versioning.js");
    const restored = await restorePromptVersion(sql, template_id, version_number, changed_by);
    return text(restored);
  },
);

// --- Model comparison ---

server.tool(
  "llm_compare_models",
  "Run a side-by-side benchmark comparison of multiple models on the same prompt",
  {
    workspace_id: z.string().uuid().optional().describe("Workspace UUID for usage tracking"),
    benchmark_prompt: z.string().describe("The prompt to benchmark all models with"),
    models: z.array(z.string()).describe("List of model names to compare"),
    system_prompt: z.string().optional().describe("Optional system prompt to prepend"),
  },
  async ({ workspace_id, benchmark_prompt, models, system_prompt }) => {
    const { compareModels } = await import("../lib/model-comparison.js");
    const results = await compareModels(sql, { workspaceId: workspace_id, benchmarkPrompt: benchmark_prompt, models, systemPrompt: system_prompt });
    return text({ results, winner: results.find(r => !r.error)?.model ?? null });
  },
);

server.tool(
  "llm_get_comparisons",
  "Get historical model comparison results",
  {
    workspace_id: z.string().uuid().optional().describe("Filter by workspace"),
    limit: z.number().int().optional().default(20).describe("Max results to return"),
  },
  async ({ workspace_id, limit }) => {
    const { getModelComparisons } = await import("../lib/model-comparison.js");
    const comparisons = await getModelComparisons(sql, { workspaceId: workspace_id, limit });
    return text({ comparisons, count: comparisons.length });
  },
);

server.tool(
  "llm_get_best_model",
  "Get the best-performing model recommendation based on historical comparisons",
  { workspace_id: z.string().uuid().optional().describe("Workspace UUID") },
  async ({ workspace_id }) => {
    const { getBestModelRecommendation } = await import("../lib/model-comparison.js");
    const rec = await getBestModelRecommendation(sql, { workspaceId: workspace_id });
    return text(rec);
  },
);

// --- Pre-call cost estimation ---

server.tool(
  "llm_estimate_cost",
  "Estimate the cost of an LLM call before making it",
  {
    workspace_id: z.string().uuid().describe("Workspace UUID"),
    model: z.string().describe("Model name"),
    prompt_tokens: z.number().int().describe("Estimated number of prompt tokens"),
    max_tokens: z.number().int().describe("Maximum tokens to generate"),
  },
  async ({ workspace_id, model, prompt_tokens, max_tokens }) => {
    const { estimateCallCost } = await import("../lib/cost-estimation.js");
    const estimate = await estimateCallCost(sql, { workspaceId: workspace_id, model, promptTokens: prompt_tokens, maxTokens: max_tokens });
    return text(estimate);
  },
);

server.tool(
  "llm_finalize_estimate",
  "Update a cost estimate with the actual cost after a call completes",
  {
    estimate_id: z.string().uuid().describe("Cost estimate ID returned from llm_estimate_cost"),
    actual_cost_usd: z.number().describe("Actual cost in USD"),
  },
  async ({ estimate_id, actual_cost_usd }) => {
    const { finalizeCostEstimate } = await import("../lib/cost-estimation.js");
    await finalizeCostEstimate(sql, { estimateId: estimate_id, actualCost: actual_cost_usd });
    return text({ updated: true });
  },
);

server.tool(
  "llm_batch_estimate_costs",
  "Estimate costs for multiple models at once — useful for model selection decisions",
  {
    workspace_id: z.string().uuid().describe("Workspace UUID"),
    models: z.array(z.string()).describe("List of model names to estimate for"),
    prompt_tokens: z.number().int().describe("Estimated prompt tokens"),
    max_tokens: z.number().int().describe("Max tokens to generate"),
  },
  async ({ workspace_id, models, prompt_tokens, max_tokens }) => {
    const { estimateBatchCosts } = await import("../lib/cost-estimation.js");
    const estimates = await estimateBatchCosts(sql, { workspaceId: workspace_id, models, promptTokens: prompt_tokens, maxTokens: max_tokens });
    // Sort by cost ascending
    estimates.sort((a, b) => a.estimated_cost_usd - b.estimated_cost_usd);
    return text({ estimates, cheapest: estimates[0]?.model ?? null });
  },
);

server.tool(
  "llm_get_estimate_accuracy",
  "Get cost estimation accuracy statistics",
  {
    workspace_id: z.string().uuid().optional().describe("Filter by workspace"),
    model: z.string().optional().describe("Filter by model"),
  },
  async ({ workspace_id, model }) => {
    const { getCostEstimateAccuracy } = await import("../lib/cost-estimation.js");
    const stats = await getCostEstimateAccuracy(sql, { workspaceId: workspace_id, model });
    return text(stats);
  },
);

// --- Chain health dashboard ---

server.tool(
  "llm_get_chain_health",
  "Get a high-level fallback chain health summary for a workspace — success rate, avg latency, fallback hit rate, and cost per provider",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    period_hours: z.number().optional().default(168).describe("Time window in hours (default 168 = 7 days)"),
  },
  async ({ workspace_id, period_hours }) => {
    const { getProviderChainStats } = await import("../lib/fallback-chains.js");
    const { listProviderHealth } = await import("../lib/provider-health.js");
    const { getWorkspaceBudget } = await import("../lib/costs.js");

    const [chainStats, providerHealth, budget] = await Promise.all([
      getProviderChainStats(sql, workspace_id),
      listProviderHealth(sql, { periodHours: period_hours }),
      getWorkspaceBudget(sql, workspace_id),
    ]);

    // Get fallback rate from DB (executions where providers_tried > 1)
    const fallbackRow = await sql<[{ total_chains: bigint; total_fallbacks: bigint }]>`
      SELECT
        COUNT(*) as total_chains,
        COUNT(*) FILTER (WHERE providers_tried > 1) as total_fallbacks
      FROM llm.fallback_chain_executions
      WHERE workspace_id = ${workspace_id}
        AND created_at >= NOW() - INTERVAL '${sql.unsafe(String(period_hours))} hours'
    `;

    const totalChains = Number(fallbackRow[0]?.total_chains ?? 0n);
    const totalFallbacks = Number(fallbackRow[0]?.total_fallbacks ?? 0n);

    // Enrich chain stats with health data
    const providerMap = Object.fromEntries(providerHealth.map((p: any) => [p.provider, p]));
    const enriched = chainStats.map((ps: any) => ({
      ...ps,
      health: providerMap[ps.provider] ?? null,
    }));

    return text({
      workspace_id,
      period_hours,
      providers: enriched,
      total_chains: totalChains,
      total_fallbacks: totalFallbacks,
      fallback_rate_pct: totalChains > 0
        ? Math.round((totalFallbacks / totalChains) * 10000) / 100
        : 0,
      budget: budget ?? null,
    });
  },
);

// --- Budget burn rate analysis ---

server.tool(
  "llm_get_budget_burn_rate",
  "Get budget burn rate analysis — current spend, days elapsed, daily burn rate, projected month-end spend, and days until budget exhausted",
  {
    workspace_id: z.string().describe("Workspace UUID"),
  },
  async ({ workspace_id }) => {
    const { getWorkspaceBudget } = await import("../lib/costs.js");
    const { getWorkspaceUsageSummary } = await import("../lib/usage-analytics.js");
    const { forecastUsage } = await import("../lib/budget-scheduler.js");

    const [budget, usage, forecast] = await Promise.all([
      getWorkspaceBudget(sql, workspace_id),
      getWorkspaceUsageSummary(sql, { workspaceId: workspace_id, periodHours: 720 }),
      forecastUsage(sql, workspace_id),
    ]);

    if (!budget) return text({ error: "No budget set for workspace", workspace_id });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = Math.max(1, Math.ceil((now.getTime() - startOfMonth.getTime()) / (1000 * 60 * 60 * 24)));
    const dailyBurnRate = daysElapsed > 0 ? (usage.total_cost_usd / daysElapsed) : 0;
    const daysRemaining = daysInMonth - daysElapsed;
    const projectedSpend = dailyBurnRate * daysInMonth;
    const daysUntilExhausted = dailyBurnRate > 0 && budget.monthly_limit_usd > 0
      ? Math.floor(budget.monthly_limit_usd / dailyBurnRate)
      : null;

    return text({
      workspace_id,
      budget_monthly_limit_usd: budget.monthly_limit_usd,
      current_spend_usd: usage.total_cost_usd,
      utilization_pct: budget.monthly_limit_usd > 0
        ? Math.round((usage.total_cost_usd / budget.monthly_limit_usd) * 10000) / 100
        : 0,
      days_elapsed: daysElapsed,
      days_remaining,
      days_in_month: daysInMonth,
      daily_burn_rate_usd: Math.round(dailyBurnRate * 100) / 100,
      projected_month_end_spend_usd: Math.round(projectedSpend * 100) / 100,
      days_until_exhausted,
      forecast: forecast ?? null,
    });
  },
);

// --- Token velocity (tokens per hour trend) ---

server.tool(
  "llm_get_token_velocity",
  "Get token usage velocity (tokens per hour) over a time period — useful for detecting usage spikes or drops",
  {
    workspace_id: z.string().describe("Workspace UUID"),
    period_hours: z.number().optional().default(24).describe("Time window in hours"),
    bucket_minutes: z.number().optional().default(60).describe("Aggregation bucket in minutes"),
  },
  async ({ workspace_id, period_hours, bucket_minutes }) => {
    const rows = await sql<{ bucket: Date; total_tokens: bigint }[]>`
      SELECT
        date_trunc('minute', created_at) -
          (EXTRACT(MINUTE FROM created_at)::int % ${bucket_minutes}) * interval '1 minute' AS bucket,
        SUM(prompt_tokens + completion_tokens) AS total_tokens
      FROM llm.model_spend
      WHERE workspace_id = ${workspace_id}
        AND created_at >= NOW() - INTERVAL '${sql.unsafe(String(period_hours))} hours'
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    const buckets = rows.map((r: any) => ({
      timestamp: r.bucket,
      tokens_per_hour: Math.round((Number(r.total_tokens) / bucket_minutes) * 60 * 100) / 100,
    }));

    const totalTokens = rows.reduce((sum: bigint, r: any) => sum + r.total_tokens, 0n);
    const avgTokensPerHour = buckets.length > 0
      ? Math.round((Number(totalTokens) / period_hours) * 100) / 100
      : 0;

    return text({
      workspace_id,
      period_hours,
      bucket_minutes,
      buckets,
      avg_tokens_per_hour: avgTokensPerHour,
      total_tokens: Number(totalTokens),
    });
  },
);

server.tool(
  "llm_prompt_diff",
  "Compute a detailed diff between two versions of a prompt template",
  {
    template_id: z.string().describe("Prompt template UUID"),
    version_a: z.number().int().positive().describe("First version number to compare"),
    version_b: z.number().int().positive().describe("Second version number to compare"),
  },
  async ({ template_id, version_a, version_b }) => {
    const diff = await computePromptDiff(sql, template_id, version_a, version_b);
    return text(diff);
  },
);

server.tool(
  "llm_prompt_side_by_side",
  "Get a side-by-side comparison of two prompt template versions",
  {
    template_id: z.string().describe("Prompt template UUID"),
    version_a: z.number().int().positive().describe("First version number"),
    version_b: z.number().int().positive().describe("Second version number"),
  },
  async ({ template_id, version_a, version_b }) => {
    const comparison = await getPromptVersionSideBySide(sql, template_id, version_a, version_b);
    return text(comparison);
  },
);


// --- Usage analytics tools ---

server.tool(
  "llm_usage_summary",
  "Get usage summary for a workspace (total requests, tokens, cost)",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_hours: z.number().optional().default(720).describe("Time window in hours (default 720 = 30 days)"),
  },
  async ({ workspace_id, period_hours }) =>
    text(await getWorkspaceUsageSummary(sql, { workspaceId: workspace_id, periodHours: period_hours })),
);

server.tool(
  "llm_model_breakdown",
  "Get per-model usage and cost breakdown for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_hours: z.number().optional().default(720).describe("Time window in hours"),
    limit: z.number().optional().default(20).describe("Max models to return"),
  },
  async ({ workspace_id, period_hours, limit }) =>
    text(await getModelBreakdown(sql, { workspaceId: workspace_id, periodHours: period_hours, limit })),
);

server.tool(
  "llm_daily_usage",
  "Get daily usage trend for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_days: z.number().optional().default(30).describe("Number of past days to include"),
  },
  async ({ workspace_id, period_days }) =>
    text(await getDailyUsage(sql, { workspaceId: workspace_id, periodDays: period_days })),
);

server.tool(
  "llm_provider_breakdown",
  "Get per-provider usage and cost breakdown for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_hours: z.number().optional().default(720).describe("Time window in hours"),
  },
  async ({ workspace_id, period_hours }) =>
    text(await getProviderBreakdown(sql, { workspaceId: workspace_id, periodHours: period_hours })),
);

server.tool(
  "llm_top_users",
  "Get top users by LLM usage and cost for a workspace",
  {
    workspace_id: z.string().describe("Workspace ID"),
    period_hours: z.number().optional().default(720).describe("Time window in hours"),
    limit: z.number().optional().default(10).describe("Max users to return"),
  },
  async ({ workspace_id, period_hours, limit }) =>
    text(await getTopUsers(sql, { workspaceId: workspace_id, periodHours: period_hours, limit })),
);


// ─── Usage Velocity ───────────────────────────────────────────────────────────

server.tool(
  "llm_get_usage_velocity",
  "Get request and spend velocity over time windows (requests/min, spend/min) for a workspace. Useful for detecting traffic spikes and billing anomalies.",
  {
    workspace_id: z.string().describe("Workspace ID"),
    windows: z.array(z.number()).optional().default([1, 5, 15, 60]).describe("Time windows in minutes to compute velocity over"),
  },
  async ({ workspace_id, windows }) => {
    const { getWorkspaceUsage } = await import("../lib/usage.js");
    const now = Date.now();
    const results: Record<string, { requests_per_min: number; cost_per_min: number; total_requests: number; total_cost: number }> = {};
    for (const windowMin of windows.slice(0, 6)) {
      const since = new Date(now - windowMin * 60 * 1000);
      const usage = await getWorkspaceUsage(sql, workspace_id, since);
      const divisor = windowMin || 1;
      results[`${windowMin}m`] = {
        requests_per_min: Math.round((usage.total_requests / divisor) * 100) / 100,
        cost_per_min: Math.round((usage.total_cost_usd / divisor) * 10000) / 10000,
        total_requests: usage.total_requests,
        total_cost: Math.round(usage.total_cost_usd * 1000000) / 1000000,
      };
    }
    return text({ workspace_id, velocities: results });
  },
);


// --- Webhook tools ---

server.tool(
  "llm_register_webhook",
  "Register a webhook endpoint for budget/circuit notifications",
  {
    workspace_id: z.string().describe("Workspace ID"),
    url: z.string().describe("Webhook URL (must be HTTPS)"),
    secret: z.string().describe("Shared secret for signing payloads"),
    event_types: z.array(z.enum([
      "budget_threshold",
      "budget_exceeded",
      "model_budget_exceeded",
      "circuit_open",
      "circuit_close",
    ])).describe("Event types to subscribe to"),
  },
  async ({ workspace_id, url, secret, event_types }) =>
    text(await registerWebhook(sql, { workspaceId: workspace_id, url, secret, eventTypes: event_types as any[] })),
);

server.tool(
  "llm_delete_webhook",
  "Delete a registered webhook endpoint",
  {
    workspace_id: z.string().describe("Workspace ID"),
    webhook_id: z.string().describe("Webhook ID to delete"),
  },
  async ({ workspace_id, webhook_id }) => {
    await deleteWebhook(sql, webhook_id, workspace_id);
    return text({ deleted: true });
  },
);

server.tool(
  "llm_list_webhooks",
  "List all registered webhook endpoints for a workspace",
  { workspace_id: z.string().describe("Workspace ID") },
  async ({ workspace_id }) => text(await listWebhooks(sql, workspace_id)),
);

server.tool(
  "llm_fire_webhook",
  "Manually fire a webhook to a specific URL with a payload (for testing)",
  {
    url: z.string().describe("Webhook URL"),
    secret: z.string().describe("Webhook secret for HMAC signature"),
    event: z.string().describe("Event type"),
    workspace_id: z.string().describe("Workspace ID"),
    data: z.record(z.unknown()).optional().describe("Event data payload"),
  },
  async ({ url, secret, event, workspace_id, data }) => {
    const result = await fireWebhook(url, secret, {
      event: event as WebhookEventType,
      workspaceId: workspace_id,
      timestamp: new Date().toISOString(),
      data: data ?? {},
    });
    return text(result);
  },
);

server.tool(
  "llm_fire_budget_alert",
  "Manually trigger a budget alert webhook notification",
  {
    workspace_id: z.string().describe("Workspace ID"),
    event_type: z.enum(["budget_threshold", "budget_exceeded"]).describe("Alert type"),
    spend_usd: z.number().describe("Current spend in USD"),
    limit_usd: z.number().describe("Budget limit in USD"),
    threshold_pct: z.number().describe("Threshold percentage that triggered"),
    model_name: z.string().optional().describe("Model name if model-level budget"),
  },
  async ({ workspace_id, event_type, spend_usd, limit_usd, threshold_pct, model_name }) => {
    await notifyBudgetAlert(sql, {
      workspaceId: workspace_id,
      eventType: event_type as any,
      spendUsd: spend_usd,
      limitUsd: limit_usd,
      thresholdPct: threshold_pct,
      ...(model_name && { modelName: model_name }),
    });
    return text({ notified: true });
  },
);


