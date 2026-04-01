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
