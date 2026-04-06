/**
 * Vision / multi-modal support — process images alongside text prompts.
 * Supports GPT-4o, Claude 3 Sonnet/Haiku, and other vision-capable models.
 */

export type ImageURL = {
  url: string;
  detail?: "low" | "high" | "auto";
};

export type ImageBase64 = {
  base64: string;
  media_type?: string;
  detail?: "low" | "high" | "auto";
};

export type ImageInput = ImageURL | ImageBase64;

export interface VisionMessage {
  role: "user";
  content: Array<{ type: "text" } | { type: "image_url"; image_url: ImageURL } | { type: "image"; source: ImageBase64 }>;
}

export interface VisionRequest {
  model: string;
  messages: VisionMessage[];
  maxTokens?: number;
  apiKey?: string;
}

export interface VisionResponse {
  content: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Build a vision message content array from text + images.
 */
export function buildVisionContent(
  text: string,
  images: ImageInput[],
): VisionMessage["content"] {
  const parts: VisionMessage["content"] = [{ type: "text", text }];

  for (const img of images) {
    if ("url" in img) {
      parts.push({
        type: "image_url",
        image_url: {
          url: img.url,
          detail: img.detail ?? "auto",
        },
      });
    } else if ("base64" in img) {
      parts.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.media_type ?? "image/png",
          data: img.base64,
          detail: img.detail ?? "auto",
        },
      });
    }
  }

  return parts;
}

/**
 * Call OpenAI vision API (GPT-4o, gpt-4o-mini, etc.).
 */
export async function chatOpenAIVision(
  opts: VisionRequest & { apiKey?: string },
): Promise<VisionResponse> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const body: any = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 4096,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI vision error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  return {
    content: choice?.message?.content ?? "",
    model: opts.model,
    usage: {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
      total_tokens: data.usage?.total_tokens ?? 0,
    },
  };
}

/**
 * Call Anthropic vision API (claude-3-5-sonnet, claude-3-haiku, etc.).
 */
export async function chatAnthropicVision(
  opts: VisionRequest & { apiKey?: string },
): Promise<VisionResponse> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  // Anthropic uses a different message format for vision
  const systemMsg = opts.messages.find((m) => m.role === "system");
  const userMsgs = opts.messages.filter((m) => m.role !== "system");

  const body: any = {
    model: opts.model,
    messages: userMsgs.map((m) => ({
      role: m.role,
      content: m.content.map((part: any) => {
        if (part.type === "text") return part;
        if (part.type === "image_url") {
          return {
            type: "image",
            source: {
              type: "url",
              url: part.image_url.url,
            },
          };
        }
        if (part.type === "image") return part;
        return part;
      }),
    })),
    max_tokens: opts.maxTokens ?? 4096,
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
    throw new Error(`Anthropic vision error ${res.status}: ${err}`);
  }

  const data = await res.json();

  return {
    content: data.content?.[0]?.text ?? "",
    model: opts.model,
    usage: {
      prompt_tokens: data.usage?.input_tokens ?? 0,
      completion_tokens: data.usage?.output_tokens ?? 0,
      total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    },
  };
}

/**
 * Route a vision request to the appropriate provider based on model name.
 */
export async function chatVision(
  opts: VisionRequest,
): Promise<VisionResponse> {
  const model = opts.model.toLowerCase();

  if (model.startsWith("gpt-4o") || model.startsWith("gpt-4-turbo")) {
    return chatOpenAIVision(opts);
  }

  if (model.startsWith("claude-3") || model.startsWith("claude-3-5")) {
    return chatAnthropicVision(opts);
  }

  // Default to OpenAI
  return chatOpenAIVision(opts);
}

/**
 * Detect if a model supports vision.
 */
export function modelSupportsVision(model: string): boolean {
  const visionModels = [
    "gpt-4o", "gpt-4o-mini", "gpt-4-turbo",
    "claude-3-5-sonnet", "claude-3-sonnet", "claude-3-haiku",
    "claude-3-opus", // older but supported
  ];

  const lower = model.toLowerCase();
  return visionModels.some((m) => lower.includes(m));
}
