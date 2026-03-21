import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createTranscript,
  getTranscript,
  updateTranscript,
  deleteTranscript,
  listTranscripts,
  searchTranscripts,
  countTranscripts,
} from "./transcripts.js";
import { closeDatabase } from "./database.js";

// Use a temp DB for tests
process.env["MICROSERVICES_DIR"] = `/tmp/test-transcriber-${Date.now()}`;

afterEach(() => {
  closeDatabase();
});

describe("createTranscript", () => {
  it("creates a transcript with defaults", () => {
    const t = createTranscript({
      source_url: "https://www.youtube.com/watch?v=test",
      source_type: "youtube",
    });

    expect(t.id).toBeTruthy();
    expect(t.source_url).toBe("https://www.youtube.com/watch?v=test");
    expect(t.source_type).toBe("youtube");
    expect(t.provider).toBe("elevenlabs");
    expect(t.status).toBe("pending");
    expect(t.language).toBe("en");
    expect(t.transcript_text).toBeNull();
    expect(t.metadata).toEqual({});
  });

  it("creates a transcript with custom provider", () => {
    const t = createTranscript({
      source_url: "/path/to/audio.mp3",
      source_type: "file",
      provider: "openai",
      language: "fr",
      title: "My Audio",
    });

    expect(t.provider).toBe("openai");
    expect(t.language).toBe("fr");
    expect(t.title).toBe("My Audio");
  });
});

describe("getTranscript", () => {
  it("returns null for unknown id", () => {
    expect(getTranscript("nonexistent")).toBeNull();
  });

  it("retrieves a created transcript", () => {
    const t = createTranscript({ source_url: "/audio.mp3", source_type: "file" });
    const fetched = getTranscript(t.id);
    expect(fetched?.id).toBe(t.id);
  });
});

describe("updateTranscript", () => {
  it("updates status and transcript text", () => {
    const t = createTranscript({ source_url: "/audio.mp3", source_type: "file" });
    const updated = updateTranscript(t.id, {
      status: "completed",
      transcript_text: "Hello world",
      word_count: 2,
      duration_seconds: 5.5,
    });

    expect(updated?.status).toBe("completed");
    expect(updated?.transcript_text).toBe("Hello world");
    expect(updated?.word_count).toBe(2);
    expect(updated?.duration_seconds).toBe(5.5);
  });

  it("updates metadata", () => {
    const t = createTranscript({ source_url: "/audio.mp3", source_type: "file" });
    const updated = updateTranscript(t.id, {
      metadata: { model: "scribe_v1", words: [{ text: "Hello", start: 0, end: 0.5 }] },
    });

    expect(updated?.metadata.model).toBe("scribe_v1");
    expect(updated?.metadata.words).toHaveLength(1);
  });

  it("returns null for unknown id", () => {
    expect(updateTranscript("nonexistent", { status: "failed" })).toBeNull();
  });
});

describe("deleteTranscript", () => {
  it("deletes an existing transcript", () => {
    const t = createTranscript({ source_url: "/audio.mp3", source_type: "file" });
    expect(deleteTranscript(t.id)).toBe(true);
    expect(getTranscript(t.id)).toBeNull();
  });

  it("returns false for nonexistent id", () => {
    expect(deleteTranscript("nonexistent")).toBe(false);
  });
});

describe("listTranscripts", () => {
  beforeEach(() => {
    closeDatabase();
    process.env["MICROSERVICES_DIR"] = `/tmp/test-transcriber-list-${Date.now()}`;
  });

  it("returns all transcripts", () => {
    createTranscript({ source_url: "/a.mp3", source_type: "file" });
    createTranscript({ source_url: "https://youtube.com/watch?v=x", source_type: "youtube" });

    const all = listTranscripts();
    expect(all.length).toBe(2);
  });

  it("filters by status", () => {
    const t = createTranscript({ source_url: "/a.mp3", source_type: "file" });
    updateTranscript(t.id, { status: "completed", transcript_text: "hi" });

    const completed = listTranscripts({ status: "completed" });
    expect(completed.length).toBe(1);
    expect(completed[0].id).toBe(t.id);
  });

  it("filters by provider", () => {
    createTranscript({ source_url: "/a.mp3", source_type: "file", provider: "elevenlabs" });
    createTranscript({ source_url: "/b.mp3", source_type: "file", provider: "openai" });

    expect(listTranscripts({ provider: "openai" }).length).toBe(1);
  });

  it("filters by source_type", () => {
    createTranscript({ source_url: "/a.mp3", source_type: "file" });
    createTranscript({ source_url: "https://vimeo.com/123", source_type: "vimeo" });

    expect(listTranscripts({ source_type: "vimeo" }).length).toBe(1);
  });
});

describe("searchTranscripts", () => {
  beforeEach(() => {
    closeDatabase();
    process.env["MICROSERVICES_DIR"] = `/tmp/test-transcriber-search-${Date.now()}`;
  });

  it("finds by transcript text", () => {
    const t = createTranscript({ source_url: "/a.mp3", source_type: "file" });
    updateTranscript(t.id, { status: "completed", transcript_text: "The quick brown fox" });

    const results = searchTranscripts("brown fox");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(t.id);
  });

  it("finds by title", () => {
    createTranscript({ source_url: "/a.mp3", source_type: "file", title: "Quarterly Review" });

    const results = searchTranscripts("Quarterly");
    expect(results.length).toBe(1);
  });

  it("returns empty for no match", () => {
    createTranscript({ source_url: "/a.mp3", source_type: "file" });
    expect(searchTranscripts("zzznomatch")).toHaveLength(0);
  });
});

describe("countTranscripts", () => {
  beforeEach(() => {
    closeDatabase();
    process.env["MICROSERVICES_DIR"] = `/tmp/test-transcriber-count-${Date.now()}`;
  });

  it("counts by status and provider", () => {
    const t1 = createTranscript({ source_url: "/a.mp3", source_type: "file" });
    const t2 = createTranscript({ source_url: "/b.mp3", source_type: "file", provider: "openai" });
    updateTranscript(t1.id, { status: "completed", transcript_text: "hi" });

    const counts = countTranscripts();
    expect(counts.total).toBe(2);
    expect(counts.by_status["completed"]).toBe(1);
    expect(counts.by_status["pending"]).toBe(1);
    expect(counts.by_provider["elevenlabs"]).toBe(1);
    expect(counts.by_provider["openai"]).toBe(1);
  });
});
