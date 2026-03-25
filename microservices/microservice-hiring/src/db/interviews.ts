/**
 * Interview CRUD operations and structured feedback
 */

import { getDatabase } from "./database.js";
import { getApplicant, updateApplicant } from "./applicants.js";
import { getJob } from "./jobs.js";
import type { PipelineEntry } from "./applicants.js";
import { listApplicants, getPipeline } from "./applicants.js";

// ---- Types ----

export interface Interview {
  id: string;
  applicant_id: string;
  interviewer: string | null;
  scheduled_at: string | null;
  duration_min: number | null;
  type: "phone" | "video" | "onsite";
  status: "scheduled" | "completed" | "canceled";
  feedback: string | null;
  rating: number | null;
  created_at: string;
}

// ---- Interviews ----

export interface CreateInterviewInput {
  applicant_id: string;
  interviewer?: string;
  scheduled_at?: string;
  duration_min?: number;
  type?: "phone" | "video" | "onsite";
  status?: "scheduled" | "completed" | "canceled";
}

export function createInterview(input: CreateInterviewInput): Interview {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO interviews (id, applicant_id, interviewer, scheduled_at, duration_min, type, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.applicant_id,
    input.interviewer || null,
    input.scheduled_at || null,
    input.duration_min ?? null,
    input.type || "phone",
    input.status || "scheduled"
  );

  return getInterview(id)!;
}

export function getInterview(id: string): Interview | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM interviews WHERE id = ?").get(id) as Interview | null;
  return row || null;
}

export interface ListInterviewsOptions {
  applicant_id?: string;
  status?: string;
  type?: string;
  limit?: number;
}

export function listInterviews(options: ListInterviewsOptions = {}): Interview[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.applicant_id) {
    conditions.push("applicant_id = ?");
    params.push(options.applicant_id);
  }
  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }

  let sql = "SELECT * FROM interviews";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY scheduled_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  return db.prepare(sql).all(...params) as Interview[];
}

export interface UpdateInterviewInput {
  interviewer?: string;
  scheduled_at?: string;
  duration_min?: number;
  type?: "phone" | "video" | "onsite";
  status?: "scheduled" | "completed" | "canceled";
  feedback?: string;
  rating?: number;
}

export function updateInterview(id: string, input: UpdateInterviewInput): Interview | null {
  const db = getDatabase();
  const existing = getInterview(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.interviewer !== undefined) { sets.push("interviewer = ?"); params.push(input.interviewer); }
  if (input.scheduled_at !== undefined) { sets.push("scheduled_at = ?"); params.push(input.scheduled_at); }
  if (input.duration_min !== undefined) { sets.push("duration_min = ?"); params.push(input.duration_min); }
  if (input.type !== undefined) { sets.push("type = ?"); params.push(input.type); }
  if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }
  if (input.feedback !== undefined) { sets.push("feedback = ?"); params.push(input.feedback); }
  if (input.rating !== undefined) { sets.push("rating = ?"); params.push(input.rating); }

  if (sets.length === 0) return existing;

  params.push(id);
  db.prepare(`UPDATE interviews SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getInterview(id);
}

export function addInterviewFeedback(id: string, feedback: string, rating?: number): Interview | null {
  const input: UpdateInterviewInput = { feedback, status: "completed" };
  if (rating !== undefined) input.rating = rating;
  return updateInterview(id, input);
}

export function deleteInterview(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM interviews WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---- Structured Interview Feedback ----

export interface StructuredFeedback {
  technical?: number;
  communication?: number;
  culture_fit?: number;
  problem_solving?: number;
  leadership?: number;
  overall?: number;
  notes?: string;
}

export function submitStructuredFeedback(
  interviewId: string,
  scores: StructuredFeedback,
  feedbackText?: string
): Interview | null {
  const interview = getInterview(interviewId);
  if (!interview) return null;

  const feedbackData = {
    scores,
    text: feedbackText || interview.feedback || "",
    submitted_at: new Date().toISOString(),
  };

  const scoreValues = [
    scores.technical,
    scores.communication,
    scores.culture_fit,
    scores.problem_solving,
    scores.leadership,
    scores.overall,
  ].filter((v): v is number => v !== undefined);

  const avgRating = scoreValues.length > 0
    ? Math.round((scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length) * 10) / 10
    : undefined;

  return updateInterview(interviewId, {
    feedback: JSON.stringify(feedbackData),
    rating: avgRating,
    status: "completed",
  });
}

// ---- Offer Letter Generation ----

export interface OfferDetails {
  salary: number;
  start_date: string;
  position_title?: string;
  department?: string;
  benefits?: string;
  equity?: string;
  signing_bonus?: number;
}

export function generateOffer(applicantId: string, details: OfferDetails): string {
  const applicant = getApplicant(applicantId);
  if (!applicant) throw new Error(`Applicant '${applicantId}' not found`);

  const job = getJob(applicant.job_id);
  if (!job) throw new Error(`Job '${applicant.job_id}' not found`);

  const title = details.position_title || job.title;
  const dept = details.department || job.department || "the team";
  const salary = details.salary.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  let letter = `# Offer Letter

**Date:** ${new Date().toISOString().split("T")[0]}

Dear **${applicant.name}**,

We are pleased to extend an offer of employment for the position of **${title}** in **${dept}**.

## Terms of Employment

| Detail | Value |
|--------|-------|
| **Position** | ${title} |
| **Department** | ${dept} |
| **Annual Salary** | ${salary} |
| **Start Date** | ${details.start_date} |
| **Employment Type** | ${job.type} |`;

  if (details.signing_bonus) {
    const bonus = details.signing_bonus.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    letter += `\n| **Signing Bonus** | ${bonus} |`;
  }

  if (details.equity) {
    letter += `\n| **Equity** | ${details.equity} |`;
  }

  if (details.benefits) {
    letter += `\n\n## Benefits\n\n${details.benefits}`;
  }

  letter += `

## Next Steps

Please review this offer carefully. To accept, please sign and return this letter by **${getResponseDeadline(details.start_date)}**.

We are excited to have you join ${dept} and look forward to your contributions.

Sincerely,
**Hiring Team**
`;

  const metadata = {
    ...applicant.metadata,
    offer: { ...details, generated_at: new Date().toISOString() },
  };
  updateApplicant(applicantId, { metadata, status: "offered" });

  return letter;
}

function getResponseDeadline(startDate: string): string {
  const start = new Date(startDate);
  const deadline = new Date(start.getTime() - 14 * 24 * 60 * 60 * 1000);
  return deadline.toISOString().split("T")[0];
}

// ---- Pipeline Velocity / Hiring Forecast ----

export interface HiringForecast {
  job_id: string;
  job_title: string;
  total_applicants: number;
  current_pipeline: PipelineEntry[];
  avg_days_per_stage: Record<string, number>;
  estimated_days_to_fill: number | null;
  conversion_rates: Record<string, number>;
}

export function getHiringForecast(jobId: string): HiringForecast {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job '${jobId}' not found`);

  const pipeline = getPipeline(jobId);
  const applicants = listApplicants({ job_id: jobId });

  const stages = ["applied", "screening", "interviewing", "offered", "hired"];
  const stageDurations: Record<string, number[]> = {};

  for (const applicant of applicants) {
    if (applicant.status !== "applied" && applicant.status !== "rejected") {
      const created = new Date(applicant.created_at).getTime();
      const updated = new Date(applicant.updated_at).getTime();
      const days = (updated - created) / (1000 * 60 * 60 * 24);
      if (days > 0) {
        const key = `applied->${applicant.status}`;
        if (!stageDurations[key]) stageDurations[key] = [];
        stageDurations[key].push(days);
      }
    }
  }

  const avgDaysPerStage: Record<string, number> = {};
  for (const [key, durations] of Object.entries(stageDurations)) {
    avgDaysPerStage[key] = Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10;
  }

  const conversionRates: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  for (const p of pipeline) {
    statusCounts[p.status] = p.count;
  }

  const total = applicants.length;
  if (total > 0) {
    for (const stage of stages) {
      const atOrPast = applicants.filter((a) => {
        const idx = stages.indexOf(a.status);
        const stageIdx = stages.indexOf(stage);
        return idx >= stageIdx && a.status !== "rejected";
      }).length;
      conversionRates[stage] = Math.round((atOrPast / total) * 100);
    }
  }

  let estimatedDays: number | null = null;
  if (Object.keys(avgDaysPerStage).length > 0) {
    const values = Object.values(avgDaysPerStage);
    estimatedDays = Math.round(values.reduce((a, b) => Math.max(a, b), 0) * 1.2);
  } else if (applicants.length > 0) {
    const oldest = applicants.reduce((oldest, a) => {
      const t = new Date(a.created_at).getTime();
      return t < oldest ? t : oldest;
    }, Date.now());
    const daysSinceFirst = (Date.now() - oldest) / (1000 * 60 * 60 * 24);
    const hiredCount = statusCounts["hired"] || 0;
    if (hiredCount > 0) {
      estimatedDays = Math.round(daysSinceFirst / hiredCount);
    } else {
      estimatedDays = Math.round(daysSinceFirst * 2);
    }
  }

  return {
    job_id: jobId,
    job_title: job.title,
    total_applicants: total,
    current_pipeline: pipeline,
    avg_days_per_stage: avgDaysPerStage,
    estimated_days_to_fill: estimatedDays,
    conversion_rates: conversionRates,
  };
}
