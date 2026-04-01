/**
 * LLM gateway — routes requests to the correct provider,
 * records usage to the database, and returns enriched responses.
 */

import type { Sql } from "postgres";
import { calculateCost } from "./costs.js";
import type { ChatResponse } from "./providers.js";
import {
  callProvider,
  getAvailableModels,
  getProvider,
  type Message,
} from "./providers.js";

export interface GatewayRequest {
  workspaceId: string;
  messages: Message[];
  model?: string;
  stream?: false;
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
