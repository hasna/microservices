/**
 * @hasna/microservice-llm — LLM gateway library.
 *
 * Usage in your app:
 *   import { migrate, chat, getWorkspaceUsage } from '@hasna/microservice-llm'
 *   const sql = getDb('postgres://...')
 *   await migrate(sql)
 *   const response = await chat(sql, { workspaceId: '...', messages: [...] })
 */

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";
// Costs
export {
  COST_PER_1K_TOKENS,
  calculateCost,
  checkBudgetAndAlert,
  getBudgetAlerts,
  getBudgetAlertsTyped,
  getFallbackStrategy,
  getWorkspaceBudget,
  recordSpend,
  setBudgetAlert,
  setFallbackStrategy,
  setWorkspaceBudget,
  type BudgetAlert,
  type WorkspaceBudget,
} from "./costs.js";
// Gateway
export {
  chat,
  chatStream,
  chat_stream,
  complete_stream,
  type ChatStreamOptions,
  type CompleteStreamOptions,
  type GatewayRequest,
  type GatewayResponse,
  type GatewayStreamRequest,
} from "./gateway.js";

// Rate limiting
export {
  checkRateLimit,
  setRateLimit,
  type RateLimitConfig,
  type RateLimitStatus,
} from "./ratelimit.js";
// Providers
export {
  batchComplete,
  chatCompleteStream,
  type ChatResponse,
  completeOpenAI,
  completeOpenAIStream,
  countMessageTokens,
  countTokens,
  type CompletionOptions,
  type CompletionResponse,
  type BatchCompleteOptions,
  callProvider,
  callProviderStream,
  callWithFallback,
  chatAnthropic,
  chatAnthropicStream,
  chatGroq,
  chatOpenAI,
  chatOpenAIStream,
  collectStream,
  getAvailableModels,
  getProvider,
  streamToSSE,
  streamWithFallback,
  type FallbackChainItem,
  type Message,
  type ProviderConfig,
  type ProviderName,
  type StreamChunk,
  type StreamingChatOptions,
} from "./providers.js";

// Usage
export {
  getWorkspaceUsage,
  type ModelUsage,
  type WorkspaceUsage,
} from "./usage.js";

// Prompt templates
export {
  createPromptTemplate,
  deletePromptTemplate,
  getPromptTemplate,
  getTemplateVersionHistory,
  listPromptTemplates,
  renderPromptTemplate,
  updatePromptTemplate,
  type CreatePromptTemplateInput,
  type PromptTemplate,
  type RenderedPrompt,
  type UpdatePromptTemplateInput,
} from "./prompt-templates.js";

// Embeddings
export {
  cacheEmbedding,
  generateEmbedding,
  generateEmbeddings,
  getCachedEmbedding,
  pruneEmbeddingCache,
  type EmbeddingOptions,
  type EmbeddingResult,
  type StoredEmbedding,
} from "./embeddings.js";

// Model registry
export {
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
  type CreateModelInput,
  type CreateProviderInput,
  type ModelAlias,
  type ModelCapability,
  type ModelInfo,
  type ProviderInfo,
  type ProviderType,
} from "./model-registry.js";
// Function calling
export {
  registerTools,
  listTools,
  deleteTool,
  parseToolCalls,
  buildOpenAITools,
  executeToolCall,
  executeToolCallsParallel,
  type ToolDefinition,
  type ToolCall,
  type ToolCallResult,
  type FunctionCallResponse,
} from "./function-calling.js";
// Semantic cache
export {
  cacheResponse,
  getCachedByHash,
  getCachedByEmbedding,
  listCachedResponses,
  invalidateCache,
  getCacheStats,
  type CachedResponse,
} from "./semantic-cache.js";
// Vision
export {
  chatVision,
  chatOpenAIVision,
  chatAnthropicVision,
  buildVisionContent,
  modelSupportsVision,
  type ImageInput,
  type ImageURL,
  type ImageBase64,
  type VisionMessage,
  type VisionRequest,
  type VisionResponse,
} from "./vision.js";
// Circuit Breaker
export {
  type CircuitBreakerStats,
  type CircuitBreakerConfig,
  type ProviderCircuitState,
  getCircuitBreaker,
  recordSuccess,
  recordFailure,
  isProviderAvailable,
  getCircuitBreakerStats,
  resetCircuitBreaker,
} from "./circuit-breaker.js";
// Model Budgets
export {
  type ModelBudget,
  type ModelSpend,
  type BudgetCheckResult,
  setModelBudget,
  getModelBudget,
  checkModelBudget,
  recordModelSpend,
  listModelBudgets,
  deleteModelBudget,
} from "./model-budgets.js";
// Webhook notifier
export {
  type WebhookEndpoint,
  type WebhookEventType,
  type WebhookPayload,
  registerWebhook,
  deleteWebhook,
  listWebhooks,
  fireWebhook,
  notifyBudgetAlert,
} from "./webhook-notifier.js";
// Provider health
export {
  type ProviderHealthMetrics,
  type ProviderCircuitStatus,
  getProviderHealth,
  listProviderHealth,
  getProviderCircuitStatus,
  getAllCircuitStates,
  resetProviderCircuit,
} from "./provider-health.js";
// Usage analytics
export {
  type WorkspaceUsageSummary,
  type ModelBreakdown,
  type DailyUsage,
  type TopUser,
  getWorkspaceUsageSummary,
  getModelBreakdown,
  getDailyUsage,
  getTopUsers,
  getProviderBreakdown,
} from "./usage-analytics.js";
// Streaming
export {
  parseSSELine,
  parseSSEBody,
  sseEncode,
  rawStreamToSSEEvents,
  aggregateStreams,
  withStreamingMetrics,
  streamToText,
  collectStreamText,
  type SSEEvent,
  type AggregatedChunk,
  type StreamingMetrics,
  type StreamingSessionOptions,
} from "./streaming.js";
// Fallback chains
export {
  executeChainWithLog,
  executeStreamingChainWithLog,
  listChainExecutions,
  getChainExecutionDetails,
  getProviderChainStats,
  getPopularChains,
  pruneChainLogs,
  type ChainExecutionLog,
  type ChainExecutionDetail,
  type ChainStats,
  type ChainStreamResult,
} from "./fallback-chains.js";
// Budget scheduler
export {
  createBudgetSchedule,
  listBudgetSchedules,
  getBudgetSchedule,
  cancelBudgetSchedule,
  deleteBudgetSchedule,
  runBudgetSchedule,
  processDueSchedules,
  getBudgetCheckHistory,
  type BudgetSchedule,
  type BudgetScheduleConfig,
  type BudgetScheduleStatus,
  type BudgetScheduleAction,
  type BudgetCheckResult,
} from "./budget-scheduler.js";
// Usage forecasting
export {
  forecastUsage,
  forecastAllWorkspaces,
  type UsageForecast,
} from "./usage-forecast.js";
// Token usage optimizer
export {
  getTokenUsageStats,
  getTokenOptimizationSuggestions,
  getTokenOptimizationReport,
  type TokenUsageStats,
  type ModelUsageBreakdown,
  type DailyUsage,
  type TokenOptimizationSuggestion,
  type TokenOptimizationReport,
} from "./token-usage-optimizer.js";
// Model latency, quality scoring, and conversation tracking
export {
  computeModelLatencyStats,
  getModelLatencyStats,
  getAllModelLatencyStats,
  recordQualityScore,
  getModelQualityStats,
  startConversation,
  addConversationMessage,
  getConversationCost,
  type ModelLatencyStats,
  type QualityScore,
  type Conversation,
} from "./model-latency.js";
// Batch chat completion
export {
  batchChat,
  summarizeBatchResults,
  type BatchChatItem,
  type BatchChatOptions,
  type BatchChatResult,
} from "./batch-chat.js";
// Usage anomaly detection
export {
  detectUsageAnomalies,
  acknowledgeAnomaly,
  getRecentAnomalies,
  type AnomalyAlert,
  type UsageAnomalyConfig,
  type AnomalySeverity,
} from "./usage-anomaly.js";
// Prompt versioning
export {
  createPromptVersion,
  getPromptVersions,
  getPromptVersion,
  comparePromptVersions,
  restorePromptVersion,
  type PromptVersion,
} from "./prompt-versioning.js";
// Model comparison
export {
  compareModels,
  getModelComparisons,
  getBestModelRecommendation,
  type ModelComparison,
  type ModelComparisonResult,
} from "./model-comparison.js";
// Cost estimation
export {
  estimateCallCost,
  finalizeCostEstimate,
  getCostEstimateAccuracy,
  estimateBatchCosts,
  type CostEstimate,
} from "./cost-estimation.js";
// Prompt diff
export {
  computePromptDiff,
  getPromptVersionSideBySide,
  type PromptDiffResult,
  type PromptChange,
} from "./prompt-diff.js";
// Observability (tracing, span logging)
export {
  generateTraceId,
  generateSpanId,
  createTraceContext,
  logCallStart,
  logCallEnd,
  getTraceSpans,
  listWorkspaceTraces,
  withTrace,
  type TraceContext,
  type LlmCallStart,
  type LlmCallEnd,
  type LlmSpan,
} from "./observability.js";
// Model router (cost/latency aware routing)
export {
  routeModel,
  routeByCost,
  routeByLatency,
  type TaskType,
  type RouteConstraints,
  type ModelRoute,
  type ModelRankingScore,
} from "./model-router.js";
// Request coalescing (batching concurrent requests)
export {
  RequestCoalescer,
  getGlobalCoalescer,
  type CoalescedRequest,
  type CoalescerOptions,
} from "./request-coalescer.js";
