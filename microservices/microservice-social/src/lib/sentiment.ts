/**
 * Sentiment analysis for social media mentions.
 * Uses OpenAI (gpt-4o-mini) or Anthropic (claude-haiku) to classify text sentiment,
 * extract emotional keywords, and generate aggregated sentiment reports.
 */

import { getDatabase } from "../db/database.js";
import { getMention, type Mention } from "./mentions.js";
import {
  callOpenAI,
  callAnthropic,
  getDefaultAIProvider,
  type AIProvider,
} from "./content-ai.js";

// ---- Types ----

export type SentimentLabel = "positive" | "neutral" | "negative";

export interface SentimentResult {
  sentiment: SentimentLabel;
  score: number;
  keywords: string[];
}

export interface SentimentReport {
  positive_pct: number;
  neutral_pct: number;
  negative_pct: number;
  total_analyzed: number;
  trending_keywords: string[];
  most_positive: { id: string; content: string; sentiment: string } | null;
  most_negative: { id: string; content: string; sentiment: string } | null;
}

// ---- Prompt Builders (exported for testing) ----

export function buildSentimentPrompt(text: string): string {
  return `Analyze the sentiment of the following text.

Return ONLY valid JSON with these fields:
- "sentiment": one of "positive", "neutral", or "negative"
- "score": a number between 0 and 1 where 0 is most negative, 0.5 is neutral, 1 is most positive
- "keywords": array of key emotional or sentiment-bearing words from the text (max 5)

Text: ${text}`;
}

export function buildBatchSentimentPrompt(texts: string[]): string {
  const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join("\n");
  return `Analyze the sentiment of each of the following texts.

Return ONLY a valid JSON array where each element has:
- "sentiment": one of "positive", "neutral", or "negative"
- "score": a number between 0 and 1 where 0 is most negative, 0.5 is neutral, 1 is most positive
- "keywords": array of key emotional or sentiment-bearing words (max 5 per text)

The array must have exactly ${texts.length} elements, one per text, in order.

Texts:
${numbered}`;
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

function validateSentimentResult(result: SentimentResult): SentimentResult {
  const validSentiments: SentimentLabel[] = ["positive", "neutral", "negative"];
  if (!validSentiments.includes(result.sentiment)) {
    result.sentiment = "neutral";
  }
  if (typeof result.score !== "number" || result.score < 0 || result.score > 1) {
    result.score = 0.5;
  }
  if (!Array.isArray(result.keywords)) {
    result.keywords = [];
  }
  return result;
}

// ---- Core Functions ----

export async function analyzeSentiment(
  text: string,
  provider?: AIProvider
): Promise<SentimentResult> {
  const resolved = provider ?? getDefaultAIProvider();
  if (!resolved) {
    throw new Error("No AI API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
  }

  const prompt = buildSentimentPrompt(text);
  const raw = resolved === "openai"
    ? await callOpenAI(prompt, 200)
    : await callAnthropic(prompt, 200);

  const fallback: SentimentResult = { sentiment: "neutral", score: 0.5, keywords: [] };
  const result = parseJSON<SentimentResult>(raw, fallback);
  return validateSentimentResult(result);
}

export async function analyzeBatch(
  texts: string[],
  provider?: AIProvider
): Promise<SentimentResult[]> {
  if (texts.length === 0) return [];

  const resolved = provider ?? getDefaultAIProvider();
  if (!resolved) {
    throw new Error("No AI API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
  }

  const prompt = buildBatchSentimentPrompt(texts);
  const maxTokens = Math.min(texts.length * 150, 4000);
  const raw = resolved === "openai"
    ? await callOpenAI(prompt, maxTokens)
    : await callAnthropic(prompt, maxTokens);

  const fallback: SentimentResult[] = texts.map(() => ({
    sentiment: "neutral" as SentimentLabel,
    score: 0.5,
    keywords: [],
  }));

  const results = parseJSON<SentimentResult[]>(raw, fallback);
  if (!Array.isArray(results) || results.length !== texts.length) {
    return fallback;
  }

  return results.map(validateSentimentResult);
}

export function getSentimentReport(
  accountId: string,
  days?: number
): SentimentReport {
  const db = getDatabase();

  let dateFilter = "";
  const params: unknown[] = [accountId];

  if (days && days > 0) {
    dateFilter = " AND fetched_at >= datetime('now', ?)";
    params.push(`-${days} days`);
  }

  // Get all mentions with sentiment for this account
  const rows = db
    .prepare(
      `SELECT id, content, sentiment FROM mentions
       WHERE account_id = ? AND sentiment IS NOT NULL${dateFilter}
       ORDER BY fetched_at DESC`
    )
    .all(...params) as { id: string; content: string | null; sentiment: string }[];

  const total_analyzed = rows.length;

  if (total_analyzed === 0) {
    return {
      positive_pct: 0,
      neutral_pct: 0,
      negative_pct: 0,
      total_analyzed: 0,
      trending_keywords: [],
      most_positive: null,
      most_negative: null,
    };
  }

  let positive = 0;
  let neutral = 0;
  let negative = 0;
  let most_positive: { id: string; content: string; sentiment: string } | null = null;
  let most_negative: { id: string; content: string; sentiment: string } | null = null;

  for (const row of rows) {
    const s = row.sentiment.toLowerCase();
    if (s === "positive") {
      positive++;
      if (!most_positive) {
        most_positive = { id: row.id, content: row.content || "", sentiment: row.sentiment };
      }
    } else if (s === "negative") {
      negative++;
      if (!most_negative) {
        most_negative = { id: row.id, content: row.content || "", sentiment: row.sentiment };
      }
    } else {
      neutral++;
    }
  }

  // Trending keywords: parse sentiment field for keywords if stored as JSON,
  // otherwise just aggregate the sentiment labels
  const keywordCounts: Record<string, number> = {};
  for (const row of rows) {
    // Try to parse sentiment as JSON (might contain keywords)
    try {
      const parsed = JSON.parse(row.sentiment);
      if (parsed && Array.isArray(parsed.keywords)) {
        for (const kw of parsed.keywords) {
          const key = String(kw).toLowerCase();
          keywordCounts[key] = (keywordCounts[key] || 0) + 1;
        }
      }
    } catch {
      // sentiment is a plain string label, skip keyword extraction
    }
  }

  const trending_keywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([kw]) => kw);

  return {
    positive_pct: Math.round((positive / total_analyzed) * 100),
    neutral_pct: Math.round((neutral / total_analyzed) * 100),
    negative_pct: Math.round((negative / total_analyzed) * 100),
    total_analyzed,
    trending_keywords,
    most_positive,
    most_negative,
  };
}

export async function autoAnalyzeMention(
  mentionId: string,
  provider?: AIProvider
): Promise<SentimentResult | null> {
  const mention = getMention(mentionId);
  if (!mention) {
    throw new Error(`Mention '${mentionId}' not found.`);
  }

  if (!mention.content) {
    throw new Error(`Mention '${mentionId}' has no content to analyze.`);
  }

  const result = await analyzeSentiment(mention.content, provider);

  // Store the sentiment result as JSON in the mention's sentiment field
  const db = getDatabase();
  const sentimentData = JSON.stringify(result);
  db.prepare("UPDATE mentions SET sentiment = ? WHERE id = ?").run(sentimentData, mentionId);

  return result;
}
