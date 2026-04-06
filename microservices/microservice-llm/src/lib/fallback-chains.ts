/**
 * Fallback chain execution tracking for microservice-llm.
 *
 * - Records each chain execution (which provider was tried in what order)
 * - Tracks per-provider latency and cost within a chain
 * - Stores chain execution logs for analysis and visualization
 * - Provides chain execution analytics
 */

import type { Sql } from "postgres";
import type {
  ChatResponse,
  FallbackChainItem,
  ProviderName,
  StreamChunk,
} from "./providers.js";
import { callProvider, callProviderStream } from "./providers.js";
import {
  getCircuitBreaker,
  recordSuccess as recordCircuitSuccess,
  recordFailure as recordCircuitFailure,
  isProviderAvailable,
} from "./circuit-breaker.js";
import { calculateCost } from "./costs.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChainExecutionLog {
  id: string;
  workspace_id: string;
  chain: FallbackChainItem[];
  providers_tried: number;
  provider_used: ProviderName;
  model_used: string;
  latency_ms: number;
  cost_usd: number;
  success: boolean;
  error: string | null;
  started_at: Date;
  completed_at: Date;
}

export interface ChainExecutionDetail {
  execution_id: string;
  provider: ProviderName;
  model: string;
  attempt: number;
  latency_ms: number;
  cost_usd: number;
  success: boolean;
  error: string | null;
  started_at: Date;
  completed_at: Date;
}

export interface ChainStats {
  provider: ProviderName;
  total_calls: number;
  successful_calls: number;
  failed_calls: number;
  avg_latency_ms: number;
  total_cost_usd: number;
  circuit_state: "closed" | "open" | "half_open";
}

// ---------------------------------------------------------------------------
// Chain execution with logging
// ---------------------------------------------------------------------------

/**
 * Execute a fallback chain and log the result to the database.
 * Automatically skips providers whose circuit breakers are open.
 */
export async function executeChainWithLog(
  sql: Sql,
  workspaceId: string,
  chain: FallbackChainItem[],
  messages: import("./providers.js").Message[],
): Promise<ChatResponse & { fallback_used: number; chain_execution_id: string }> {
  const executionId = crypto.randomUUID();
  const startedAt = new Date();

  // Log the overall chain execution
  await sql`
    INSERT INTO llm.fallback_chain_executions
      (id, workspace_id, chain, providers_tried, provider_used, model_used,
       latency_ms, cost_usd, success, error, started_at, completed_at)
    VALUES (
      ${executionId}, ${workspaceId}, ${JSON.stringify(chain)}::JSONB,
      0, 'openai'::TEXT, ''::TEXT,
      0, 0, false, NULL, ${startedAt}, NOW()
    )
  `;

  let lastError: Error | null = null;
  let providerUsed: ProviderName = "openai";
  let modelUsed = "";
  let latencyMs = 0;
  let costUsd = 0;
  let providersTried = 0;
  let fallbackUsed = 0;

  for (let i = 0; i < chain.length; i++) {
    const { provider, model } = chain[i]!;

    // Skip if circuit is open
    if (!isProviderAvailable(provider)) {
      continue;
    }

    providersTried++;
    const providerStart = Date.now();

    try {
      const response = await callProvider(provider, messages, model);
      latencyMs = Date.now() - providerStart;
      costUsd = calculateCost(
        model,
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
      );
      providerUsed = provider;
      modelUsed = model;
      fallbackUsed = i;

      recordCircuitSuccess(provider);

      // Log individual provider attempt
      await logProviderAttempt(sql, executionId, provider, model, i + 1, latencyMs, costUsd, true, null);

      // Update chain execution log
      await sql`
        UPDATE llm.fallback_chain_executions
        SET
          providers_tried = ${providersTried},
          provider_used = ${providerUsed}::TEXT,
          model_used = ${modelUsed},
          latency_ms = ${latencyMs},
          cost_usd = ${costUsd},
          success = true,
          completed_at = NOW()
        WHERE id = ${executionId}
      `;

      return { ...response, fallback_used: i, chain_execution_id: executionId };
    } catch (err) {
      lastError = err as Error;
      recordCircuitFailure(provider);
      latencyMs = Date.now() - providerStart;

      await logProviderAttempt(sql, executionId, provider, model, i + 1, latencyMs, 0, false, lastError.message);

      // Update providers_tried count even on failure
      await sql`
        UPDATE llm.fallback_chain_executions
        SET providers_tried = ${providersTried}, completed_at = NOW()
        WHERE id = ${executionId}
      `;
    }
  }

  // All providers failed
  await sql`
    UPDATE llm.fallback_chain_executions
    SET
      providers_tried = ${providersTried},
      success = false,
      error = ${lastError?.message ?? "All fallback providers failed"},
      completed_at = NOW()
    WHERE id = ${executionId}
  `;

  throw lastError ?? new Error("All fallback providers failed");
}

async function logProviderAttempt(
  sql: Sql,
  executionId: string,
  provider: ProviderName,
  model: string,
  attempt: number,
  latencyMs: number,
  costUsd: number,
  success: boolean,
  error: string | null,
): Promise<void> {
  const startedAt = new Date(Date.now() - latencyMs);
  await sql`
    INSERT INTO llm.fallback_chain_details
      (execution_id, provider, model, attempt, latency_ms, cost_usd,
       success, error, started_at, completed_at)
    VALUES (
      ${executionId}, ${provider}::TEXT, ${model},
      ${attempt}, ${latencyMs}, ${costUsd},
      ${success}, ${error}, ${startedAt}, NOW()
    )
  `;
}

// ---------------------------------------------------------------------------
// Streaming chain execution with logging
// ---------------------------------------------------------------------------

export interface ChainStreamResult {
  stream: AsyncGenerator<StreamChunk>;
  fallback_used: number;
  chain_execution_id: string;
}

/**
 * Execute a streaming fallback chain and log the result.
 */
export async function executeStreamingChainWithLog(
  sql: Sql,
  workspaceId: string,
  chain: FallbackChainItem[],
  opts: { model: string; messages: import("./providers.js").Message[] },
): Promise<ChainStreamResult> {
  const executionId = crypto.randomUUID();
  const startedAt = new Date();

  await sql`
    INSERT INTO llm.fallback_chain_executions
      (id, workspace_id, chain, providers_tried, provider_used, model_used,
       latency_ms, cost_usd, success, error, started_at, completed_at)
    VALUES (
      ${executionId}, ${workspaceId}, ${JSON.stringify(chain)}::JSONB,
      0, 'openai'::TEXT, ''::TEXT,
      0, 0, false, NULL, ${startedAt}, NOW()
    )
  `;

  let lastError: Error | null = null;
  let providersTried = 0;
  let fallbackUsed = 0;

  for (let i = 0; i < chain.length; i++) {
    const { provider, model } = chain[i]!;

    if (!isProviderAvailable(provider)) continue;

    providersTried++;
    const providerStart = Date.now();

    try {
      const stream = callProviderStream(provider, { ...opts, model });
      fallbackUsed = i;
      recordCircuitSuccess(provider);

      // Log provider attempt
      await logProviderAttempt(sql, executionId, provider, model, i + 1, 0, 0, true, null);

      // Update chain execution
      await sql`
        UPDATE llm.fallback_chain_executions
        SET
          providers_tried = ${providersTried},
          provider_used = ${provider}::TEXT,
          model_used = ${model},
          success = true,
          completed_at = NOW()
        WHERE id = ${executionId}
      `;

      return {
        stream,
        fallback_used: i,
        chain_execution_id: executionId,
      };
    } catch (err) {
      lastError = err as Error;
      recordCircuitFailure(provider);
      const latencyMs = Date.now() - providerStart;

      await logProviderAttempt(sql, executionId, provider, model, i + 1, latencyMs, 0, false, lastError.message);

      await sql`
        UPDATE llm.fallback_chain_executions
        SET providers_tried = ${providersTried}, completed_at = NOW()
        WHERE id = ${executionId}
      `;
    }
  }

  await sql`
    UPDATE llm.fallback_chain_executions
    SET
      providers_tried = ${providersTried},
      success = false,
      error = ${lastError?.message ?? "All fallback providers failed for streaming"},
      completed_at = NOW()
    WHERE id = ${executionId}
  `;

  throw lastError ?? new Error("All fallback providers failed for streaming");
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * Get chain execution logs for a workspace.
 */
export async function listChainExecutions(
  sql: Sql,
  workspaceId: string,
  limit = 50,
  offset = 0,
): Promise<ChainExecutionLog[]> {
  return sql`
    SELECT * FROM llm.fallback_chain_executions
    WHERE workspace_id = ${workspaceId}
    ORDER BY started_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

/**
 * Get detailed provider attempts for a chain execution.
 */
export async function getChainExecutionDetails(
  sql: Sql,
  executionId: string,
): Promise<ChainExecutionDetail[]> {
  return sql`
    SELECT * FROM llm.fallback_chain_details
    WHERE execution_id = ${executionId}
    ORDER BY attempt ASC
  `;
}

/**
 * Get aggregate stats per provider across all chain executions.
 */
export async function getProviderChainStats(
  sql: Sql,
  workspaceId?: string,
): Promise<ChainStats[]> {
  const base = workspaceId
    ? sql`WHERE workspace_id = ${workspaceId}`
    : sql;

  const rows = await sql`
    SELECT
      provider_used as provider,
      COUNT(*) as total_calls,
      SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful_calls,
      SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) as failed_calls,
      AVG(latency_ms)::INT as avg_latency_ms,
      SUM(cost_usd) as total_cost_usd
    FROM llm.fallback_chain_executions
    ${base}
    GROUP BY provider_used
    ORDER BY total_calls DESC
  `;

  // Enrich with circuit breaker state
  const providers = rows.map((r) => r.provider as ProviderName);
  const circuits = providers.map((p) => getCircuitBreaker(p).state);

  return rows.map((row, i) => ({
    ...row,
    provider: row.provider as ProviderName,
    total_calls: Number(row.total_calls),
    successful_calls: Number(row.successful_calls),
    failed_calls: Number(row.failed_calls),
    avg_latency_ms: Number(row.avg_latency_ms),
    total_cost_usd: Number(row.total_cost_usd),
    circuit_state: circuits[i] as "closed" | "open" | "half_open",
  }));
}

/**
 * Get the most commonly used fallback chains for a workspace.
 */
export async function getPopularChains(
  sql: Sql,
  workspaceId: string,
  limit = 10,
): Promise<{ chain: FallbackChainItem[]; count: number; avg_latency_ms: number }[]> {
  const rows = await sql`
    SELECT
      chain,
      COUNT(*) as count,
      AVG(latency_ms)::INT as avg_latency_ms
    FROM llm.fallback_chain_executions
    WHERE workspace_id = ${workspaceId} AND success = true
    GROUP BY chain
    ORDER BY count DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    chain: row.chain as FallbackChainItem[],
    count: Number(row.count),
    avg_latency_ms: Number(row.avg_latency_ms),
  }));
}

/**
 * Prune old chain execution logs.
 */
export async function pruneChainLogs(
  sql: Sql,
  olderThanDays = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const [result] = await sql`
    WITH deleted AS (
      DELETE FROM llm.fallback_chain_executions
      WHERE started_at < ${cutoff}
      RETURNING id
    )
    SELECT COUNT(*) as count FROM deleted
  `;

  await sql`DELETE FROM llm.fallback_chain_details WHERE execution_id NOT IN (SELECT id FROM llm.fallback_chain_executions)`;

  return Number(result.count);
}
