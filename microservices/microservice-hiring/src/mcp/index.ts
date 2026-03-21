#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createJob,
  getJob,
  listJobs,
  updateJob,
  closeJob,
  deleteJob,
  createApplicant,
  getApplicant,
  listApplicants,
  updateApplicant,
  advanceApplicant,
  rejectApplicant,
  searchApplicants,
  listByStage,
  getPipeline,
  getHiringStats,
  createInterview,
  getInterview,
  listInterviews,
  updateInterview,
  addInterviewFeedback,
  deleteInterview,
  bulkImportApplicants,
  generateOffer,
  getHiringForecast,
  submitStructuredFeedback,
  bulkReject,
  getReferralStats,
  saveJobAsTemplate,
  createJobFromTemplate,
  listJobTemplates,
  deleteJobTemplate,
} from "../db/hiring.js";
import { scoreApplicant, rankApplicants } from "../lib/scoring.js";

const server = new McpServer({
  name: "microservice-hiring",
  version: "0.0.1",
});

// --- Jobs ---

server.registerTool(
  "create_job",
  {
    title: "Create Job",
    description: "Create a new job posting.",
    inputSchema: {
      title: z.string(),
      department: z.string().optional(),
      location: z.string().optional(),
      type: z.enum(["full-time", "part-time", "contract"]).optional(),
      description: z.string().optional(),
      requirements: z.array(z.string()).optional(),
      salary_range: z.string().optional(),
      posted_at: z.string().optional(),
    },
  },
  async (params) => {
    const job = createJob(params);
    return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
  }
);

server.registerTool(
  "get_job",
  {
    title: "Get Job",
    description: "Get a job posting by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const job = getJob(id);
    if (!job) {
      return { content: [{ type: "text", text: `Job '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
  }
);

server.registerTool(
  "list_jobs",
  {
    title: "List Jobs",
    description: "List job postings with optional filters.",
    inputSchema: {
      status: z.enum(["open", "closed", "paused"]).optional(),
      department: z.string().optional(),
      type: z.enum(["full-time", "part-time", "contract"]).optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const jobs = listJobs(params);
    return {
      content: [{ type: "text", text: JSON.stringify({ jobs, count: jobs.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "update_job",
  {
    title: "Update Job",
    description: "Update a job posting.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      department: z.string().optional(),
      location: z.string().optional(),
      type: z.enum(["full-time", "part-time", "contract"]).optional(),
      status: z.enum(["open", "closed", "paused"]).optional(),
      description: z.string().optional(),
      requirements: z.array(z.string()).optional(),
      salary_range: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const job = updateJob(id, input);
    if (!job) {
      return { content: [{ type: "text", text: `Job '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
  }
);

server.registerTool(
  "close_job",
  {
    title: "Close Job",
    description: "Close a job posting.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const job = closeJob(id);
    if (!job) {
      return { content: [{ type: "text", text: `Job '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
  }
);

server.registerTool(
  "delete_job",
  {
    title: "Delete Job",
    description: "Delete a job posting by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteJob(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Applicants ---

server.registerTool(
  "add_applicant",
  {
    title: "Add Applicant",
    description: "Add a new applicant to a job.",
    inputSchema: {
      job_id: z.string(),
      name: z.string(),
      email: z.string().optional(),
      phone: z.string().optional(),
      resume_url: z.string().optional(),
      source: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    const applicant = createApplicant(params);
    return { content: [{ type: "text", text: JSON.stringify(applicant, null, 2) }] };
  }
);

server.registerTool(
  "get_applicant",
  {
    title: "Get Applicant",
    description: "Get an applicant by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const applicant = getApplicant(id);
    if (!applicant) {
      return { content: [{ type: "text", text: `Applicant '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(applicant, null, 2) }] };
  }
);

server.registerTool(
  "list_applicants",
  {
    title: "List Applicants",
    description: "List applicants with optional filters.",
    inputSchema: {
      job_id: z.string().optional(),
      status: z.enum(["applied", "screening", "interviewing", "offered", "hired", "rejected"]).optional(),
      source: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const applicants = listApplicants(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ applicants, count: applicants.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_applicant",
  {
    title: "Update Applicant",
    description: "Update an applicant.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      resume_url: z.string().optional(),
      status: z.enum(["applied", "screening", "interviewing", "offered", "hired", "rejected"]).optional(),
      stage: z.string().optional(),
      rating: z.number().optional(),
      notes: z.string().optional(),
      source: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const applicant = updateApplicant(id, input);
    if (!applicant) {
      return { content: [{ type: "text", text: `Applicant '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(applicant, null, 2) }] };
  }
);

server.registerTool(
  "advance_applicant",
  {
    title: "Advance Applicant",
    description: "Advance an applicant to a new status in the hiring pipeline.",
    inputSchema: {
      id: z.string(),
      status: z.enum(["screening", "interviewing", "offered", "hired"]),
    },
  },
  async ({ id, status }) => {
    const applicant = advanceApplicant(id, status);
    if (!applicant) {
      return { content: [{ type: "text", text: `Applicant '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(applicant, null, 2) }] };
  }
);

server.registerTool(
  "reject_applicant",
  {
    title: "Reject Applicant",
    description: "Reject an applicant with an optional reason.",
    inputSchema: {
      id: z.string(),
      reason: z.string().optional(),
    },
  },
  async ({ id, reason }) => {
    const applicant = rejectApplicant(id, reason);
    if (!applicant) {
      return { content: [{ type: "text", text: `Applicant '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(applicant, null, 2) }] };
  }
);

server.registerTool(
  "search_applicants",
  {
    title: "Search Applicants",
    description: "Search applicants by name, email, notes, or source.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchApplicants(query);
    return {
      content: [
        { type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "list_by_stage",
  {
    title: "List by Stage",
    description: "List applicants by stage.",
    inputSchema: { stage: z.string() },
  },
  async ({ stage }) => {
    const applicants = listByStage(stage);
    return {
      content: [
        { type: "text", text: JSON.stringify({ applicants, count: applicants.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_pipeline",
  {
    title: "Get Pipeline",
    description: "Get the hiring pipeline (applicant count by status) for a job.",
    inputSchema: { job_id: z.string() },
  },
  async ({ job_id }) => {
    const pipeline = getPipeline(job_id);
    return { content: [{ type: "text", text: JSON.stringify(pipeline, null, 2) }] };
  }
);

server.registerTool(
  "get_hiring_stats",
  {
    title: "Get Hiring Stats",
    description: "Get overall hiring statistics.",
    inputSchema: {},
  },
  async () => {
    const stats = getHiringStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// --- Interviews ---

server.registerTool(
  "schedule_interview",
  {
    title: "Schedule Interview",
    description: "Schedule an interview for an applicant.",
    inputSchema: {
      applicant_id: z.string(),
      interviewer: z.string().optional(),
      scheduled_at: z.string().optional(),
      duration_min: z.number().optional(),
      type: z.enum(["phone", "video", "onsite"]).optional(),
    },
  },
  async (params) => {
    const interview = createInterview(params);
    return { content: [{ type: "text", text: JSON.stringify(interview, null, 2) }] };
  }
);

server.registerTool(
  "get_interview",
  {
    title: "Get Interview",
    description: "Get an interview by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const interview = getInterview(id);
    if (!interview) {
      return { content: [{ type: "text", text: `Interview '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(interview, null, 2) }] };
  }
);

server.registerTool(
  "list_interviews",
  {
    title: "List Interviews",
    description: "List interviews with optional filters.",
    inputSchema: {
      applicant_id: z.string().optional(),
      status: z.enum(["scheduled", "completed", "canceled"]).optional(),
      type: z.enum(["phone", "video", "onsite"]).optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const interviews = listInterviews(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ interviews, count: interviews.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_interview",
  {
    title: "Update Interview",
    description: "Update an interview.",
    inputSchema: {
      id: z.string(),
      interviewer: z.string().optional(),
      scheduled_at: z.string().optional(),
      duration_min: z.number().optional(),
      type: z.enum(["phone", "video", "onsite"]).optional(),
      status: z.enum(["scheduled", "completed", "canceled"]).optional(),
      feedback: z.string().optional(),
      rating: z.number().optional(),
    },
  },
  async ({ id, ...input }) => {
    const interview = updateInterview(id, input);
    if (!interview) {
      return { content: [{ type: "text", text: `Interview '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(interview, null, 2) }] };
  }
);

server.registerTool(
  "add_interview_feedback",
  {
    title: "Add Interview Feedback",
    description: "Add feedback and optional rating to an interview.",
    inputSchema: {
      id: z.string(),
      feedback: z.string(),
      rating: z.number().optional(),
    },
  },
  async ({ id, feedback, rating }) => {
    const interview = addInterviewFeedback(id, feedback, rating);
    if (!interview) {
      return { content: [{ type: "text", text: `Interview '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(interview, null, 2) }] };
  }
);

server.registerTool(
  "delete_interview",
  {
    title: "Delete Interview",
    description: "Delete an interview by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteInterview(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Bulk Import ---

server.registerTool(
  "bulk_import_applicants",
  {
    title: "Bulk Import Applicants",
    description: "Import applicants from CSV data (columns: name,email,phone,job_id,source,resume_url).",
    inputSchema: {
      csv_data: z.string().describe("CSV string with header row"),
    },
  },
  async ({ csv_data }) => {
    const result = bulkImportApplicants(csv_data);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- AI Scoring ---

server.registerTool(
  "score_applicant",
  {
    title: "Score Applicant",
    description: "AI-score an applicant against job requirements. Returns match percentage, strengths, gaps, and recommendation.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    try {
      const score = await scoreApplicant(id);
      return { content: [{ type: "text", text: JSON.stringify(score, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: String(err instanceof Error ? err.message : err) }], isError: true };
    }
  }
);

server.registerTool(
  "rank_applicants",
  {
    title: "Rank Applicants",
    description: "AI-rank all applicants for a job by fit score, sorted best-first.",
    inputSchema: { job_id: z.string() },
  },
  async ({ job_id }) => {
    try {
      const ranked = await rankApplicants(job_id);
      return { content: [{ type: "text", text: JSON.stringify(ranked, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: String(err instanceof Error ? err.message : err) }], isError: true };
    }
  }
);

// --- Offer Letter ---

server.registerTool(
  "generate_offer",
  {
    title: "Generate Offer Letter",
    description: "Generate a Markdown offer letter for an applicant.",
    inputSchema: {
      id: z.string().describe("Applicant ID"),
      salary: z.number().describe("Annual salary"),
      start_date: z.string().describe("Start date (YYYY-MM-DD)"),
      position_title: z.string().optional(),
      department: z.string().optional(),
      benefits: z.string().optional(),
      equity: z.string().optional(),
      signing_bonus: z.number().optional(),
    },
  },
  async ({ id, salary, start_date, ...rest }) => {
    try {
      const letter = generateOffer(id, { salary, start_date, ...rest });
      return { content: [{ type: "text", text: letter }] };
    } catch (err) {
      return { content: [{ type: "text", text: String(err instanceof Error ? err.message : err) }], isError: true };
    }
  }
);

// --- Pipeline Velocity / Forecast ---

server.registerTool(
  "hiring_forecast",
  {
    title: "Hiring Forecast",
    description: "Estimate days-to-fill based on average time between pipeline stages.",
    inputSchema: { job_id: z.string() },
  },
  async ({ job_id }) => {
    try {
      const forecast = getHiringForecast(job_id);
      return { content: [{ type: "text", text: JSON.stringify(forecast, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: String(err instanceof Error ? err.message : err) }], isError: true };
    }
  }
);

// --- Structured Feedback ---

server.registerTool(
  "submit_structured_feedback",
  {
    title: "Submit Structured Interview Feedback",
    description: "Submit scored interview feedback with dimensions (technical, communication, culture_fit, etc.).",
    inputSchema: {
      id: z.string().describe("Interview ID"),
      feedback_text: z.string().optional(),
      technical: z.number().min(1).max(5).optional(),
      communication: z.number().min(1).max(5).optional(),
      culture_fit: z.number().min(1).max(5).optional(),
      problem_solving: z.number().min(1).max(5).optional(),
      leadership: z.number().min(1).max(5).optional(),
      overall: z.number().min(1).max(5).optional(),
    },
  },
  async ({ id, feedback_text, ...scores }) => {
    const interview = submitStructuredFeedback(id, scores, feedback_text);
    if (!interview) {
      return { content: [{ type: "text", text: `Interview '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(interview, null, 2) }] };
  }
);

// --- Bulk Rejection ---

server.registerTool(
  "bulk_reject",
  {
    title: "Bulk Reject Applicants",
    description: "Bulk reject all applicants for a job matching a specific status.",
    inputSchema: {
      job_id: z.string(),
      status: z.enum(["applied", "screening", "interviewing", "offered"]),
      reason: z.string().optional(),
    },
  },
  async ({ job_id, status, reason }) => {
    const result = bulkReject(job_id, status, reason);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Referral Stats ---

server.registerTool(
  "referral_stats",
  {
    title: "Referral Stats",
    description: "Show conversion rates by applicant source/referral channel.",
    inputSchema: {},
  },
  async () => {
    const stats = getReferralStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// --- Job Templates ---

server.registerTool(
  "save_job_template",
  {
    title: "Save Job as Template",
    description: "Save an existing job posting as a reusable template.",
    inputSchema: {
      job_id: z.string(),
      name: z.string().describe("Unique template name"),
    },
  },
  async ({ job_id, name }) => {
    try {
      const template = saveJobAsTemplate(job_id, name);
      return { content: [{ type: "text", text: JSON.stringify(template, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: String(err instanceof Error ? err.message : err) }], isError: true };
    }
  }
);

server.registerTool(
  "create_job_from_template",
  {
    title: "Create Job from Template",
    description: "Create a new job posting from an existing template.",
    inputSchema: {
      template_name: z.string(),
      title: z.string().optional(),
      department: z.string().optional(),
      location: z.string().optional(),
      salary_range: z.string().optional(),
    },
  },
  async ({ template_name, ...overrides }) => {
    try {
      const job = createJobFromTemplate(template_name, overrides);
      return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: String(err instanceof Error ? err.message : err) }], isError: true };
    }
  }
);

server.registerTool(
  "list_job_templates",
  {
    title: "List Job Templates",
    description: "List all saved job templates.",
    inputSchema: {},
  },
  async () => {
    const templates = listJobTemplates();
    return {
      content: [{ type: "text", text: JSON.stringify({ templates, count: templates.length }, null, 2) }],
    };
  }
);

server.registerTool(
  "delete_job_template",
  {
    title: "Delete Job Template",
    description: "Delete a job template by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteJobTemplate(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-hiring MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
