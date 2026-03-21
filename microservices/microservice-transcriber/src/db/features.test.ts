import { describe, it, expect, beforeEach } from "bun:test";
import {
  createTranscript, getTranscript, updateTranscript,
  renameSpeakers, findBySourceUrl,
  addTags, removeTags, getTags, listAllTags, listTranscriptsByTag,
  searchWithContext,
} from "./transcripts.js";
import { createAnnotation, listAnnotations, deleteAnnotation } from "./annotations.js";
import { closeDatabase } from "./database.js";

// Fresh DB per describe block
const BASE_DIR = `/tmp/test-features-${Date.now()}`;

describe("renameSpeakers", () => {
  beforeEach(() => { closeDatabase(); process.env["MICROSERVICES_DIR"] = `${BASE_DIR}-rename-${Date.now()}`; });

  it("replaces speaker labels in text", () => {
    const t = createTranscript({ source_url: "/a.mp3", source_type: "file" });
    updateTranscript(t.id, {
      status: "completed",
      transcript_text: "Speaker 1: Hello\nSpeaker 2: Hi",
      metadata: {
        speakers: [
          { speaker_id: "speaker_0", start: 0, end: 1, text: "Hello" },
          { speaker_id: "speaker_1", start: 1, end: 2, text: "Hi" },
        ],
      },
    });

    const updated = renameSpeakers(t.id, { "Speaker 1": "Alice", "Speaker 2": "Bob" });
    expect(updated?.transcript_text).toContain("Alice:");
    expect(updated?.transcript_text).toContain("Bob:");
  });

  it("returns null for nonexistent id", () => {
    expect(renameSpeakers("bad-id", {})).toBeNull();
  });
});

describe("findBySourceUrl", () => {
  beforeEach(() => { closeDatabase(); process.env["MICROSERVICES_DIR"] = `${BASE_DIR}-dedup-${Date.now()}`; });

  it("finds a completed transcript by URL", () => {
    const t = createTranscript({ source_url: "https://example.com/vid", source_type: "url" });
    updateTranscript(t.id, { status: "completed", transcript_text: "hello" });

    const found = findBySourceUrl("https://example.com/vid");
    expect(found?.id).toBe(t.id);
  });

  it("returns null for pending transcripts", () => {
    createTranscript({ source_url: "https://example.com/pending", source_type: "url" });
    expect(findBySourceUrl("https://example.com/pending")).toBeNull();
  });

  it("returns null for unknown URL", () => {
    expect(findBySourceUrl("https://unknown.com")).toBeNull();
  });
});

describe("tags", () => {
  beforeEach(() => { closeDatabase(); process.env["MICROSERVICES_DIR"] = `${BASE_DIR}-tags-${Date.now()}`; });

  it("adds and retrieves tags", () => {
    const t = createTranscript({ source_url: "/a.mp3", source_type: "file" });
    addTags(t.id, ["podcast", "AI", "interview"]);
    const tags = getTags(t.id);
    expect(tags).toContain("podcast");
    expect(tags).toContain("ai"); // lowercased
    expect(tags).toContain("interview");
  });

  it("removes tags", () => {
    const t = createTranscript({ source_url: "/a.mp3", source_type: "file" });
    addTags(t.id, ["a", "b", "c"]);
    removeTags(t.id, ["b"]);
    expect(getTags(t.id)).toEqual(["a", "c"]);
  });

  it("ignores duplicate tags", () => {
    const t = createTranscript({ source_url: "/a.mp3", source_type: "file" });
    addTags(t.id, ["x", "x", "y"]);
    expect(getTags(t.id)).toEqual(["x", "y"]);
  });

  it("lists all tags with counts", () => {
    const t1 = createTranscript({ source_url: "/a.mp3", source_type: "file" });
    const t2 = createTranscript({ source_url: "/b.mp3", source_type: "file" });
    addTags(t1.id, ["common", "unique1"]);
    addTags(t2.id, ["common"]);
    const all = listAllTags();
    expect(all.find((t) => t.tag === "common")?.count).toBe(2);
  });

  it("lists transcripts by tag", () => {
    const t = createTranscript({ source_url: "/a.mp3", source_type: "file" });
    addTags(t.id, ["special"]);
    createTranscript({ source_url: "/b.mp3", source_type: "file" }); // no tags
    const results = listTranscriptsByTag("special");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(t.id);
  });
});

describe("searchWithContext", () => {
  beforeEach(() => { closeDatabase(); process.env["MICROSERVICES_DIR"] = `${BASE_DIR}-ctx-${Date.now()}`; });

  it("returns excerpts with context", () => {
    const t = createTranscript({ source_url: "/a.mp3", source_type: "file", title: "Test" });
    updateTranscript(t.id, {
      status: "completed",
      transcript_text: "First sentence. This is a match keyword here. Third sentence. Fourth.",
    });

    const results = searchWithContext("keyword", 1);
    expect(results).toHaveLength(1);
    expect(results[0].excerpt).toContain("keyword");
    expect(results[0].transcript_id).toBe(t.id);
  });
});

describe("annotations", () => {
  beforeEach(() => { closeDatabase(); process.env["MICROSERVICES_DIR"] = `${BASE_DIR}-anno-${Date.now()}`; });

  it("creates and lists annotations", () => {
    const t = createTranscript({ source_url: "/a.mp3", source_type: "file" });
    createAnnotation(t.id, 30.5, "Important point");
    createAnnotation(t.id, 120, "Another note");

    const annos = listAnnotations(t.id);
    expect(annos).toHaveLength(2);
    expect(annos[0].timestamp_sec).toBe(30.5); // ordered by timestamp
    expect(annos[0].note).toBe("Important point");
  });

  it("deletes annotations", () => {
    const t = createTranscript({ source_url: "/a.mp3", source_type: "file" });
    const anno = createAnnotation(t.id, 10, "Delete me");
    expect(deleteAnnotation(anno.id)).toBe(true);
    expect(listAnnotations(t.id)).toHaveLength(0);
  });

  it("returns false for nonexistent annotation", () => {
    expect(deleteAnnotation("nonexistent")).toBe(false);
  });
});
