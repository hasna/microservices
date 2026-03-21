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
