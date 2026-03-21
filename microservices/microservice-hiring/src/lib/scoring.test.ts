import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-hiring-scoring-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import { buildScoringPrompt, parseScoreResponse } from "./scoring";
import { createJob, createApplicant } from "../db/hiring";
import { closeDatabase } from "../db/database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Scoring - Prompt Builder", () => {
  test("builds prompt with job and applicant details", () => {
    const job = createJob({
      title: "Senior Developer",
      department: "Engineering",
      description: "Build scalable systems",
      requirements: ["TypeScript", "Node.js", "AWS"],
      salary_range: "130k-170k",
    });

    const applicant = createApplicant({
      job_id: job.id,
      name: "Test Candidate",
      email: "test@example.com",
      resume_url: "https://example.com/resume.pdf",
      notes: "5 years experience in TypeScript",
      source: "linkedin",
    });

    const prompt = buildScoringPrompt(job, applicant);

    expect(prompt).toContain("Senior Developer");
    expect(prompt).toContain("Engineering");
    expect(prompt).toContain("Build scalable systems");
    expect(prompt).toContain("TypeScript, Node.js, AWS");
    expect(prompt).toContain("Test Candidate");
    expect(prompt).toContain("https://example.com/resume.pdf");
    expect(prompt).toContain("5 years experience in TypeScript");
    expect(prompt).toContain("match_pct");
    expect(prompt).toContain("strengths");
    expect(prompt).toContain("gaps");
    expect(prompt).toContain("recommendation");
  });

  test("builds prompt with minimal data", () => {
    const job = createJob({ title: "Junior Dev" });
    const applicant = createApplicant({ job_id: job.id, name: "Minimal Candidate" });

    const prompt = buildScoringPrompt(job, applicant);

    expect(prompt).toContain("Junior Dev");
    expect(prompt).toContain("Minimal Candidate");
    expect(prompt).toContain("No specific requirements listed");
  });
});

describe("Scoring - Response Parser", () => {
  test("parses valid JSON response", () => {
    const response = JSON.stringify({
      match_pct: 85,
      strengths: ["Strong TypeScript skills", "AWS experience"],
      gaps: ["No leadership experience"],
      recommendation: "strong_hire — Excellent technical fit",
    });

    const result = parseScoreResponse(response);

    expect(result.match_pct).toBe(85);
    expect(result.strengths).toEqual(["Strong TypeScript skills", "AWS experience"]);
    expect(result.gaps).toEqual(["No leadership experience"]);
    expect(result.recommendation).toContain("strong_hire");
  });

  test("parses JSON wrapped in code fences", () => {
    const response = `\`\`\`json
{
  "match_pct": 72,
  "strengths": ["Good communicator"],
  "gaps": ["Lacks SQL experience"],
  "recommendation": "maybe — Needs training"
}
\`\`\``;

    const result = parseScoreResponse(response);

    expect(result.match_pct).toBe(72);
    expect(result.strengths).toEqual(["Good communicator"]);
    expect(result.gaps).toEqual(["Lacks SQL experience"]);
  });

  test("clamps match_pct to 0-100", () => {
    const overResult = parseScoreResponse(JSON.stringify({
      match_pct: 150,
      strengths: [],
      gaps: [],
      recommendation: "test",
    }));
    expect(overResult.match_pct).toBe(100);

    const underResult = parseScoreResponse(JSON.stringify({
      match_pct: -10,
      strengths: [],
      gaps: [],
      recommendation: "test",
    }));
    expect(underResult.match_pct).toBe(0);
  });

  test("handles invalid JSON gracefully", () => {
    const result = parseScoreResponse("This is not JSON at all");

    expect(result.match_pct).toBe(0);
    expect(result.strengths).toEqual([]);
    expect(result.gaps).toEqual([]);
    expect(result.recommendation).toContain("could not be parsed");
  });

  test("handles missing fields in JSON", () => {
    const result = parseScoreResponse(JSON.stringify({ match_pct: 50 }));

    expect(result.match_pct).toBe(50);
    expect(result.strengths).toEqual([]);
    expect(result.gaps).toEqual([]);
    expect(result.recommendation).toContain("Unable to determine");
  });

  test("handles non-array strengths/gaps", () => {
    const result = parseScoreResponse(JSON.stringify({
      match_pct: 60,
      strengths: "not an array",
      gaps: 42,
      recommendation: "maybe",
    }));

    expect(result.strengths).toEqual([]);
    expect(result.gaps).toEqual([]);
  });
});
