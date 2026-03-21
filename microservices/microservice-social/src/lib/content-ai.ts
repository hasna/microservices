/**
 * AI-powered content generation for social media.
 * Supports OpenAI (gpt-4o-mini) and Anthropic (claude-haiku) — same pattern as transcriber summarizer.
 * Default: OpenAI if OPENAI_API_KEY set, else Anthropic.
 */

import { PLATFORM_LIMITS, type Platform } from "../db/social.js";

export type AIProvider = "openai" | "anthropic";
export type Tone = "professional" | "casual" | "witty";

export interface GeneratePostOptions {
  tone?: Tone;
  includeHashtags?: boolean;
  includeEmoji?: boolean;
  language?: string;
}

export interface GeneratedPost {
  content: string;
  hashtags: string[];
  suggested_media_prompt: string;
}

export interface OptimizedPost {
  optimized_content: string;
  improvements: string[];
}

export interface RepurposedPost {
  content: string;
}

// ---- Provider Detection ----

export function getDefaultAIProvider(): AIProvider | null {
  if (process.env["OPENAI_API_KEY"]) return "openai";
  if (process.env["ANTHROPIC_API_KEY"]) return "anthropic";
  return null;
}

function resolveProvider(provider?: AIProvider): AIProvider {
  const resolved = provider ?? getDefaultAIProvider();
  if (!resolved) throw new Error("No AI API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
  return resolved;
}

// ---- Prompt Builders (exported for testing) ----

export function buildGeneratePostPrompt(
  topic: string,
  platform: Platform,
  options: GeneratePostOptions = {}
): string {
  const limit = PLATFORM_LIMITS[platform];
  const tone = options.tone || "professional";
  const lang = options.language || "English";
  const hashtagLine = options.includeHashtags !== false
    ? "Include 3-5 relevant hashtags."
    : "Do NOT include hashtags.";
  const emojiLine = options.includeEmoji
    ? "Use emojis where appropriate."
    : "Do not use emojis.";

  return `Write a social media post about the following topic for ${platform}.
Character limit: ${limit} characters. The post content MUST be within this limit.
Tone: ${tone}
Language: ${lang}
${hashtagLine}
${emojiLine}

Return ONLY valid JSON with these fields:
- "content": the post text (within ${limit} chars)
- "hashtags": array of hashtag strings (without # prefix)
- "suggested_media_prompt": a short description for AI image generation that would complement this post

Topic: ${topic}`;
}

export function buildSuggestHashtagsPrompt(
  content: string,
  platform: Platform,
  count: number
): string {
  return `Analyze the following social media post for ${platform} and suggest ${count} relevant hashtags.
Return ONLY a valid JSON array of strings (without the # prefix).

Post: ${content}`;
}

export function buildOptimizePostPrompt(content: string, platform: Platform): string {
  const limit = PLATFORM_LIMITS[platform];
  return `Optimize the following social media post for better engagement on ${platform}.
Character limit: ${limit} characters. The optimized content MUST be within this limit.

Return ONLY valid JSON with these fields:
- "optimized_content": the improved post text (within ${limit} chars)
- "improvements": array of strings explaining each change made

Original post: ${content}`;
}

export function buildGenerateThreadPrompt(topic: string, tweetCount: number): string {
  return `Write a Twitter/X thread of exactly ${tweetCount} tweets about the following topic.
Each tweet MUST be within 280 characters.
Number each tweet (1/${tweetCount}, 2/${tweetCount}, etc.) at the start.

Return ONLY a valid JSON array of strings, one per tweet.

Topic: ${topic}`;
}

export function buildRepurposePostPrompt(
  content: string,
  sourcePlatform: Platform,
  targetPlatform: Platform
): string {
  const targetLimit = PLATFORM_LIMITS[targetPlatform];
  return `Adapt the following ${sourcePlatform} post for ${targetPlatform}.
Target character limit: ${targetLimit} characters. The content MUST be within this limit.
Adjust the tone, length, hashtag style, and formatting to match ${targetPlatform} conventions.

Return ONLY valid JSON with a single field:
- "content": the adapted post text (within ${targetLimit} chars)

Original ${sourcePlatform} post: ${content}`;
}

// ---- AI Functions ----

export async function generatePost(
  topic: string,
  platform: Platform,
  options: GeneratePostOptions = {},
  provider?: AIProvider
): Promise<GeneratedPost> {
  const resolved = resolveProvider(provider);
  const prompt = buildGeneratePostPrompt(topic, platform, options);

  const raw = resolved === "openai"
    ? await callOpenAI(prompt, 500)
    : await callAnthropic(prompt, 500);

  return parseJSON<GeneratedPost>(raw, {
    content: "",
    hashtags: [],
    suggested_media_prompt: "",
  });
}

export async function suggestHashtags(
  content: string,
  platform: Platform,
  count: number = 5,
  provider?: AIProvider
): Promise<string[]> {
  const resolved = resolveProvider(provider);
  const prompt = buildSuggestHashtagsPrompt(content, platform, count);

  const raw = resolved === "openai"
    ? await callOpenAI(prompt, 200)
    : await callAnthropic(prompt, 200);

  const parsed = parseJSON<string[]>(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

export async function optimizePost(
  content: string,
  platform: Platform,
  provider?: AIProvider
): Promise<OptimizedPost> {
  const resolved = resolveProvider(provider);
  const prompt = buildOptimizePostPrompt(content, platform);

  const raw = resolved === "openai"
    ? await callOpenAI(prompt, 600)
    : await callAnthropic(prompt, 600);

  return parseJSON<OptimizedPost>(raw, {
    optimized_content: "",
    improvements: [],
  });
}

export async function generateThread(
  topic: string,
  tweetCount: number = 5,
  provider?: AIProvider
): Promise<string[]> {
  const resolved = resolveProvider(provider);
  const prompt = buildGenerateThreadPrompt(topic, tweetCount);

  const raw = resolved === "openai"
    ? await callOpenAI(prompt, 1500)
    : await callAnthropic(prompt, 1500);

  const parsed = parseJSON<string[]>(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

export async function repurposePost(
  content: string,
  sourcePlatform: Platform,
  targetPlatform: Platform,
  provider?: AIProvider
): Promise<RepurposedPost> {
  const resolved = resolveProvider(provider);
  const prompt = buildRepurposePostPrompt(content, sourcePlatform, targetPlatform);

  const raw = resolved === "openai"
    ? await callOpenAI(prompt, 500)
    : await callAnthropic(prompt, 500);

  return parseJSON<RepurposedPost>(raw, { content: "" });
}

// ---- JSON Parser ----

function parseJSON<T>(raw: string, fallback: T): T {
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

// ---- Shared AI Callers ----

export async function callOpenAI(prompt: string, maxTokens: number): Promise<string> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content?.trim() ?? "";
}

export async function callAnthropic(prompt: string, maxTokens: number): Promise<string> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
  return data.content.find((b) => b.type === "text")?.text?.trim() ?? "";
}
