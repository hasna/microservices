import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-hiring-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

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
  deleteApplicant,
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
  getJobTemplate,
  getJobTemplateByName,
  listJobTemplates,
  createJobFromTemplate,
  deleteJobTemplate,
} from "./hiring";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ---- Jobs ----

describe("Jobs", () => {
  test("create and get job", () => {
    const job = createJob({
      title: "Software Engineer",
      department: "Engineering",
      location: "Remote",
      type: "full-time",
      description: "Build cool stuff",
      requirements: ["TypeScript", "Node.js"],
      salary_range: "100k-150k",
    });

    expect(job.id).toBeTruthy();
    expect(job.title).toBe("Software Engineer");
    expect(job.department).toBe("Engineering");
    expect(job.location).toBe("Remote");
    expect(job.type).toBe("full-time");
    expect(job.status).toBe("open");
    expect(job.requirements).toEqual(["TypeScript", "Node.js"]);
    expect(job.salary_range).toBe("100k-150k");

    const fetched = getJob(job.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(job.id);
  });

  test("list jobs", () => {
    createJob({ title: "Product Manager", department: "Product" });
    const all = listJobs();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list jobs with filters", () => {
    const engineering = listJobs({ department: "Engineering" });
    expect(engineering.length).toBeGreaterThanOrEqual(1);
    expect(engineering.every((j) => j.department === "Engineering")).toBe(true);
  });

  test("update job", () => {
    const job = createJob({ title: "Designer" });
    const updated = updateJob(job.id, {
      department: "Design",
      salary_range: "80k-120k",
    });

    expect(updated).toBeDefined();
    expect(updated!.department).toBe("Design");
    expect(updated!.salary_range).toBe("80k-120k");
  });

  test("close job", () => {
    const job = createJob({ title: "Intern" });
    const closed = closeJob(job.id);

    expect(closed).toBeDefined();
    expect(closed!.status).toBe("closed");
    expect(closed!.closed_at).toBeTruthy();
  });

  test("delete job", () => {
    const job = createJob({ title: "DeleteMe" });
    expect(deleteJob(job.id)).toBe(true);
    expect(getJob(job.id)).toBeNull();
  });

  test("get non-existent job returns null", () => {
    expect(getJob("non-existent-id")).toBeNull();
  });
});

// ---- Applicants ----

describe("Applicants", () => {
  let jobId: string;

  test("create and get applicant", () => {
    const job = createJob({ title: "Backend Engineer" });
    jobId = job.id;

    const applicant = createApplicant({
      job_id: jobId,
      name: "Alice Smith",
      email: "alice@example.com",
      phone: "+1234567890",
      source: "linkedin",
      notes: "Great candidate",
    });

    expect(applicant.id).toBeTruthy();
    expect(applicant.name).toBe("Alice Smith");
    expect(applicant.email).toBe("alice@example.com");
    expect(applicant.status).toBe("applied");
    expect(applicant.source).toBe("linkedin");

    const fetched = getApplicant(applicant.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(applicant.id);
  });

  test("list applicants", () => {
    createApplicant({ job_id: jobId, name: "Bob Jones", email: "bob@example.com" });
    const all = listApplicants({ job_id: jobId });
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list applicants by status", () => {
    const applied = listApplicants({ status: "applied" });
    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(applied.every((a) => a.status === "applied")).toBe(true);
  });

  test("update applicant", () => {
    const applicant = createApplicant({ job_id: jobId, name: "Charlie" });
    const updated = updateApplicant(applicant.id, {
      email: "charlie@example.com",
      rating: 4,
    });

    expect(updated).toBeDefined();
    expect(updated!.email).toBe("charlie@example.com");
    expect(updated!.rating).toBe(4);
  });

  test("advance applicant", () => {
    const applicant = createApplicant({ job_id: jobId, name: "AdvanceMe" });
    const advanced = advanceApplicant(applicant.id, "screening");

    expect(advanced).toBeDefined();
    expect(advanced!.status).toBe("screening");
  });

  test("reject applicant", () => {
    const applicant = createApplicant({ job_id: jobId, name: "RejectMe" });
    const rejected = rejectApplicant(applicant.id, "Not a good fit");

    expect(rejected).toBeDefined();
    expect(rejected!.status).toBe("rejected");
    expect(rejected!.notes).toBe("Not a good fit");
  });

  test("search applicants", () => {
    const results = searchApplicants("Alice");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toContain("Alice");
  });

  test("list by stage", () => {
    const applicant = createApplicant({ job_id: jobId, name: "StageTest", stage: "technical" });
    const byStage = listByStage("technical");
    expect(byStage.length).toBeGreaterThanOrEqual(1);
    expect(byStage.some((a) => a.id === applicant.id)).toBe(true);
  });

  test("delete applicant", () => {
    const applicant = createApplicant({ job_id: jobId, name: "DeleteMe" });
    expect(deleteApplicant(applicant.id)).toBe(true);
    expect(getApplicant(applicant.id)).toBeNull();
  });

  test("get non-existent applicant returns null", () => {
    expect(getApplicant("non-existent-id")).toBeNull();
  });
});

// ---- Pipeline & Stats ----

describe("Pipeline & Stats", () => {
  test("get pipeline", () => {
    const job = createJob({ title: "Pipeline Test Job" });

    createApplicant({ job_id: job.id, name: "P1" });
    createApplicant({ job_id: job.id, name: "P2" });
    createApplicant({ job_id: job.id, name: "P3", status: "screening" });
    createApplicant({ job_id: job.id, name: "P4", status: "interviewing" });

    const pipeline = getPipeline(job.id);
    expect(pipeline.length).toBeGreaterThanOrEqual(2);

    const appliedEntry = pipeline.find((p) => p.status === "applied");
    expect(appliedEntry).toBeDefined();
    expect(appliedEntry!.count).toBe(2);

    const screeningEntry = pipeline.find((p) => p.status === "screening");
    expect(screeningEntry).toBeDefined();
    expect(screeningEntry!.count).toBe(1);
  });

  test("get hiring stats", () => {
    const stats = getHiringStats();
    expect(stats.total_jobs).toBeGreaterThanOrEqual(1);
    expect(stats.total_applicants).toBeGreaterThanOrEqual(1);
    expect(stats.applicants_by_status.length).toBeGreaterThanOrEqual(1);
    expect(typeof stats.total_interviews).toBe("number");
  });
});

// ---- Interviews ----

describe("Interviews", () => {
  let applicantId: string;

  test("create and get interview", () => {
    const job = createJob({ title: "Interview Test Job" });
    const applicant = createApplicant({ job_id: job.id, name: "Interviewee" });
    applicantId = applicant.id;

    const interview = createInterview({
      applicant_id: applicantId,
      interviewer: "John Manager",
      scheduled_at: "2025-06-15T10:00:00Z",
      duration_min: 60,
      type: "video",
    });

    expect(interview.id).toBeTruthy();
    expect(interview.applicant_id).toBe(applicantId);
    expect(interview.interviewer).toBe("John Manager");
    expect(interview.type).toBe("video");
    expect(interview.status).toBe("scheduled");
    expect(interview.duration_min).toBe(60);

    const fetched = getInterview(interview.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(interview.id);
  });

  test("list interviews", () => {
    createInterview({ applicant_id: applicantId, type: "phone" });
    const all = listInterviews({ applicant_id: applicantId });
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list interviews by status", () => {
    const scheduled = listInterviews({ status: "scheduled" });
    expect(scheduled.length).toBeGreaterThanOrEqual(1);
    expect(scheduled.every((i) => i.status === "scheduled")).toBe(true);
  });

  test("update interview", () => {
    const interview = createInterview({ applicant_id: applicantId });
    const updated = updateInterview(interview.id, {
      interviewer: "Jane CTO",
      duration_min: 45,
    });

    expect(updated).toBeDefined();
    expect(updated!.interviewer).toBe("Jane CTO");
    expect(updated!.duration_min).toBe(45);
  });

  test("add interview feedback", () => {
    const interview = createInterview({ applicant_id: applicantId });
    const withFeedback = addInterviewFeedback(interview.id, "Excellent communication skills", 5);

    expect(withFeedback).toBeDefined();
    expect(withFeedback!.feedback).toBe("Excellent communication skills");
    expect(withFeedback!.rating).toBe(5);
    expect(withFeedback!.status).toBe("completed");
  });

  test("delete interview", () => {
    const interview = createInterview({ applicant_id: applicantId });
    expect(deleteInterview(interview.id)).toBe(true);
    expect(getInterview(interview.id)).toBeNull();
  });

  test("get non-existent interview returns null", () => {
    expect(getInterview("non-existent-id")).toBeNull();
  });
});

// ---- Bulk Import ----

describe("Bulk Import", () => {
  let jobId: string;

  test("setup: create job for import", () => {
    const job = createJob({ title: "Bulk Import Test Job" });
    jobId = job.id;
  });

  test("bulk import from CSV", () => {
    const csv = `name,email,phone,job_id,source,resume_url
Alice Import,alice@test.com,555-0001,${jobId},linkedin,https://resume.com/alice
Bob Import,bob@test.com,555-0002,${jobId},referral,https://resume.com/bob
Charlie Import,charlie@test.com,,${jobId},website,`;

    const result = bulkImportApplicants(csv);
    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  test("bulk import handles missing required fields", () => {
    const csv = `name,email,job_id
,missing@test.com,${jobId}
Valid Name,valid@test.com,${jobId}`;

    const result = bulkImportApplicants(csv);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors.length).toBe(1);
  });

  test("bulk import handles missing job_id", () => {
    const csv = `name,email
Orphan Applicant,orphan@test.com`;

    const result = bulkImportApplicants(csv);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  test("bulk import handles invalid job_id", () => {
    const csv = `name,email,job_id
Invalid Job,invalid@test.com,non-existent-job-id`;

    const result = bulkImportApplicants(csv);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toContain("not found");
  });

  test("bulk import requires header row", () => {
    const result = bulkImportApplicants("single line only");
    expect(result.imported).toBe(0);
    expect(result.errors.length).toBe(1);
  });

  test("bulk import handles quoted CSV fields", () => {
    const csv = `name,email,job_id,source
"Last, First",quoted@test.com,${jobId},linkedin`;

    const result = bulkImportApplicants(csv);
    expect(result.imported).toBe(1);

    const found = searchApplicants("Last, First");
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0].name).toBe("Last, First");
  });

  test("bulk import skips empty lines", () => {
    const csv = `name,email,job_id
Empty Line,empty@test.com,${jobId}

Another,another@test.com,${jobId}`;

    const result = bulkImportApplicants(csv);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
  });
});

// ---- Offer Letter Generation ----

describe("Offer Letter Generation", () => {
  test("generate offer letter", () => {
    const job = createJob({
      title: "Senior Engineer",
      department: "Engineering",
      type: "full-time",
      salary_range: "120k-160k",
    });
    const applicant = createApplicant({
      job_id: job.id,
      name: "Offer Candidate",
      email: "offer@test.com",
    });

    const letter = generateOffer(applicant.id, {
      salary: 140000,
      start_date: "2026-04-01",
    });

    expect(letter).toContain("Offer Letter");
    expect(letter).toContain("Offer Candidate");
    expect(letter).toContain("Senior Engineer");
    expect(letter).toContain("$140,000");
    expect(letter).toContain("2026-04-01");
    expect(letter).toContain("Engineering");

    // Check applicant was advanced to offered
    const updated = getApplicant(applicant.id);
    expect(updated!.status).toBe("offered");
    expect(updated!.metadata).toHaveProperty("offer");
  });

  test("generate offer with all options", () => {
    const job = createJob({ title: "CTO" });
    const applicant = createApplicant({ job_id: job.id, name: "Executive Hire" });

    const letter = generateOffer(applicant.id, {
      salary: 250000,
      start_date: "2026-05-01",
      position_title: "Chief Technology Officer",
      department: "Leadership",
      benefits: "Full health, dental, vision",
      equity: "0.5% over 4 years",
      signing_bonus: 50000,
    });

    expect(letter).toContain("Chief Technology Officer");
    expect(letter).toContain("Leadership");
    expect(letter).toContain("$250,000");
    expect(letter).toContain("$50,000");
    expect(letter).toContain("0.5% over 4 years");
    expect(letter).toContain("Full health, dental, vision");
  });

  test("generate offer for non-existent applicant throws", () => {
    expect(() => generateOffer("non-existent", { salary: 100000, start_date: "2026-01-01" })).toThrow(
      "not found"
    );
  });
});

// ---- Pipeline Velocity / Forecast ----

describe("Hiring Forecast", () => {
  test("get forecast for job with applicants", () => {
    const job = createJob({ title: "Forecast Test Job" });
    createApplicant({ job_id: job.id, name: "F1", status: "applied" });
    createApplicant({ job_id: job.id, name: "F2", status: "screening" });
    createApplicant({ job_id: job.id, name: "F3", status: "interviewing" });
    createApplicant({ job_id: job.id, name: "F4", status: "hired" });

    const forecast = getHiringForecast(job.id);

    expect(forecast.job_id).toBe(job.id);
    expect(forecast.job_title).toBe("Forecast Test Job");
    expect(forecast.total_applicants).toBe(4);
    expect(forecast.current_pipeline.length).toBeGreaterThanOrEqual(1);
    expect(typeof forecast.estimated_days_to_fill).toBe("number");
    expect(forecast.conversion_rates).toHaveProperty("applied");
  });

  test("forecast for non-existent job throws", () => {
    expect(() => getHiringForecast("non-existent")).toThrow("not found");
  });

  test("forecast for job with no applicants", () => {
    const job = createJob({ title: "Empty Forecast Job" });
    const forecast = getHiringForecast(job.id);

    expect(forecast.total_applicants).toBe(0);
    expect(forecast.estimated_days_to_fill).toBeNull();
  });
});

// ---- Structured Interview Feedback ----

describe("Structured Interview Feedback", () => {
  let applicantId: string;

  test("setup: create applicant for structured feedback", () => {
    const job = createJob({ title: "Structured Feedback Job" });
    const applicant = createApplicant({ job_id: job.id, name: "Feedback Candidate" });
    applicantId = applicant.id;
  });

  test("submit structured feedback with all dimensions", () => {
    const interview = createInterview({ applicant_id: applicantId, type: "video" });
    const result = submitStructuredFeedback(
      interview.id,
      {
        technical: 5,
        communication: 4,
        culture_fit: 4,
        problem_solving: 5,
        leadership: 3,
      },
      "Excellent technical skills, good communicator"
    );

    expect(result).toBeDefined();
    expect(result!.status).toBe("completed");
    // Rating should be the average of provided scores
    expect(result!.rating).toBe(4.2);

    // Feedback should be JSON with scores
    const feedbackData = JSON.parse(result!.feedback!);
    expect(feedbackData.scores.technical).toBe(5);
    expect(feedbackData.scores.communication).toBe(4);
    expect(feedbackData.text).toBe("Excellent technical skills, good communicator");
  });

  test("submit structured feedback with partial dimensions", () => {
    const interview = createInterview({ applicant_id: applicantId, type: "phone" });
    const result = submitStructuredFeedback(interview.id, {
      technical: 3,
      communication: 5,
    });

    expect(result).toBeDefined();
    expect(result!.rating).toBe(4);
  });

  test("submit structured feedback for non-existent interview returns null", () => {
    const result = submitStructuredFeedback("non-existent", { technical: 5 });
    expect(result).toBeNull();
  });
});

// ---- Bulk Rejection ----

describe("Bulk Rejection", () => {
  test("bulk reject applicants by status", () => {
    const job = createJob({ title: "Bulk Reject Job" });
    createApplicant({ job_id: job.id, name: "BR1" });
    createApplicant({ job_id: job.id, name: "BR2" });
    createApplicant({ job_id: job.id, name: "BR3", status: "screening" });

    const result = bulkReject(job.id, "applied", "Position filled");

    expect(result.rejected).toBe(2);
    expect(result.applicant_ids.length).toBe(2);

    // Verify they're actually rejected
    const remaining = listApplicants({ job_id: job.id, status: "applied" });
    expect(remaining.length).toBe(0);

    // Screening applicant should be untouched
    const screening = listApplicants({ job_id: job.id, status: "screening" });
    expect(screening.length).toBe(1);
  });

  test("bulk reject with no matching applicants", () => {
    const job = createJob({ title: "No Match Reject Job" });
    const result = bulkReject(job.id, "applied");
    expect(result.rejected).toBe(0);
  });
});

// ---- Referral Stats ----

describe("Referral Stats", () => {
  test("get referral stats", () => {
    // We've created applicants with various sources throughout the tests
    const stats = getReferralStats();
    expect(Array.isArray(stats)).toBe(true);

    // At minimum, we should have linkedin from earlier tests
    for (const stat of stats) {
      expect(stat).toHaveProperty("source");
      expect(stat).toHaveProperty("total");
      expect(stat).toHaveProperty("hired");
      expect(stat).toHaveProperty("rejected");
      expect(stat).toHaveProperty("in_progress");
      expect(stat).toHaveProperty("conversion_rate");
      expect(typeof stat.conversion_rate).toBe("number");
    }
  });

  test("referral stats include all source types", () => {
    const job = createJob({ title: "Referral Test Job" });
    createApplicant({ job_id: job.id, name: "RS1", source: "referral-test-src", status: "hired" });
    createApplicant({ job_id: job.id, name: "RS2", source: "referral-test-src", status: "rejected" });
    createApplicant({ job_id: job.id, name: "RS3", source: "referral-test-src" });

    const stats = getReferralStats();
    const testSrc = stats.find((s) => s.source === "referral-test-src");
    expect(testSrc).toBeDefined();
    expect(testSrc!.total).toBe(3);
    expect(testSrc!.hired).toBe(1);
    expect(testSrc!.rejected).toBe(1);
    expect(testSrc!.in_progress).toBe(1);
    expect(testSrc!.conversion_rate).toBeCloseTo(33.3, 0);
  });
});

// ---- Job Templates ----

describe("Job Templates", () => {
  let sourceJobId: string;

  test("save job as template", () => {
    const job = createJob({
      title: "Template Source Job",
      department: "Engineering",
      location: "Remote",
      type: "full-time",
      description: "Build and maintain services",
      requirements: ["TypeScript", "Node.js", "SQL"],
      salary_range: "120k-180k",
    });
    sourceJobId = job.id;

    const template = saveJobAsTemplate(job.id, "Senior Engineer Template");

    expect(template.id).toBeTruthy();
    expect(template.name).toBe("Senior Engineer Template");
    expect(template.title).toBe("Template Source Job");
    expect(template.department).toBe("Engineering");
    expect(template.requirements).toEqual(["TypeScript", "Node.js", "SQL"]);
  });

  test("get template by name", () => {
    const template = getJobTemplateByName("Senior Engineer Template");
    expect(template).toBeDefined();
    expect(template!.name).toBe("Senior Engineer Template");
  });

  test("get template by id", () => {
    const byName = getJobTemplateByName("Senior Engineer Template");
    const byId = getJobTemplate(byName!.id);
    expect(byId).toBeDefined();
    expect(byId!.name).toBe("Senior Engineer Template");
  });

  test("list templates", () => {
    const templates = listJobTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(1);
    expect(templates.some((t) => t.name === "Senior Engineer Template")).toBe(true);
  });

  test("create job from template", () => {
    const job = createJobFromTemplate("Senior Engineer Template");

    expect(job.title).toBe("Template Source Job");
    expect(job.department).toBe("Engineering");
    expect(job.location).toBe("Remote");
    expect(job.requirements).toEqual(["TypeScript", "Node.js", "SQL"]);
    expect(job.status).toBe("open");
  });

  test("create job from template with overrides", () => {
    const job = createJobFromTemplate("Senior Engineer Template", {
      title: "Staff Engineer",
      department: "Platform",
      salary_range: "180k-250k",
    });

    expect(job.title).toBe("Staff Engineer");
    expect(job.department).toBe("Platform");
    expect(job.salary_range).toBe("180k-250k");
    // Non-overridden fields come from template
    expect(job.location).toBe("Remote");
    expect(job.requirements).toEqual(["TypeScript", "Node.js", "SQL"]);
  });

  test("create job from non-existent template throws", () => {
    expect(() => createJobFromTemplate("Non-Existent Template")).toThrow("not found");
  });

  test("save template with duplicate name throws", () => {
    expect(() => saveJobAsTemplate(sourceJobId, "Senior Engineer Template")).toThrow();
  });

  test("delete template", () => {
    const template = saveJobAsTemplate(sourceJobId, "Temp Template To Delete");
    expect(deleteJobTemplate(template.id)).toBe(true);
    expect(getJobTemplate(template.id)).toBeNull();
  });

  test("get non-existent template returns null", () => {
    expect(getJobTemplate("non-existent")).toBeNull();
    expect(getJobTemplateByName("non-existent")).toBeNull();
  });
});
