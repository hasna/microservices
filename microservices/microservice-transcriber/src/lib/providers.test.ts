import { describe, it, expect } from "bun:test";
import { toSrt, toVtt, toAss, toMarkdown, formatWithConfidence, estimateCost, segmentByChapters } from "./providers.js";

const WORDS = [
  { text: "Hello", start: 0, end: 0.5 },
  { text: "world", start: 0.6, end: 1.0 },
  { text: "this", start: 1.1, end: 1.3 },
  { text: "is", start: 1.4, end: 1.5 },
  { text: "a", start: 1.6, end: 1.7 },
  { text: "test", start: 1.8, end: 2.0 },
];

describe("toSrt", () => {
  it("generates valid SRT", () => {
    const srt = toSrt(WORDS);
    expect(srt).toContain("1\n");
    expect(srt).toContain("-->");
    expect(srt).toContain("Hello world");
    expect(srt).toContain(","); // SRT uses comma for ms
  });

  it("returns empty for no words", () => {
    expect(toSrt([])).toBe("");
  });
});

describe("toVtt", () => {
  it("starts with WEBVTT header", () => {
    const vtt = toVtt(WORDS);
    expect(vtt).toStartWith("WEBVTT");
  });

  it("uses dot separator (not comma)", () => {
    const vtt = toVtt(WORDS);
    expect(vtt).toContain(".");
    expect(vtt).not.toContain(",");
  });

  it("returns WEBVTT for empty words", () => {
    expect(toVtt([])).toBe("WEBVTT\n");
  });
});

describe("toAss", () => {
  it("generates valid ASS with sections", () => {
    const ass = toAss(WORDS);
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("[Events]");
    expect(ass).toContain("Dialogue:");
  });

  it("accepts custom style", () => {
    const ass = toAss(WORDS, { fontName: "Helvetica", fontSize: 24, color: "FF0000" });
    expect(ass).toContain("Helvetica");
    expect(ass).toContain("24");
  });

  it("returns empty for no words", () => {
    expect(toAss([])).toBe("");
  });
});

describe("toMarkdown", () => {
  it("includes title as heading", () => {
    const md = toMarkdown({
      id: "test", title: "My Video", source_url: "https://example.com", source_type: "youtube",
      provider: "elevenlabs", language: "en", status: "completed", transcript_text: "Hello world",
      error_message: null, metadata: {}, created_at: "", updated_at: "", duration_seconds: 120,
      word_count: 2, source_transcript_id: null,
    });
    expect(md).toContain("# My Video");
    expect(md).toContain("Hello world");
  });
});

describe("formatWithConfidence", () => {
  it("flags low-confidence words", () => {
    const words = [
      { text: "Hello", logprob: -0.01 },  // 99% confidence
      { text: "wrld", logprob: -2.0 },    // ~13% confidence
    ];
    const result = formatWithConfidence(words, 0.7);
    expect(result).toContain("Hello");
    expect(result).toContain("[?wrld?]");
  });

  it("leaves words without logprob unchanged", () => {
    const result = formatWithConfidence([{ text: "test" }]);
    expect(result).toBe("test");
  });
});

describe("estimateCost", () => {
  it("calculates elevenlabs cost", () => {
    const cost = estimateCost("elevenlabs", 3600); // 1 hour
    expect(cost).toBeGreaterThan(0.3);
    expect(cost).toBeLessThan(0.5);
  });

  it("calculates openai cost", () => {
    const cost = estimateCost("openai", 600); // 10 min
    expect(cost).toBeGreaterThan(0.05);
  });

  it("returns 0 for unknown provider", () => {
    expect(estimateCost("unknown", 600)).toBe(0);
  });
});

describe("segmentByChapters", () => {
  it("maps words to chapters", () => {
    const words = [
      { text: "Hello", start: 0, end: 1 },
      { text: "world", start: 2, end: 3 },
      { text: "goodbye", start: 10, end: 11 },
    ];
    const chapters = [
      { title: "Intro", start_time: 0, end_time: 5 },
      { title: "Outro", start_time: 5, end_time: 15 },
    ];
    const result = segmentByChapters(words, chapters);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Intro");
    expect(result[0].text).toContain("Hello");
    expect(result[1].title).toBe("Outro");
    expect(result[1].text).toContain("goodbye");
  });

  it("returns empty for no chapters", () => {
    expect(segmentByChapters(WORDS, [])).toEqual([]);
  });
});
