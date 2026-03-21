/**
 * AI-powered transcript translation.
 * Supports OpenAI (gpt-4o-mini) and Anthropic (claude-haiku) — reuses the same
 * provider detection as summarizer. Default: OpenAI if key set, else Anthropic.
 */

import { getDefaultSummaryProvider, type SummaryProvider } from "./summarizer.js";

export { getDefaultSummaryProvider as getDefaultTranslationProvider };

const TRANSLATE_PROMPT = (text: string, targetLang: string) =>
  `Translate the following transcript to ${targetLang}. Preserve the original structure and speaker labels if present. Output only the translated text, no explanations.\n\nTranscript:\n${text.slice(0, 12000)}`;

export async function translateText(
  text: string,
  targetLang: string,
  provider?: SummaryProvider
): Promise<string> {
  const resolved = provider ?? getDefaultSummaryProvider();
  if (!resolved) throw new Error("No translation API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");

  if (resolved === "openai") return translateWithOpenAI(text, targetLang);
  return translateWithAnthropic(text, targetLang);
}

async function translateWithOpenAI(text: string, targetLang: string): Promise<string> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: TRANSLATE_PROMPT(text, targetLang) }],
      max_tokens: 4096,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content?.trim() ?? "";
}

async function translateWithAnthropic(text: string, targetLang: string): Promise<string> {
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
      max_tokens: 4096,
      messages: [{ role: "user", content: TRANSLATE_PROMPT(text, targetLang) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
  return data.content.find((b) => b.type === "text")?.text?.trim() ?? "";
}
