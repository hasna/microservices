/**
 * LLM gateway — routes requests to the correct provider,
 * records usage to the database, and returns enriched responses.
 */

import type { Sql } from "postgres";
import { calculateCost, checkBudgetAndAlert } from "./costs.js";
import { checkRateLimit } from "./ratelimit.js";
import type { ChatResponse, StreamChunk } from "./providers.js";
import {
  callProvider,
  callProviderStream,
  countMessageTokens,
  getAvailableModels,
  getProvider,
  type Message,
} from "./providers.js";

export interface GatewayRequest {
  workspaceId: string;
  messages: Message[];
  model?: string;
  stream?: boolean;
}

export interface GatewayResponse extends ChatResponse {
  request_id: string;
  cost_usd: number;
  cached: boolean;
}

export async function chat(
  sql: Sql,
  data: GatewayRequest,
): Promise<GatewayResponse> {
  const model = data.model ?? pickDefaultModel();
  const providerName = getProvider(model, {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    groq: process.env.GROQ_API_KEY,
  });

  // Check rate limit
  const limitStatus = await checkRateLimit(sql, data.workspaceId, providerName);
  if (!limitStatus.allowed) {
    throw Object.assign(
      new Error(
        `Rate limit exceeded. Retry after ${limitStatus.retry_after_ms}ms`,
      ),
      {
        code: "RATE_LIMITED",
        retry_after_ms: limitStatus.retry_after_ms,
        reset_at: limitStatus.reset_at.toISOString(),
      },
    );
  }

  const start = Date.now();
  let response: ChatResponse;
  let errorMsg: string | null = null;

  try {
    response = await callProvider(providerName, data.messages, model);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    // Record failed request
    const [row] = await sql<[{ id: string }]>`
      INSERT INTO llm.requests (workspace_id, model, provider, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, cached, error)
      VALUES (${data.workspaceId}, ${model}, ${providerName}, 0, 0, 0, 0, ${Date.now() - start}, false, ${errorMsg})
      RETURNING id
    `;
    throw Object.assign(err as Error, { request_id: row?.id });
  }

  const latencyMs = Date.now() - start;
  const costUsd = calculateCost(
    model,
    response.usage.prompt_tokens,
    response.usage.completion_tokens,
  );

  const [row] = await sql<[{ id: string }]>`
    INSERT INTO llm.requests (workspace_id, model, provider, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, cached)
    VALUES (
      ${data.workspaceId},
      ${response.model},
      ${providerName},
      ${response.usage.prompt_tokens},
      ${response.usage.completion_tokens},
      ${response.usage.total_tokens},
      ${costUsd},
      ${latencyMs},
      false
    )
    RETURNING id
  `;

  return {
    ...response,
    request_id: row?.id,
    cost_usd: costUsd,
    cached: false,
  };
}

function pickDefaultModel(): string {
  const models = getAvailableModels();
  if (models.length === 0)
    throw new Error(
      "No LLM providers configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY.",
    );
  return models[0]!;
}

export interface GatewayStreamRequest extends GatewayRequest {
  stream?: true;
}

/**
 * Streaming chat with rate limiting.
 */
export async function* chatStream(
  sql: Sql,
  data: GatewayStreamRequest,
): AsyncGenerator<StreamChunk & { request_id: string }> {
  const model = data.model ?? pickDefaultModel();
  const providerName = getProvider(model, {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    groq: process.env.GROQ_API_KEY,
  });

  // Check rate limit before starting stream
  const limitStatus = await checkRateLimit(
    sql,
    data.workspaceId,
    providerName,
  );
  if (!limitStatus.allowed) {
    throw Object.assign(
      new Error(
        `Rate limit exceeded. Retry after ${limitStatus.retry_after_ms}ms`,
      ),
      {
        code: "RATE_LIMITED",
        retry_after_ms: limitStatus.retry_after_ms,
        reset_at: limitStatus.reset_at.toISOString(),
      },
    );
  }

  // Insert a placeholder request row first to get an ID
  const [row] = await sql<[{ id: string }]>`
    INSERT INTO llm.requests (workspace_id, model, provider, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, cached)
    VALUES (${data.workspaceId}, ${model}, ${providerName}, 0, 0, 0, 0, 0, false)
    RETURNING id
  `;
  const requestId = row?.id ?? "";

  const stream = callProviderStream(providerName, {
    model,
    messages: data.messages,
  });

  let totalTokens = 0;
  for await (const chunk of stream) {
    totalTokens +=
      (chunk.usage?.total_tokens ?? 0) -
      (chunk.usage?.prompt_tokens ?? 0);
    yield { ...chunk, request_id: requestId };
  }
}

// ---------------------------------------------------------------------------
// ReadableStream-based SSE chat (for HTTP streaming endpoints)
// ---------------------------------------------------------------------------

export interface ChatStreamOptions {
  workspaceId: string;
  messages: Message[];
  model?: string;
}

/**
 * Returns a ReadableStream of SSE-formatted chat chunks.
 * Each chunk is `data: {...}\n\n` where ... is a JSON-encoded StreamChunk.
 * Includes request_id and budget_warning in the SSE payload.
 */
export function chat_stream(
  sql: Sql,
  data: ChatStreamOptions,
): ReadableStream<Uint8Array> {
  const model = data.model ?? pickDefaultModel();
  const providerName = getProvider(model, {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    groq: process.env.GROQ_API_KEY,
  });

  // Run rate-limit check + get request ID synchronously via an async IIFE
  const ctrl = new AbortController();
  const signal = ctrl.signal;

  // We build the ReadableStream with an async start controller
  let requestId = "";
  let budgetWarning: string | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Rate limit check
        const limitStatus = await checkRateLimit(sql, data.workspaceId, providerName);
        if (!limitStatus.allowed) {
          const err = { error: `Rate limit exceeded. Retry after ${limitStatus.retry_after_ms}ms`, code: "RATE_LIMITED" };
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(err)}\n\n`));
          controller.close();
          return;
        }

        // Budget check before streaming
        const estimatedTokens = countMessageTokens(data.messages);
        const estimatedCost = calculateCost(model, estimatedTokens, estimatedTokens);
        const budgetResult = await checkBudgetAndAlert(sql, data.workspaceId, estimatedCost);
        if (!budgetResult.allowed) {
          const err = { error: "Budget exceeded", code: "BUDGET_EXCEEDED" };
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(err)}\n\n`));
          controller.close();
          return;
        }
        if (budgetResult.alert === "threshold") {
          budgetWarning = `Budget threshold reached (${budgetResult.budget?.alert_threshold_pct ?? 80}%). Consider topping up.`;
        }

        // Insert placeholder request row to get an ID
        const [row] = await sql<[{ id: string }]>`
          INSERT INTO llm.requests (workspace_id, model, provider, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, cached)
          VALUES (${data.workspaceId}, ${model}, ${providerName}, 0, 0, 0, 0, 0, false)
          RETURNING id
        `;
        requestId = row?.id ?? "";

        // Stream chunks
        const providerStream = callProviderStream(providerName, {
          model,
          messages: data.messages,
          signal,
        });

        for await (const chunk of providerStream) {
          const payload = {
            ...chunk,
            request_id: requestId,
            ...(budgetWarning ? { budget_warning: budgetWarning } : {}),
          };
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
          if (chunk.done) break;
        }
      } catch (err) {
        if (!signal.aborted) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`));
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      ctrl.abort();
    },
  });

  return stream;
}

// ---------------------------------------------------------------------------
// Completion (prompt-only) streaming SSE
// ---------------------------------------------------------------------------

export interface CompleteStreamOptions {
  workspaceId: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Returns a ReadableStream of SSE-formatted completion chunks.
 */
export function complete_stream(
  sql: Sql,
  data: CompleteStreamOptions,
): ReadableStream<Uint8Array> {
  const model = data.model ?? pickDefaultModel();
  const providerName = getProvider(model, {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    groq: process.env.GROQ_API_KEY,
  });

  const ctrl = new AbortController();
  const signal = ctrl.signal;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Rate limit check
        const limitStatus = await checkRateLimit(sql, data.workspaceId, providerName);
        if (!limitStatus.allowed) {
          const err = { error: `Rate limit exceeded. Retry after ${limitStatus.retry_after_ms}ms`, code: "RATE_LIMITED" };
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(err)}\n\n`));
          controller.close();
          return;
        }

        // Budget check
        const estimatedTokens = estimatePromptTokens(data.prompt);
        const estimatedCost = calculateCost(model, estimatedTokens, data.maxTokens ?? 128);
        const budgetResult = await checkBudgetAndAlert(sql, data.workspaceId, estimatedCost);
        if (!budgetResult.allowed) {
          const err = { error: "Budget exceeded", code: "BUDGET_EXCEEDED" };
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(err)}\n\n`));
          controller.close();
          return;
        }

        // Insert placeholder request row
        const [row] = await sql<[{ id: string }]>`
          INSERT INTO llm.requests (workspace_id, model, provider, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, cached)
          VALUES (${data.workspaceId}, ${model}, ${providerName}, 0, 0, 0, 0, 0, false)
          RETURNING id
        `;
        const requestId = row?.id ?? "";

        // Call completion stream
        let stream: AsyncGenerator<StreamChunk>;
        if (providerName === "anthropic") {
          // Anthropic has no /completions endpoint — convert prompt to single user message
          const { chatAnthropicStream } = await import("./providers.js");
          const apiKey = process.env.ANTHROPIC_API_KEY!;
          stream = chatAnthropicStream({
            model,
            messages: [{ role: "user", content: data.prompt }],
            apiKey,
            signal,
          });
        } else {
          // OpenAI and Groq use OpenAI-compatible /completions endpoint
          const apiKey = providerName === "openai"
            ? process.env.OPENAI_API_KEY!
            : process.env.GROQ_API_KEY!;
          const { completeOpenAIStream } = await import("./providers.js");
          stream = completeOpenAIStream({
            model,
            apiKey,
            prompt: data.prompt,
            maxTokens: data.maxTokens ?? 256,
            signal,
          });
        }

        for await (const chunk of stream) {
          const payload = { ...chunk, request_id: requestId };
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
          if (chunk.done) break;
        }
      } catch (err) {
        if (!signal.aborted) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`));
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      ctrl.abort();
    },
  });
}

function estimatePromptTokens(prompt: string): number {
  // Simple estimator: ~4 chars per token
  return Math.ceil(prompt.length / 4) + 4 + (prompt.match(/\n/g) ?? []).length;
}
