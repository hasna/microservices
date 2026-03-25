/**
 * Hiring CRUD operations — barrel re-export
 *
 * All logic is split across:
 *   - jobs.ts        — Job and JobTemplate CRUD
 *   - applicants.ts  — Applicant CRUD, pipeline, bulk ops, referral stats
 *   - interviews.ts  — Interview CRUD, structured feedback, offers, forecast
 */

export type {
  Job,
  CreateJobInput,
  ListJobsOptions,
  UpdateJobInput,
  JobTemplate,
} from "./jobs.js";

export {
  createJob,
  getJob,
  listJobs,
  updateJob,
  closeJob,
  deleteJob,
  saveJobAsTemplate,
  getJobTemplate,
  getJobTemplateByName,
  listJobTemplates,
  createJobFromTemplate,
  deleteJobTemplate,
} from "./jobs.js";

export type {
  Applicant,
  CreateApplicantInput,
  ListApplicantsOptions,
  UpdateApplicantInput,
  PipelineEntry,
  HiringStats,
  BulkImportResult,
  BulkRejectResult,
  ReferralStats,
} from "./applicants.js";

export {
  createApplicant,
  getApplicant,
  listApplicants,
  updateApplicant,
  advanceApplicant,
  rejectApplicant,
  deleteApplicant,
  searchApplicants,
  listByStage,
  getPipeline,
  getHiringStats,
  bulkReject,
  getReferralStats,
} from "./applicants.js";

// bulkImportApplicants needs getJob injected — re-export a wrapped version
import { bulkImportApplicants as _bulkImportApplicants } from "./applicants.js";
import { getJob } from "./jobs.js";
import type { BulkImportResult } from "./applicants.js";

export function bulkImportApplicants(csvData: string): BulkImportResult {
  return _bulkImportApplicants(csvData, getJob);
}

export type {
  Interview,
  CreateInterviewInput,
  ListInterviewsOptions,
  UpdateInterviewInput,
  StructuredFeedback,
  OfferDetails,
  HiringForecast,
} from "./interviews.js";

export {
  createInterview,
  getInterview,
  listInterviews,
  updateInterview,
  addInterviewFeedback,
  deleteInterview,
  submitStructuredFeedback,
  generateOffer,
  getHiringForecast,
} from "./interviews.js";
