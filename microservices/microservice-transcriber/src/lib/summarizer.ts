/**
 * AI-powered transcript summarization.
 * Supports OpenAI (gpt-4o-mini) and Anthropic (claude-haiku) — both cheap and fast.
 * Default: OpenAI if OPENAI_API_KEY set, else Anthropic.
 */

export type SummaryProvider = "openai" | "anthropic";

const SUMMARY_PROMPT = (text: string) =>
  `Summarize the following transcript in 3-5 concise sentences. Focus on the main topics, key points, and conclusions. Do not include filler or meta-commentary.\n\nTranscript:\n${text.slice(0, 12000)}`;

export function getDefaultSummaryProvider(): SummaryProvider | null {
  if (process.env["OPENAI_API_KEY"]) return "openai";
  if (process.env["ANTHROPIC_API_KEY"]) return "anthropic";
  return null;
}

export async function summarizeText(
  text: string,
  provider?: SummaryProvider
): Promise<string> {
  const resolved = provider ?? getDefaultSummaryProvider();
  if (!resolved) throw new Error("No summarization API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");

  if (resolved === "openai") return callOpenAI(SUMMARY_PROMPT(text), 300);
  return callAnthropic(SUMMARY_PROMPT(text), 300);
}

// ---------------------------------------------------------------------------
// Highlights extraction
// ---------------------------------------------------------------------------

export interface Highlight {
  quote: string;
  speaker?: string;
  context: string;
}

const HIGHLIGHTS_PROMPT = (text: string) =>
  `Extract 5-10 key moments from this transcript. For each, provide the exact quote and a one-sentence context explaining why it's important. Return as a JSON array of objects with fields: "quote" (the exact words), "speaker" (if identifiable), "context" (why this matters).

Return ONLY valid JSON, no markdown or explanation.

Transcript:
${text.slice(0, 12000)}`;

export async function extractHighlights(
  text: string,
  provider?: SummaryProvider
): Promise<Highlight[]> {
  const resolved = provider ?? getDefaultSummaryProvider();
  if (!resolved) throw new Error("No AI API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");

  let raw: string;
  if (resolved === "openai") {
    raw = await callOpenAI(HIGHLIGHTS_PROMPT(text), 1500);
  } else {
    raw = await callAnthropic(HIGHLIGHTS_PROMPT(text), 1500);
  }

  // Parse JSON from response (may have markdown fences)
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Shared low-level callers
async function callOpenAI(prompt: string, maxTokens: number): Promise<string> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  });

  if (!res.ok) { const body = await res.text(); throw new Error(`OpenAI API error ${res.status}: ${body}`); }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content?.trim() ?? "";
}

async function callAnthropic(prompt: string, maxTokens: number): Promise<string> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) { const body = await res.text(); throw new Error(`Anthropic API error ${res.status}: ${body}`); }
  const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
  return data.content.find((b) => b.type === "text")?.text?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// Meeting notes generation
// ---------------------------------------------------------------------------

const MEETING_NOTES_PROMPT = (text: string) =>
  `Restructure the following transcript into formatted meeting notes in Markdown. Include these sections:

## Attendees
List all speakers/participants identified in the transcript.

## Agenda / Topics Discussed
Bullet points of main topics covered.

## Key Decisions
Bullet points of any decisions made.

## Action Items
Bullet points of tasks, responsibilities, or follow-ups mentioned.

## Summary
2-3 sentence overview of the meeting.

Be concise. Only include sections that have content. Use the actual speaker names if available.

Transcript:
${text.slice(0, 12000)}`;

export async function generateMeetingNotes(
  text: string,
  provider?: SummaryProvider
): Promise<string> {
  const resolved = provider ?? getDefaultSummaryProvider();
  if (!resolved) throw new Error("No AI API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");

  if (resolved === "openai") return callOpenAI(MEETING_NOTES_PROMPT(text), 2000);
  return callAnthropic(MEETING_NOTES_PROMPT(text), 2000);
}
