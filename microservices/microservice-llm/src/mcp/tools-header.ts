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
