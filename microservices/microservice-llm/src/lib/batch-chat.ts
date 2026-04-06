/**
 * Batch chat — parallel chat completion across multiple conversation threads.
 *
 * Unlike `batchComplete` which operates on flat prompts, this module handles
 * full multi-turn conversation threads (Message[]) in parallel, with per-item
 * error handling, cost tracking, and optional semantic cache lookup.
 */

import type { Sql } from "postgres";
import type { Message, ChatResponse } from "./providers.js";
import { chat } from "./gateway.js";
import { calculateCost } from "./costs.js";
import { getCachedByHash, cacheResponse } from "./semantic-cache.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchChatItem {
  id: string; // caller-provided unique ID to match results
  messages: Message[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface BatchChatResult {
  id: string;
  success: boolean;
  response?: ChatResponse;
  error?: string;
  cached?: boolean;
  costUsd?: number;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}

export interface BatchChatOptions {
  workspaceId: string;
  apiKey: string;
  items: BatchChatItem[];
  model?: string; // default model if not specified per item
  maxConcurrency?: number; // max parallel calls (default 10)
  useCache?: boolean; // check semantic cache before calling (default true)
  recordSpend?: boolean; // record spend in database (default true)
}

/**
 * Execute multiple chat conversations in parallel with concurrency control.
 * Each item can specify its own model or inherit the default.
 * Results are returned in the same order as the input items.
 */
export async function batchChat(
  sql: Sql,
  opts: BatchChatOptions,
): Promise<BatchChatResult[]> {
  const {
    workspaceId,
    apiKey,
    items,
    model: defaultModel,
    maxConcurrency = 10,
    useCache = true,
    recordSpend = true,
  } = opts;

  const results: (BatchChatResult | undefined)[] = new Array(items.length);
  let currentIndex = 0;
  let running = 0;

  async function runOne(idx: number, item: BatchChatItem): Promise<void> {
    const start = Date.now();
    try {
      const model = item.model ?? defaultModel ?? "gpt-4o";

      // Check cache if enabled
      if (useCache) {
        const cacheKey = JSON.stringify(item.messages);
        const cacheHit = await getCachedByHash(sql, workspaceId, cacheKey);
        if (cacheHit && cacheHit.model === model) {
          const latencyMs = Date.now() - start;
          results[idx] = {
            id: item.id,
            success: true,
            response: {
              content: cacheHit.response_content,
              model: cacheHit.model,
              provider: cacheHit.provider,
              usage: {
                prompt_tokens: cacheHit.prompt_tokens,
                completion_tokens: cacheHit.completion_tokens,
                total_tokens: cacheHit.prompt_tokens + cacheHit.completion_tokens,
              },
              cached: true,
            },
            cached: true,
            costUsd: 0,
            latencyMs,
            metadata: item.metadata,
          };
          return;
        }
      }

      // Call chat
      const response = await chat(sql, workspaceId, {
        messages: item.messages,
        model,
        temperature: item.temperature,
        maxTokens: item.maxTokens,
      }, apiKey);

      const latencyMs = Date.now() - start;
      const costUsd = calculateCost(
        response.usage?.prompt_tokens ?? 0,
        response.usage?.completion_tokens ?? 0,
        model,
      );

      // Cache the response
      if (useCache) {
        const cacheKey = JSON.stringify(item.messages);
        cacheResponse(sql, {
          workspaceId,
          prompt: cacheKey,
          responseContent: response.content,
          model,
          provider: response.provider,
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          costUsd,
        }).catch(() => { /* non-fatal */ });
      }

      results[idx] = {
        id: item.id,
        success: true,
        response,
        costUsd,
        latencyMs,
        metadata: item.metadata,
      };
    } catch (err) {
      results[idx] = {
        id: item.id,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start,
        metadata: item.metadata,
      };
    } finally {
      running--;
      // Kick off next item
      if (currentIndex < items.length) {
        running++;
        const nextIdx = currentIndex++;
        runOne(nextIdx, items[nextIdx]).catch(() => {
          results[nextIdx] = { id: items[nextIdx].id, success: false, error: "Unexpected error" };
          running--;
        });
      }
    }
  }

  // Kick off initial batch up to concurrency limit
  const initialCount = Math.min(maxConcurrency, items.length);
  for (let i = 0; i < initialCount; i++) {
    running++;
    currentIndex++;
    runOne(i, items[i]).catch(() => {
      results[i] = { id: items[i].id, success: false, error: "Unexpected error" };
      running--;
    });
  }

  // Wait for all to complete
  await new Promise<void>((resolve) => {
    const check = () => {
      if (results.every((r) => r !== undefined)) resolve();
      else setTimeout(check, 20);
    };
    check();
  });

  return results as BatchChatResult[];
}

/**
 * Get a summary of batch chat results — aggregated stats across all items.
 */
export function summarizeBatchResults(results: BatchChatResult[]): {
  total: number;
  successful: number;
  failed: number;
  cached: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  totalLatencyMs: number;
} {
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const cached = results.filter((r) => r.cached).length;
  const totalCostUsd = results.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const latencies = results.map((r) => r.latencyMs ?? 0);
  const totalLatencyMs = latencies.reduce((s, l) => s + l, 0);
  const avgLatencyMs = results.length > 0 ? totalLatencyMs / results.length : 0;

  return { total: results.length, successful, failed, cached, totalCostUsd, avgLatencyMs, totalLatencyMs };
}
