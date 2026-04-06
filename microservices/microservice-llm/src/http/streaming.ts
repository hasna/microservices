/**
 * SSE (Server-Sent Events) streaming endpoint for LLM responses.
 * Wraps chat_stream with proper SSE framing and budget tracking.
 */

import type { Sql } from "postgres";
import { sseEncode } from "../streaming.js";
import { chatStream } from "../lib/gateway.js";
import { recordSpend } from "../lib/costs.js";
import { executeChainWithLog } from "../lib/fallback-chains.js";
import { checkModelBudget } from "../lib/model-budgets.js";
import { getCircuitBreaker } from "../lib/circuit-breaker.js";
import { getWorkspaceBudget } from "../lib/costs.js";
import { getFallbackStrategy } from "../lib/costs.js";
import { calculateCost } from "../lib/costs.js";
import { callProvider } from "../lib/providers.js";
import { type Message } from "../lib/providers.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Fallback-Chain",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function makeStreamingRouter(sql: Sql) {
  return async function streamingRouter(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path !== "/stream" && path !== "/v1/chat/stream") {
      return new Response("Not Found", { status: 404 });
    }

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      const body = await req.json();
      const {
        workspace_id,
        messages,
        model,
        fallback_chain,
        max_tokens,
        temperature,
        timeout_ms,
      } = body as {
        workspace_id: string;
        messages: Message[];
        model?: string;
        fallback_chain?: string[];
        max_tokens?: number;
        temperature?: number;
        timeout_ms?: number;
      };

      if (!workspace_id || !messages?.length) {
        return json({ error: "workspace_id and messages are required" }, 400);
      }

      // Check workspace budget
      const budget = await getWorkspaceBudget(sql, workspace_id);
      if (budget && budget.current_spend >= budget.monthly_limit_usd) {
        return json({ error: "Workspace budget exceeded", budget }, 402);
      }

      // Resolve fallback chain
      let chain = fallback_chain ?? [];
      if (!chain.length) {
        const strategy = await getFallbackStrategy(sql, workspace_id);
        chain = strategy?.chain ?? [model ?? "gpt-4o"];
      }

      // SSE stream
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          const send = (event: string, data: unknown) => {
            controller.enqueue(encoder.encode(sseEncode(data, event)));
          };

          try {
            send("start", { workspace_id, model: model ?? chain[0] });

            // Use chain with streaming if available
            const chainResult = await executeChainWithLog(
              sql,
              workspace_id,
              chain.map((m) => ({ model: m })),
              messages,
              {
                model,
                maxTokens: max_tokens,
                temperature,
              },
            );

            if (!chainResult.success) {
              send("error", { error: chainResult.error ?? "All providers failed" });
              controller.close();
              return;
            }

            // Stream the response from the successful provider
            let fullContent = "";
            let completionTokens = 0;
            let latencyMs = 0;
            const startTime = Date.now();

            const streamResponse = await callProvider(
              chainResult.providerUsed,
              chainResult.modelUsed,
              messages,
              {
                model: chainResult.modelUsed,
                maxTokens: max_tokens,
                temperature,
                stream: true,
              },
            );

            if (streamResponse && "asyncIterable" in streamResponse) {
              // Bun native streaming
              // Bun's Response body is directly iterable
              // Try to get the actual stream
            } else if (streamResponse && "stream" in (streamResponse as any)) {
              const reader = ((streamResponse as any).stream as ReadableStream<string>).getReader();
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                fullContent += value;
                send("chunk", { content: value, provider: chainResult.providerUsed });
              }
              latencyMs = Date.now() - startTime;
            }

            // Record spend
            const cost = calculateCost(
              chainResult.modelUsed,
              (streamResponse as any)?.usage?.prompt_tokens ?? 0,
              completionTokens,
            );
            if (cost > 0) {
              await recordSpend(sql, workspace_id, chainResult.modelUsed, chainResult.providerUsed, cost);
            }

            // Check per-model budget
            const modelStatus = await checkModelBudget(sql, workspace_id, chainResult.modelUsed, cost);
            if (modelStatus.alert === "exceeded") {
              send("budget_alert", { model: chainResult.modelUsed, alert: "exceeded", budget: modelStatus.budget });
            } else if (modelStatus.alert === "threshold") {
              send("budget_alert", { model: chainResult.modelUsed, alert: "threshold", budget: modelStatus.budget });
            }

            send("done", {
              content: fullContent,
              model: chainResult.modelUsed,
              provider: chainResult.providerUsed,
              latency_ms: latencyMs,
              cost_usd: cost,
              chain_log_id: chainResult.logId,
            });
          } catch (err) {
            send("error", { error: err instanceof Error ? err.message : "Stream failed" });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
        },
      });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "Bad request" }, 400);
    }
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
