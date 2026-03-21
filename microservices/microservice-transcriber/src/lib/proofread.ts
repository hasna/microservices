/**
 * AI-powered non-destructive spellcheck/proofread for transcripts.
 * Uses OpenAI or Anthropic to find spelling, grammar, punctuation, and clarity issues.
 * NEVER modifies transcript_text directly — issues are stored in proofread_issues table
 * and must be explicitly applied one by one.
 */

import { getTranscript, updateTranscript } from "../db/transcripts.js";
import {
  createProofreadIssue,
  listProofreadIssues,
  getProofreadIssue,
  updateIssueStatus,
  getProofreadStats as getDbProofreadStats,
  type ProofreadIssue,
  type IssueType,
  type IssueStatus,
  type ListProofreadIssuesOptions,
  type ProofreadStats,
} from "../db/proofread.js";
import { getDefaultSummaryProvider, type SummaryProvider } from "./summarizer.js";

export type { ProofreadIssue, ProofreadStats, IssueType, IssueStatus };

export interface ProofreadOptions {
  types?: IssueType[];
  confidence_threshold?: number;
  provider?: SummaryProvider;
}

interface RawProofreadIssue {
  issue_type: string;
  position_start: number;
  position_end: number;
  original_text: string;
  suggestion: string;
  confidence: number;
  explanation: string;
}

const PROOFREAD_PROMPT = (text: string, types?: IssueType[]) => {
  const typeFilter = types && types.length > 0
    ? `Only check for these issue types: ${types.join(", ")}.`
    : "Check for all issue types: spelling, grammar, punctuation, clarity.";

  return `You are a professional proofreader. Analyze the following transcript text and find all issues.

${typeFilter}

For each issue found, return a JSON object with:
- "issue_type": one of "spelling", "grammar", "punctuation", "clarity"
- "position_start": character index where the issue starts in the original text
- "position_end": character index where the issue ends in the original text
- "original_text": the exact text that has the issue
- "suggestion": the corrected text
- "confidence": a number 0-1 indicating how confident you are this is an issue
- "explanation": brief explanation of the issue

Return ONLY a valid JSON array of issue objects. If no issues found, return [].
Do not wrap in markdown code fences.

Transcript text:
${text.slice(0, 15000)}`;
};

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
      temperature: 0.2,
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

function parseAIResponse(raw: string): RawProofreadIssue[] {
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        "issue_type" in item &&
        "original_text" in item
    );
  } catch {
    return [];
  }
}

const VALID_ISSUE_TYPES: Set<string> = new Set(["spelling", "grammar", "punctuation", "clarity"]);

/**
 * Run AI proofreading on a transcript. Stores issues in DB. Never changes transcript_text.
 */
export async function proofreadTranscript(
  transcriptId: string,
  options: ProofreadOptions = {}
): Promise<ProofreadIssue[]> {
  const transcript = getTranscript(transcriptId);
  if (!transcript) throw new Error(`Transcript '${transcriptId}' not found.`);
  if (!transcript.transcript_text) throw new Error(`Transcript '${transcriptId}' has no text.`);

  const provider = options.provider ?? getDefaultSummaryProvider();
  if (!provider) throw new Error("No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");

  const prompt = PROOFREAD_PROMPT(transcript.transcript_text, options.types);
  const confidenceThreshold = options.confidence_threshold ?? 0.7;

  let raw: string;
  if (provider === "openai") {
    raw = await callOpenAI(prompt, 3000);
  } else {
    raw = await callAnthropic(prompt, 3000);
  }

  const rawIssues = parseAIResponse(raw);
  const created: ProofreadIssue[] = [];

  for (const issue of rawIssues) {
    // Validate issue_type
    if (!VALID_ISSUE_TYPES.has(issue.issue_type)) continue;

    // Filter by confidence threshold
    const confidence = typeof issue.confidence === "number" ? issue.confidence : 0.8;
    if (confidence < confidenceThreshold) continue;

    // Filter by types if specified
    if (options.types && options.types.length > 0 && !options.types.includes(issue.issue_type as IssueType)) continue;

    const created_issue = createProofreadIssue({
      transcript_id: transcriptId,
      issue_type: issue.issue_type as IssueType,
      position_start: typeof issue.position_start === "number" ? issue.position_start : undefined,
      position_end: typeof issue.position_end === "number" ? issue.position_end : undefined,
      original_text: String(issue.original_text),
      suggestion: issue.suggestion ? String(issue.suggestion) : undefined,
      confidence,
      explanation: issue.explanation ? String(issue.explanation) : undefined,
    });

    created.push(created_issue);
  }

  return created;
}

/**
 * List proofread issues for a transcript with optional filters.
 */
export function listIssues(
  transcriptId: string,
  filters?: ListProofreadIssuesOptions
): ProofreadIssue[] {
  return listProofreadIssues(transcriptId, filters);
}

/**
 * Apply a suggestion: replaces the original_text in transcript_text at the
 * specified position with the suggestion, and marks the issue as 'applied'.
 */
export function applySuggestion(issueId: string): ProofreadIssue | null {
  const issue = getProofreadIssue(issueId);
  if (!issue) return null;
  if (issue.status !== "pending") return issue; // already handled

  if (!issue.suggestion) {
    // No suggestion to apply, just dismiss
    return updateIssueStatus(issueId, "dismissed");
  }

  const transcript = getTranscript(issue.transcript_id);
  if (!transcript || !transcript.transcript_text) return null;

  let newText: string;

  if (issue.position_start !== null && issue.position_end !== null) {
    // Apply at exact position if the text at that position matches
    const textAtPosition = transcript.transcript_text.slice(issue.position_start, issue.position_end);
    if (textAtPosition === issue.original_text) {
      newText =
        transcript.transcript_text.slice(0, issue.position_start) +
        issue.suggestion +
        transcript.transcript_text.slice(issue.position_end);
    } else {
      // Position mismatch (text may have shifted from prior edits), fall back to first occurrence
      newText = transcript.transcript_text.replace(issue.original_text, issue.suggestion);
    }
  } else {
    // No position info, replace first occurrence
    newText = transcript.transcript_text.replace(issue.original_text, issue.suggestion);
  }

  // Only update if text actually changed
  if (newText !== transcript.transcript_text) {
    updateTranscript(issue.transcript_id, { transcript_text: newText });
  }

  return updateIssueStatus(issueId, "applied");
}

/**
 * Dismiss an issue without changing the transcript text.
 */
export function dismissIssue(issueId: string): ProofreadIssue | null {
  const issue = getProofreadIssue(issueId);
  if (!issue) return null;
  return updateIssueStatus(issueId, "dismissed");
}

/**
 * Get proofread statistics for a transcript.
 */
export { getDbProofreadStats as getProofreadStats };

/**
 * Export annotated transcript text with inline markers showing issues.
 * Format: [TYPE: "original" -> "suggestion"]
 */
export function exportAnnotated(transcriptId: string): string {
  const transcript = getTranscript(transcriptId);
  if (!transcript || !transcript.transcript_text) {
    throw new Error(`Transcript '${transcriptId}' not found or has no text.`);
  }

  const issues = listProofreadIssues(transcriptId, { status: "pending" });
  if (issues.length === 0) return transcript.transcript_text;

  // Sort issues by position_start descending so we can safely replace from end to start
  // without shifting positions. Issues without positions are handled via string replacement.
  const positionalIssues = issues
    .filter((i) => i.position_start !== null && i.position_end !== null)
    .sort((a, b) => (b.position_start ?? 0) - (a.position_start ?? 0));

  const nonPositionalIssues = issues.filter((i) => i.position_start === null || i.position_end === null);

  let text = transcript.transcript_text;

  // Apply positional annotations from end to start
  for (const issue of positionalIssues) {
    const start = issue.position_start!;
    const end = issue.position_end!;
    const marker = formatMarker(issue);
    text = text.slice(0, start) + marker + text.slice(end);
  }

  // Apply non-positional annotations via first occurrence replacement
  for (const issue of nonPositionalIssues) {
    const marker = formatMarker(issue);
    const idx = text.indexOf(issue.original_text);
    if (idx !== -1) {
      text = text.slice(0, idx) + marker + text.slice(idx + issue.original_text.length);
    }
  }

  return text;
}

function formatMarker(issue: ProofreadIssue): string {
  const type = issue.issue_type.toUpperCase();
  if (issue.suggestion) {
    return `[${type}: "${issue.original_text}" -> "${issue.suggestion}"]`;
  }
  return `[${type}: "${issue.original_text}"]`;
}
