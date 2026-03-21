import { describe, it, expect, beforeEach } from "bun:test";
import {
  createTranscript,
  getTranscript,
  updateTranscript,
} from "../db/transcripts.js";
import {
  createProofreadIssue,
  getProofreadIssue,
  listProofreadIssues,
  updateIssueStatus,
  deleteProofreadIssuesByTranscript,
  getProofreadStats,
} from "../db/proofread.js";
import {
  listIssues,
  applySuggestion,
  dismissIssue,
  exportAnnotated,
  getProofreadStats as getLibProofreadStats,
} from "./proofread.js";
import { closeDatabase } from "../db/database.js";

const BASE_DIR = `/tmp/test-proofread-${Date.now()}`;

function freshDb(suffix: string) {
  closeDatabase();
  process.env["MICROSERVICES_DIR"] = `${BASE_DIR}-${suffix}-${Date.now()}`;
}

function createCompletedTranscript(text: string) {
  const t = createTranscript({ source_url: "/test.mp3", source_type: "file" });
  updateTranscript(t.id, { status: "completed", transcript_text: text });
  return getTranscript(t.id)!;
}

// ---------------------------------------------------------------------------
// DB CRUD
// ---------------------------------------------------------------------------

describe("proofread_issues CRUD", () => {
  beforeEach(() => freshDb("crud"));

  it("creates a proofread issue", () => {
    const t = createCompletedTranscript("Hello wrold");
    const issue = createProofreadIssue({
      transcript_id: t.id,
      issue_type: "spelling",
      position_start: 6,
      position_end: 11,
      original_text: "wrold",
      suggestion: "world",
      confidence: 0.95,
      explanation: "Misspelled word",
    });
    expect(issue.id).toBeDefined();
    expect(issue.issue_type).toBe("spelling");
    expect(issue.original_text).toBe("wrold");
    expect(issue.suggestion).toBe("world");
    expect(issue.status).toBe("pending");
    expect(issue.confidence).toBe(0.95);
  });

  it("retrieves an issue by id", () => {
    const t = createCompletedTranscript("Test text");
    const issue = createProofreadIssue({
      transcript_id: t.id,
      issue_type: "grammar",
      original_text: "Test",
      suggestion: "A test",
    });
    const fetched = getProofreadIssue(issue.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(issue.id);
  });

  it("returns null for nonexistent issue", () => {
    const t = createCompletedTranscript("Text");
    expect(getProofreadIssue("nonexistent-id")).toBeNull();
  });

  it("lists issues for a transcript", () => {
    const t = createCompletedTranscript("Hello wrold, this is a tset.");
    createProofreadIssue({ transcript_id: t.id, issue_type: "spelling", original_text: "wrold", suggestion: "world" });
    createProofreadIssue({ transcript_id: t.id, issue_type: "spelling", original_text: "tset", suggestion: "test" });

    const issues = listProofreadIssues(t.id);
    expect(issues.length).toBe(2);
  });

  it("filters issues by type", () => {
    const t = createCompletedTranscript("Hello wrold its a tset");
    createProofreadIssue({ transcript_id: t.id, issue_type: "spelling", original_text: "wrold" });
    createProofreadIssue({ transcript_id: t.id, issue_type: "grammar", original_text: "its" });

    const spelling = listProofreadIssues(t.id, { issue_type: "spelling" });
    expect(spelling.length).toBe(1);
    expect(spelling[0].issue_type).toBe("spelling");

    const grammar = listProofreadIssues(t.id, { issue_type: "grammar" });
    expect(grammar.length).toBe(1);
    expect(grammar[0].issue_type).toBe("grammar");
  });

  it("filters issues by status", () => {
    const t = createCompletedTranscript("Text here");
    const issue = createProofreadIssue({ transcript_id: t.id, issue_type: "spelling", original_text: "here" });
    updateIssueStatus(issue.id, "applied");

    const pending = listProofreadIssues(t.id, { status: "pending" });
    expect(pending.length).toBe(0);

    const applied = listProofreadIssues(t.id, { status: "applied" });
    expect(applied.length).toBe(1);
  });

  it("updates issue status", () => {
    const t = createCompletedTranscript("Text");
    const issue = createProofreadIssue({ transcript_id: t.id, issue_type: "spelling", original_text: "Text" });
    expect(issue.status).toBe("pending");

    const updated = updateIssueStatus(issue.id, "dismissed");
    expect(updated!.status).toBe("dismissed");
  });

  it("updateIssueStatus returns null for nonexistent id", () => {
    const t = createCompletedTranscript("Text");
    expect(updateIssueStatus("bad-id", "dismissed")).toBeNull();
  });

  it("deletes issues by transcript", () => {
    const t = createCompletedTranscript("Text with issues");
    createProofreadIssue({ transcript_id: t.id, issue_type: "spelling", original_text: "issues" });
    createProofreadIssue({ transcript_id: t.id, issue_type: "grammar", original_text: "with" });

    const deleted = deleteProofreadIssuesByTranscript(t.id);
    expect(deleted).toBe(2);
    expect(listProofreadIssues(t.id).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

describe("getProofreadStats", () => {
  beforeEach(() => freshDb("stats"));

  it("returns correct stats", () => {
    const t = createCompletedTranscript("Hello wrold, this is grammer.");
    createProofreadIssue({ transcript_id: t.id, issue_type: "spelling", original_text: "wrold" });
    createProofreadIssue({ transcript_id: t.id, issue_type: "grammar", original_text: "grammer" });
    const issue3 = createProofreadIssue({ transcript_id: t.id, issue_type: "punctuation", original_text: "." });
    updateIssueStatus(issue3.id, "dismissed");

    const stats = getProofreadStats(t.id);
    expect(stats.total).toBe(3);
    expect(stats.pending).toBe(2);
    expect(stats.dismissed).toBe(1);
    expect(stats.applied).toBe(0);
    expect(stats.by_type["spelling"]).toBe(1);
    expect(stats.by_type["grammar"]).toBe(1);
    expect(stats.by_type["punctuation"]).toBe(1);
  });

  it("returns zeros for transcript with no issues", () => {
    const t = createCompletedTranscript("Perfect text.");
    const stats = getProofreadStats(t.id);
    expect(stats.total).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.applied).toBe(0);
    expect(stats.dismissed).toBe(0);
  });

  it("lib getProofreadStats matches db getProofreadStats", () => {
    const t = createCompletedTranscript("Test text here");
    createProofreadIssue({ transcript_id: t.id, issue_type: "clarity", original_text: "here" });

    const libStats = getLibProofreadStats(t.id);
    const dbStats = getProofreadStats(t.id);
    expect(libStats.total).toBe(dbStats.total);
    expect(libStats.pending).toBe(dbStats.pending);
  });
});

// ---------------------------------------------------------------------------
// Apply / Dismiss
// ---------------------------------------------------------------------------

describe("applySuggestion", () => {
  beforeEach(() => freshDb("apply"));

  it("applies suggestion with position info", () => {
    const t = createCompletedTranscript("Hello wrold!");
    const issue = createProofreadIssue({
      transcript_id: t.id,
      issue_type: "spelling",
      position_start: 6,
      position_end: 11,
      original_text: "wrold",
      suggestion: "world",
    });

    const result = applySuggestion(issue.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("applied");

    const updated = getTranscript(t.id);
    expect(updated!.transcript_text).toBe("Hello world!");
  });

  it("applies suggestion without position info (first occurrence)", () => {
    const t = createCompletedTranscript("This is a tset of the system.");
    const issue = createProofreadIssue({
      transcript_id: t.id,
      issue_type: "spelling",
      original_text: "tset",
      suggestion: "test",
    });

    applySuggestion(issue.id);
    const updated = getTranscript(t.id);
    expect(updated!.transcript_text).toBe("This is a test of the system.");
  });

  it("falls back to string replacement when position text does not match", () => {
    const t = createCompletedTranscript("Hello wrold!");
    const issue = createProofreadIssue({
      transcript_id: t.id,
      issue_type: "spelling",
      position_start: 100, // wrong position
      position_end: 105,
      original_text: "wrold",
      suggestion: "world",
    });

    applySuggestion(issue.id);
    const updated = getTranscript(t.id);
    expect(updated!.transcript_text).toBe("Hello world!");
  });

  it("returns null for nonexistent issue", () => {
    createCompletedTranscript("text");
    expect(applySuggestion("nonexistent")).toBeNull();
  });

  it("does not re-apply already applied issues", () => {
    const t = createCompletedTranscript("Hello wrold!");
    const issue = createProofreadIssue({
      transcript_id: t.id,
      issue_type: "spelling",
      position_start: 6,
      position_end: 11,
      original_text: "wrold",
      suggestion: "world",
    });

    applySuggestion(issue.id);
    const result2 = applySuggestion(issue.id);
    expect(result2!.status).toBe("applied");

    // Text should not have double-applied
    const updated = getTranscript(t.id);
    expect(updated!.transcript_text).toBe("Hello world!");
  });

  it("dismisses issue when suggestion is null", () => {
    const t = createCompletedTranscript("Some text");
    const issue = createProofreadIssue({
      transcript_id: t.id,
      issue_type: "clarity",
      original_text: "Some text",
      // no suggestion
    });

    const result = applySuggestion(issue.id);
    expect(result!.status).toBe("dismissed");

    // Text unchanged
    const updated = getTranscript(t.id);
    expect(updated!.transcript_text).toBe("Some text");
  });
});

describe("dismissIssue", () => {
  beforeEach(() => freshDb("dismiss"));

  it("dismisses a pending issue", () => {
    const t = createCompletedTranscript("Hello wrold");
    const issue = createProofreadIssue({
      transcript_id: t.id,
      issue_type: "spelling",
      original_text: "wrold",
      suggestion: "world",
    });

    const result = dismissIssue(issue.id);
    expect(result!.status).toBe("dismissed");

    // Text unchanged
    const updated = getTranscript(t.id);
    expect(updated!.transcript_text).toBe("Hello wrold");
  });

  it("returns null for nonexistent issue", () => {
    createCompletedTranscript("text");
    expect(dismissIssue("bad-id")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listIssues (lib wrapper)
// ---------------------------------------------------------------------------

describe("listIssues", () => {
  beforeEach(() => freshDb("list"));

  it("lists all issues without filters", () => {
    const t = createCompletedTranscript("Text with typos");
    createProofreadIssue({ transcript_id: t.id, issue_type: "spelling", original_text: "typos" });
    createProofreadIssue({ transcript_id: t.id, issue_type: "grammar", original_text: "with" });

    const issues = listIssues(t.id);
    expect(issues.length).toBe(2);
  });

  it("filters by type and status", () => {
    const t = createCompletedTranscript("Text here now");
    createProofreadIssue({ transcript_id: t.id, issue_type: "spelling", original_text: "here" });
    const g = createProofreadIssue({ transcript_id: t.id, issue_type: "grammar", original_text: "now" });
    updateIssueStatus(g.id, "applied");

    const pending = listIssues(t.id, { status: "pending" });
    expect(pending.length).toBe(1);
    expect(pending[0].issue_type).toBe("spelling");
  });
});

// ---------------------------------------------------------------------------
// exportAnnotated
// ---------------------------------------------------------------------------

describe("exportAnnotated", () => {
  beforeEach(() => freshDb("export"));

  it("returns original text when no pending issues", () => {
    const t = createCompletedTranscript("Perfect text here.");
    const result = exportAnnotated(t.id);
    expect(result).toBe("Perfect text here.");
  });

  it("inserts markers for pending issues with positions", () => {
    const t = createCompletedTranscript("Hello wrold!");
    createProofreadIssue({
      transcript_id: t.id,
      issue_type: "spelling",
      position_start: 6,
      position_end: 11,
      original_text: "wrold",
      suggestion: "world",
    });

    const result = exportAnnotated(t.id);
    expect(result).toContain('[SPELLING: "wrold" -> "world"]');
    expect(result).not.toContain("wrold!");
  });

  it("inserts markers for issues without positions (string match)", () => {
    const t = createCompletedTranscript("This is a tset.");
    createProofreadIssue({
      transcript_id: t.id,
      issue_type: "spelling",
      original_text: "tset",
      suggestion: "test",
    });

    const result = exportAnnotated(t.id);
    expect(result).toContain('[SPELLING: "tset" -> "test"]');
  });

  it("shows marker without suggestion arrow when suggestion is null", () => {
    const t = createCompletedTranscript("Unclear text here.");
    createProofreadIssue({
      transcript_id: t.id,
      issue_type: "clarity",
      original_text: "Unclear text here.",
    });

    const result = exportAnnotated(t.id);
    expect(result).toContain('[CLARITY: "Unclear text here."]');
    expect(result).not.toContain("->");
  });

  it("skips applied/dismissed issues", () => {
    const t = createCompletedTranscript("Hello wrold tset!");
    const i1 = createProofreadIssue({
      transcript_id: t.id,
      issue_type: "spelling",
      position_start: 6,
      position_end: 11,
      original_text: "wrold",
      suggestion: "world",
    });
    createProofreadIssue({
      transcript_id: t.id,
      issue_type: "spelling",
      original_text: "tset",
      suggestion: "test",
    });
    updateIssueStatus(i1.id, "dismissed");

    const result = exportAnnotated(t.id);
    // wrold should remain untouched (dismissed)
    expect(result).toContain("wrold");
    // tset should have marker (pending)
    expect(result).toContain('[SPELLING: "tset" -> "test"]');
  });

  it("throws for nonexistent transcript", () => {
    expect(() => exportAnnotated("bad-id")).toThrow();
  });

  it("handles multiple positional issues without overlap", () => {
    const t = createCompletedTranscript("The wrold is beutiful today.");
    createProofreadIssue({
      transcript_id: t.id,
      issue_type: "spelling",
      position_start: 4,
      position_end: 9,
      original_text: "wrold",
      suggestion: "world",
    });
    createProofreadIssue({
      transcript_id: t.id,
      issue_type: "spelling",
      position_start: 13,
      position_end: 21,
      original_text: "beutiful",
      suggestion: "beautiful",
    });

    const result = exportAnnotated(t.id);
    expect(result).toContain('[SPELLING: "wrold" -> "world"]');
    expect(result).toContain('[SPELLING: "beutiful" -> "beautiful"]');
  });
});
