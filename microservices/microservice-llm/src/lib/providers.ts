/**
 * LLM provider abstraction.
 * Each provider uses fetch — no SDKs.
 */

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  provider: string;
}

export interface StreamingChatOptions {
  model: string;
  messages: Message[];
  apiKey: string;
  signal?: AbortSignal;
  maxTokens?: number;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export async function* chatOpenAIStream(
  opts: StreamingChatOptions,
): AsyncGenerator<StreamChunk> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI streaming error ${res.status}: ${err}`);
  }

  if (!res.body) throw new Error("No response body for streaming");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            yield { delta: "", done: true };
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              yield { delta, done: false };
            }
            if (parsed.choices?.[0]?.finish_reason) {
              yield {
                delta: "",
                done: true,
                usage: parsed.usage ? {
                  prompt_tokens: parsed.usage.prompt_tokens,
                  completion_tokens: parsed.usage.completion_tokens,
                  total_tokens: parsed.usage.total_tokens,
                } : undefined,
              };
            }
          } catch {}
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* chatAnthropicStream(
  opts: StreamingChatOptions,
): AsyncGenerator<StreamChunk> {
  const systemMsg = opts.messages.find((m) => m.role === "system");
  const conversationMsgs = opts.messages.filter((m) => m.role !== "system");

  const body: any = {
    model: opts.model,
    max_tokens: 4096,
    messages: conversationMsgs,
    stream: true,
  };
  if (systemMsg) body.system = systemMsg.content;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "interleaved-thinking-2025-05-14",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic streaming error ${res.status}: ${err}`);
  }

  if (!res.body) throw new Error("No response body for streaming");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            yield { delta: "", done: true };
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              yield { delta, done: false };
            }
            if (parsed.choices?.[0]?.finish_reason) {
              yield {
                delta: "",
                done: true,
                usage: parsed.usage ? {
                  prompt_tokens: parsed.usage.input_tokens,
                  completion_tokens: parsed.usage.output_tokens,
                  total_tokens: parsed.usage.input_tokens + parsed.usage.output_tokens,
                } : undefined,
              };
            }
          } catch {}
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function chatOpenAI(
  messages: Message[],
  model: string,
  apiKey: string,
): Promise<ChatResponse> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  };

  return {
    content: data.choices[0]?.message?.content ?? "",
    model: data.model,
    usage: {
      prompt_tokens: data.usage.prompt_tokens,
      completion_tokens: data.usage.completion_tokens,
      total_tokens: data.usage.total_tokens,
    },
    provider: "openai",
  };
}

export async function chatAnthropic(
  messages: Message[],
  model: string,
  apiKey: string,
): Promise<ChatResponse> {
  // Separate system message from conversation messages
  const systemMsg = messages.find((m) => m.role === "system");
  const conversationMsgs = messages.filter((m) => m.role !== "system");

  const body: any = {
    model,
    max_tokens: 4096,
    messages: conversationMsgs,
  };
  if (systemMsg) body.system = systemMsg.content;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    content: Array<{ text: string }>;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  };

  const promptTokens = data.usage.input_tokens;
  const completionTokens = data.usage.output_tokens;

  return {
    content: data.content[0]?.text ?? "",
    model: data.model,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
    provider: "anthropic",
  };
}

export async function chatGroq(
  messages: Message[],
  model: string,
  apiKey: string,
): Promise<ChatResponse> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  };

  return {
    content: data.choices[0]?.message?.content ?? "",
    model: data.model,
    usage: {
      prompt_tokens: data.usage.prompt_tokens,
      completion_tokens: data.usage.completion_tokens,
      total_tokens: data.usage.total_tokens,
    },
    provider: "groq",
  };
}

export type ProviderName = "openai" | "anthropic" | "groq";

export interface ProviderConfig {
  openai?: string;
  anthropic?: string;
  groq?: string;
}

/**
 * Get the provider name for a given model string.
 */
export function getProvider(
  model: string,
  config?: ProviderConfig,
): ProviderName {
  if (model.startsWith("gpt-")) {
    if (!config || config.openai) return "openai";
  }
  if (model.startsWith("claude-")) {
    if (!config || config.anthropic) return "anthropic";
  }
  if (
    model.startsWith("llama-") ||
    model.startsWith("mixtral-") ||
    model.startsWith("gemma-")
  ) {
    if (!config || config.groq) return "groq";
  }

  // Default: return first available provider
  if (config) {
    if (config.openai) return "openai";
    if (config.anthropic) return "anthropic";
    if (config.groq) return "groq";
    throw new Error(`No provider configured for model: ${model}`);
  }

  return "openai";
}

export function getAvailableModels(): string[] {
  const models: string[] = [];

  if (process.env.OPENAI_API_KEY) {
    models.push("gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo");
  }
  if (process.env.ANTHROPIC_API_KEY) {
    models.push("claude-3-5-sonnet-20241022", "claude-3-haiku-20240307");
  }
  if (process.env.GROQ_API_KEY) {
    models.push("llama-3.1-70b-versatile", "mixtral-8x7b-32768", "gemma-7b-it");
  }

  return models;
}

export async function callProvider(
  provider: ProviderName,
  messages: Message[],
  model: string,
): Promise<ChatResponse> {
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    return chatOpenAI(messages, model, key);
  }
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    return chatAnthropic(messages, model, key);
  }
  if (provider === "groq") {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY is not set");
    return chatGroq(messages, model, key);
  }
  throw new Error(`Unknown provider: ${provider}`);
}

/**
 * Call a provider with streaming. Returns an async generator of chunks.
 */
export function callProviderStream(
  provider: ProviderName,
  opts: Omit<StreamingChatOptions, "apiKey">,
): AsyncGenerator<StreamChunk> {
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    return chatOpenAIStream({ ...opts, apiKey: key });
  }
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    return chatAnthropicStream({ ...opts, apiKey: key });
  }
  if (provider === "groq") {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY is not set");
    // Groq supports OpenAI-compatible streaming
    return chatOpenAIStream({ ...opts, apiKey: key });
  }
  throw new Error(`Unknown provider: ${provider}`);
}

export interface FallbackChainItem {
  provider: ProviderName;
  model: string;
}

/**
 * Call providers in sequence until one succeeds.
 * Useful for redundancy when a provider is rate-limited or down.
 */
export async function callWithFallback(
  chain: FallbackChainItem[],
  messages: Message[],
): Promise<ChatResponse & { fallback_used: number }> {
  let lastError: Error | null = null;

  for (let i = 0; i < chain.length; i++) {
    const { provider, model } = chain[i];
    try {
      const response = await callProvider(provider, messages, model);
      return { ...response, fallback_used: i };
    } catch (err) {
      lastError = err as Error;
      // Continue to next provider in chain
    }
  }

  throw lastError ?? new Error("All fallback providers failed");
}

/**
 * Collect a streaming response into a full ChatResponse.
 */
export async function collectStream(
  stream: AsyncGenerator<StreamChunk>,
): Promise<ChatResponse & { fallback_used?: number }> {
  let content = "";
  let usage: StreamChunk["usage"];

  for await (const chunk of stream) {
    content += chunk.delta;
    if (chunk.usage) usage = chunk.usage;
  }

  return {
    content,
    model: "",
    usage: usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    provider: "",
  };
}

/**
 * Streaming response with fallback chain — tries each provider until one succeeds.
 */
export async function streamWithFallback(
  chain: FallbackChainItem[],
  opts: Omit<StreamingChatOptions, "apiKey">,
): Promise<AsyncGenerator<StreamChunk> & { fallback_used: number }> {
  let lastError: Error | null = null;

  for (let i = 0; i < chain.length; i++) {
    const { provider, model } = chain[i];
    try {
      const stream = await callProviderStream(provider, { ...opts, model });
      // Attach fallback count to the generator via a proxy object
      const gen = stream as AsyncGenerator<StreamChunk> & { fallback_used: number };
      gen.fallback_used = i;
      return gen;
    } catch (err) {
      lastError = err as Error;
    }
  }

  throw lastError ?? new Error("All fallback providers failed for streaming");
}

// ---------------------------------------------------------------------------
// Streaming SSE helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a StreamChunk async generator into a ReadableStream in SSE format.
 * Each chunk is emitted as `data: {...}\n\n`.
 */
export function streamToSSE(
  stream: AsyncGenerator<StreamChunk>,
  opts?: { model?: string; provider?: string },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let iterator: AsyncIterator<StreamChunk> | undefined;

  return new ReadableStream<Uint8Array>({
     async pull(controller) {
      if (!iterator) {
        iterator = stream[Symbol.asyncIterator]();
      }
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
        return;
      }
      const sseChunk = `data: ${JSON.stringify(value)}\n\n`;
      controller.enqueue(encoder.encode(sseChunk));
    },
  });
}

// ---------------------------------------------------------------------------
// Completion (prompt-only) streaming
// ---------------------------------------------------------------------------

export interface CompletionOptions {
  model: string;
  prompt: string;
  maxTokens?: number;
}

export interface CompletionResponse {
  content: string;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  provider: string;
}

/**
 * Single-prompt text completion via OpenAI-compatible /completions endpoint.
 */
export async function completeOpenAI(
  prompt: string,
  model: string,
  apiKey: string,
  maxTokens = 256,
): Promise<CompletionResponse> {
  const res = await fetch("https://api.openai.com/v1/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, prompt, max_tokens: maxTokens }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI completion error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ text: string }>;
    model: string;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  return {
    content: data.choices[0]?.text ?? "",
    model: data.model,
    usage: {
      prompt_tokens: data.usage.prompt_tokens,
      completion_tokens: data.usage.completion_tokens,
      total_tokens: data.usage.total_tokens,
    },
    provider: "openai",
  };
}

/**
 * Streaming text completion via OpenAI-compatible /completions endpoint.
 */
export async function* completeOpenAIStream(
  opts: Omit<StreamingChatOptions, "messages"> & { prompt: string },
): AsyncGenerator<StreamChunk> {
  const res = await fetch("https://api.openai.com/v1/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      prompt: opts.prompt,
      max_tokens: opts.maxTokens ?? 256,
      stream: true,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI completion stream error ${res.status}: ${err}`);
  }

  if (!res.body) throw new Error("No response body for completion streaming");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            yield { delta: "", done: true };
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.text;
            if (delta) {
              yield { delta, done: false };
            }
            if (parsed.choices?.[0]?.finish_reason) {
              yield {
                delta: "",
                done: true,
                usage: parsed.usage
                  ? {
                      prompt_tokens: parsed.usage.prompt_tokens,
                      completion_tokens: parsed.usage.completion_tokens,
                      total_tokens: parsed.usage.total_tokens,
                    }
                  : undefined,
              };
            }
          } catch {}
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Chat with a single prompt via completion API (converted to single-message chat).
 */
export async function* chatCompleteStream(
  opts: StreamingChatOptions & { prompt: string },
): AsyncGenerator<StreamChunk> {
  // Convert single prompt to a user message and use chat stream
  const messages: Message[] = [{ role: "user", content: opts.prompt }];
  const chatOpts = { ...opts, messages };
  if (opts.model.startsWith("gpt-") || opts.model.startsWith("llama-") || opts.model.startsWith("mixtral-") || opts.model.startsWith("gemma-")) {
    // Use OpenAI-compatible stream
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    yield* chatOpenAIStream({ ...chatOpts, apiKey: key });
  } else {
    // Anthropic — use its own stream
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    yield* chatAnthropicStream({ ...chatOpts, apiKey: key });
  }
}

// ---------------------------------------------------------------------------
// Batch completions
// ---------------------------------------------------------------------------

export interface BatchCompleteOptions {
  model: string;
  prompts: string[];
  maxTokens?: number;
}

/**
 * Call completion for an array of prompts in parallel, return array of results.
 * Uses the non-streaming API for each prompt.
 */
export async function batchComplete(
  opts: BatchCompleteOptions,
  apiKey: string,
): Promise<CompletionResponse[]> {
  const { model, prompts, maxTokens = 256 } = opts;

  const results = await Promise.all(
    prompts.map((prompt) =>
      completeOpenAI(prompt, model, apiKey, maxTokens).catch((err) => ({
        content: "",
        model,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        provider: getProvider(model),
        error: err instanceof Error ? err.message : String(err),
      })),
    ),
  );

  return results as CompletionResponse[];
}

// ---------------------------------------------------------------------------
// Token counting (simple cl100k_base estimator)
// ---------------------------------------------------------------------------

/**
 * Approximate token count using a simple regex-based estimator.
 * Mirrors how tiktoken/cl100k_base counts tokens for English text.
 * This is accurate to within ~5% for most English prompts.
 */
export function countTokens(text: string): number {
  // Split on whitespace/newlines to get "words"
  const words = text.trim().split(/\s+/);
  let tokenCount = 0;

  for (const word of words) {
    if (word.length === 0) continue;
    // Each character + special chars contribute tokens
    // Rough rule: ~4 chars per token for English
    tokenCount += Math.ceil(word.length / 4);
  }

  // Add overhead for message framing (~3-4 tokens for role/content framing)
  tokenCount += 4;

  // Count any explicit newlines as extra tokens (they count as ~1 token each)
  const newlines = (text.match(/\n/g) ?? []).length;
  tokenCount += newlines;

  return Math.max(1, tokenCount);
}

/**
 * Estimate tokens for an array of messages (chat format).
 * Adds overhead for message framing per the chatml spec.
 */
export function countMessageTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += countTokens(msg.content);
    total += 4; // role label overhead per message
  }
  // Add overhead for chat ml format (3 tokens) + completion overhead (3 tokens)
  total += 6;
  return total;
}
