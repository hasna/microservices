/**
 * Unit tests for microservice-knowledge chunking and hashing.
 * No database, no OpenAI API — pure logic tests.
 */

import { describe, expect, it } from "bun:test";
import { chunkText, estimateTokens } from "./chunking.js";
import { hashContent } from "./documents.js";

// --------------------------------------------------------------------------
// Test: fixed chunking splits correctly with overlap
// --------------------------------------------------------------------------

describe("fixed chunking", () => {
  it("splits 1000 chars with overlap correctly", () => {
    const text = "a".repeat(1000);
    const chunks = chunkText(text, {
      strategy: "fixed",
      chunkSize: 400,
      chunkOverlap: 100,
    });
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should be 400 chars
    expect(chunks[0]?.length).toBe(400);
    // Second chunk should start 300 chars into text (400 - 100 overlap)
    expect(chunks[1]!).toBe(text.slice(300, 700));
  });

  it("returns single chunk when text is shorter than chunkSize", () => {
    const text = "Hello world";
    const chunks = chunkText(text, {
      strategy: "fixed",
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    expect(chunks).toEqual(["Hello world"]);
  });
});

// --------------------------------------------------------------------------
// Test: paragraph chunking splits on double newlines
// --------------------------------------------------------------------------

describe("paragraph chunking", () => {
  it("splits on double newlines", () => {
    const text = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
    const chunks = chunkText(text, {
      strategy: "paragraph",
      chunkSize: 20,
      chunkOverlap: 0,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toContain("Paragraph one.");
  });

  it("merges small paragraphs to reach chunkSize", () => {
    const text = "A.\n\nB.\n\nC.\n\nD.";
    const chunks = chunkText(text, {
      strategy: "paragraph",
      chunkSize: 100,
      chunkOverlap: 0,
    });
    // All paragraphs are small, should merge into one
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain("A.");
    expect(chunks[0]).toContain("D.");
  });
});

// --------------------------------------------------------------------------
// Test: sentence chunking splits on period+space
// --------------------------------------------------------------------------

describe("sentence chunking", () => {
  it("splits on period+space", () => {
    const text =
      "First sentence. Second sentence. Third sentence. Fourth sentence.";
    const chunks = chunkText(text, {
      strategy: "sentence",
      chunkSize: 30,
      chunkOverlap: 0,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toContain("First sentence.");
  });

  it("splits on exclamation and question marks", () => {
    const text = "Hello! How are you? I am fine. Thanks for asking!";
    const chunks = chunkText(text, {
      strategy: "sentence",
      chunkSize: 20,
      chunkOverlap: 0,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});

// --------------------------------------------------------------------------
// Test: recursive chunking falls back through strategies
// --------------------------------------------------------------------------

describe("recursive chunking", () => {
  it("falls back through strategies", () => {
    // Text with paragraphs -> should use paragraph strategy first
    const textWithParagraphs =
      "Para one is here.\n\nPara two is here.\n\nPara three is here.";
    const chunks1 = chunkText(textWithParagraphs, {
      strategy: "recursive",
      chunkSize: 30,
      chunkOverlap: 0,
    });
    expect(chunks1.length).toBeGreaterThanOrEqual(2);

    // Text without paragraphs but with sentences -> should use sentence strategy
    const textWithSentences =
      "First sentence. Second sentence. Third sentence.";
    const chunks2 = chunkText(textWithSentences, {
      strategy: "recursive",
      chunkSize: 25,
      chunkOverlap: 0,
    });
    expect(chunks2.length).toBeGreaterThanOrEqual(2);

    // Plain text -> should fall back to fixed
    const plainText = "a".repeat(500);
    const chunks3 = chunkText(plainText, {
      strategy: "recursive",
      chunkSize: 200,
      chunkOverlap: 0,
    });
    expect(chunks3.length).toBeGreaterThanOrEqual(2);
  });
});

// --------------------------------------------------------------------------
// Test: small text (< chunkSize) returns single chunk
// --------------------------------------------------------------------------

describe("small text handling", () => {
  it("returns single chunk when text is smaller than chunkSize", () => {
    const text = "Short text.";
    for (const strategy of [
      "fixed",
      "paragraph",
      "sentence",
      "recursive",
    ] as const) {
      const chunks = chunkText(text, {
        strategy,
        chunkSize: 1000,
        chunkOverlap: 200,
      });
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe("Short text.");
    }
  });
});

// --------------------------------------------------------------------------
// Test: overlap — chunks share the right amount of text
// --------------------------------------------------------------------------

describe("overlap", () => {
  it("fixed chunks share the right amount of text", () => {
    const text = "abcdefghijklmnopqrst"; // 20 chars
    const chunks = chunkText(text, {
      strategy: "fixed",
      chunkSize: 10,
      chunkOverlap: 3,
    });
    expect(chunks.length).toBeGreaterThan(1);
    // The end of chunk 0 should overlap with the beginning of chunk 1
    const chunk0End = chunks[0]?.slice(-3);
    const chunk1Start = chunks[1]?.slice(0, 3);
    expect(chunk0End).toBe(chunk1Start);
  });
});

// --------------------------------------------------------------------------
// Test: empty text returns empty array
// --------------------------------------------------------------------------

describe("empty text", () => {
  it("returns empty array for empty string", () => {
    for (const strategy of [
      "fixed",
      "paragraph",
      "sentence",
      "recursive",
    ] as const) {
      const chunks = chunkText("", {
        strategy,
        chunkSize: 1000,
        chunkOverlap: 200,
      });
      expect(chunks).toEqual([]);
    }
  });
});

// --------------------------------------------------------------------------
// Test: chunkSize=0 throws
// --------------------------------------------------------------------------

describe("invalid chunkSize", () => {
  it("throws when chunkSize is 0", () => {
    expect(() =>
      chunkText("Some text", {
        strategy: "fixed",
        chunkSize: 0,
        chunkOverlap: 0,
      }),
    ).toThrow("chunkSize must be greater than 0");
  });

  it("throws when chunkSize is negative", () => {
    expect(() =>
      chunkText("Some text", {
        strategy: "fixed",
        chunkSize: -10,
        chunkOverlap: 0,
      }),
    ).toThrow("chunkSize must be greater than 0");
  });
});

// --------------------------------------------------------------------------
// Test: content_hash is SHA-256 hex (64 chars)
// --------------------------------------------------------------------------

describe("content hashing", () => {
  it("produces SHA-256 hex string (64 chars)", async () => {
    const hash = await hashContent("Hello, world!");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces consistent hashes for same content", async () => {
    const hash1 = await hashContent("Same content");
    const hash2 = await hashContent("Same content");
    expect(hash1).toBe(hash2);
  });
});

// --------------------------------------------------------------------------
// Test: dedup — same content produces same hash
// --------------------------------------------------------------------------

describe("deduplication", () => {
  it("same content produces same hash", async () => {
    const content = "This is a test document for deduplication.";
    const hash1 = await hashContent(content);
    const hash2 = await hashContent(content);
    expect(hash1).toBe(hash2);
  });

  it("different content produces different hashes", async () => {
    const hash1 = await hashContent("Document A");
    const hash2 = await hashContent("Document B");
    expect(hash1).not.toBe(hash2);
  });
});

// --------------------------------------------------------------------------
// Test: estimateTokens
// --------------------------------------------------------------------------

describe("token estimation", () => {
  it("estimates roughly 4 chars per token", () => {
    const tokens = estimateTokens("a".repeat(100));
    expect(tokens).toBe(25);
  });

  it("rounds up for non-even lengths", () => {
    const tokens = estimateTokens("abc");
    expect(tokens).toBe(1);
  });
});
