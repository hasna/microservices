/**
 * AI resume scoring — uses OpenAI or Anthropic to evaluate applicant fit
 */

import { getApplicant, getJob, updateApplicant } from "../db/hiring.js";
import type { Applicant, Job } from "../db/hiring.js";

export interface ScoreResult {
  match_pct: number;
  strengths: string[];
  gaps: string[];
  recommendation: string;
}

export interface RankEntry {
  applicant: Applicant;
  score: ScoreResult;
}

// ---- Provider abstraction ----

async function callAI(prompt: string): Promise<string> {
  // Try Anthropic first, then OpenAI
  const anthropicKey = process.env["ANTHROPIC_API_KEY"];
  const openaiKey = process.env["OPENAI_API_KEY"];

  if (anthropicKey) {
    return callAnthropic(anthropicKey, prompt);
  }
  if (openaiKey) {
    return callOpenAI(openaiKey, prompt);
  }

  throw new Error(
    "No AI API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable."
  );
}

async function callAnthropic(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  return data.content[0]?.text || "";
}

async function callOpenAI(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content || "";
}

// ---- Scoring ----

function buildScoringPrompt(job: Job, applicant: Applicant): string {
  const requirements = job.requirements.length
    ? job.requirements.join(", ")
    : "No specific requirements listed";

  const applicantInfo = [
    `Name: ${applicant.name}`,
    applicant.resume_url ? `Resume: ${applicant.resume_url}` : null,
    applicant.notes ? `Notes/Summary: ${applicant.notes}` : null,
    applicant.source ? `Source: ${applicant.source}` : null,
    applicant.stage ? `Current stage: ${applicant.stage}` : null,
    Object.keys(applicant.metadata).length > 0
      ? `Additional info: ${JSON.stringify(applicant.metadata)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are an expert hiring evaluator. Analyze this applicant against the job requirements and return a JSON assessment.

JOB:
Title: ${job.title}
Department: ${job.department || "N/A"}
Description: ${job.description || "N/A"}
Requirements: ${requirements}
Salary Range: ${job.salary_range || "N/A"}

APPLICANT:
${applicantInfo}

Return ONLY a valid JSON object (no markdown, no code fences) with this exact structure:
{
  "match_pct": <number 0-100>,
  "strengths": ["strength1", "strength2"],
  "gaps": ["gap1", "gap2"],
  "recommendation": "<hire/strong_hire/no_hire/maybe> — brief explanation"
}`;
}

function parseScoreResponse(text: string): ScoreResult {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      match_pct: Math.max(0, Math.min(100, Number(parsed.match_pct) || 0)),
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
      recommendation: String(parsed.recommendation || "Unable to determine"),
    };
  } catch {
    return {
      match_pct: 0,
      strengths: [],
      gaps: [],
      recommendation: `AI response could not be parsed: ${text.slice(0, 200)}`,
    };
  }
}

export async function scoreApplicant(applicantId: string): Promise<ScoreResult> {
  const applicant = getApplicant(applicantId);
  if (!applicant) throw new Error(`Applicant '${applicantId}' not found`);

  const job = getJob(applicant.job_id);
  if (!job) throw new Error(`Job '${applicant.job_id}' not found`);

  const prompt = buildScoringPrompt(job, applicant);
  const response = await callAI(prompt);
  const score = parseScoreResponse(response);

  // Store in applicant metadata
  const metadata = { ...applicant.metadata, ai_score: score, scored_at: new Date().toISOString() };
  updateApplicant(applicantId, { metadata });

  return score;
}

export async function rankApplicants(jobId: string): Promise<RankEntry[]> {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job '${jobId}' not found`);

  const applicants = (await import("../db/hiring.js")).listApplicants({ job_id: jobId });

  const results: RankEntry[] = [];

  for (const applicant of applicants) {
    // Use cached score if available and recent (less than 24h old)
    const cached = applicant.metadata?.ai_score as ScoreResult | undefined;
    const cachedAt = applicant.metadata?.scored_at as string | undefined;
    const isFresh =
      cachedAt && Date.now() - new Date(cachedAt).getTime() < 24 * 60 * 60 * 1000;

    if (cached && isFresh) {
      results.push({ applicant, score: cached });
    } else {
      const score = await scoreApplicant(applicant.id);
      // Re-fetch to get updated metadata
      const updated = getApplicant(applicant.id)!;
      results.push({ applicant: updated, score });
    }
  }

  // Sort by match_pct descending
  results.sort((a, b) => b.score.match_pct - a.score.match_pct);

  return results;
}

// Exported for testing
export { buildScoringPrompt, parseScoreResponse, callAI };
