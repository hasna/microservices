/**
 * microservice-hiring — Applicant tracking and recruitment microservice
 */

export {
  createJob,
  getJob,
  listJobs,
  updateJob,
  closeJob,
  deleteJob,
  type Job,
  type CreateJobInput,
  type UpdateJobInput,
  type ListJobsOptions,
} from "./db/hiring.js";

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
  type Applicant,
  type CreateApplicantInput,
  type UpdateApplicantInput,
  type ListApplicantsOptions,
  type PipelineEntry,
  type HiringStats,
} from "./db/hiring.js";

export {
  createInterview,
  getInterview,
  listInterviews,
  updateInterview,
  addInterviewFeedback,
  deleteInterview,
  type Interview,
  type CreateInterviewInput,
  type UpdateInterviewInput,
  type ListInterviewsOptions,
} from "./db/hiring.js";

export {
  bulkImportApplicants,
  generateOffer,
  getHiringForecast,
  submitStructuredFeedback,
  bulkReject,
  getReferralStats,
  saveJobAsTemplate,
  getJobTemplate,
  getJobTemplateByName,
  listJobTemplates,
  createJobFromTemplate,
  deleteJobTemplate,
  type BulkImportResult,
  type OfferDetails,
  type HiringForecast,
  type StructuredFeedback,
  type BulkRejectResult,
  type ReferralStats,
  type JobTemplate,
} from "./db/hiring.js";

export {
  scoreApplicant,
  rankApplicants,
  type ScoreResult,
  type RankEntry,
} from "./lib/scoring.js";

export { getDatabase, closeDatabase } from "./db/database.js";
