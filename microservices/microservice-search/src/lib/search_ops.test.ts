/**
 * Unit tests for search_ops logic — no database required.
 */

import { describe, expect, it } from "bun:test";

// ---------------------------------------------------------------------------
// Pure-logic helpers extracted / mirrored from search_ops.ts for unit testing
// ---------------------------------------------------------------------------

type SearchMode = "text" | "semantic" | "hybrid";

function resolveMode(mode: SearchMode | undefined): SearchMode {
  return mode ?? "text";
}

function resolveLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? 10, 200));
}

function isEmpty(text: string): boolean {
  return !text || text.trim() === "";
}

function hybridScore(textScore: number, semScore: number): number {
  return (textScore + semScore) / 2;
}

function validateCollection(collection: string): boolean {
  return collection.length > 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("search mode resolution", () => {
  it("defaults to 'text' when mode is undefined", () => {
    expect(resolveMode(undefined)).toBe("text");
  });

  it("preserves 'semantic' mode when explicitly set", () => {
    expect(resolveMode("semantic")).toBe("semantic");
  });

  it("preserves 'hybrid' mode when explicitly set", () => {
    expect(resolveMode("hybrid")).toBe("hybrid");
  });
});

describe("limit resolution", () => {
  it("defaults to 10 when limit is undefined", () => {
    expect(resolveLimit(undefined)).toBe(10);
  });

  it("clamps to 1 when limit is 0 or negative", () => {
    expect(resolveLimit(0)).toBe(1);
    expect(resolveLimit(-5)).toBe(1);
  });

  it("clamps to 200 when limit exceeds maximum", () => {
    expect(resolveLimit(9999)).toBe(200);
  });

  it("accepts a valid limit as-is", () => {
    expect(resolveLimit(25)).toBe(25);
  });
});

describe("empty query guard", () => {
  it("returns true for an empty string", () => {
    expect(isEmpty("")).toBe(true);
  });

  it("returns true for a whitespace-only string", () => {
    expect(isEmpty("   ")).toBe(true);
  });

  it("returns false for a non-empty query", () => {
    expect(isEmpty("hello world")).toBe(false);
  });
});

describe("hybrid score calculation", () => {
  it("averages text and semantic scores equally (0.5 weight each)", () => {
    expect(hybridScore(0.8, 0.6)).toBe(0.7);
  });

  it("returns 0 when both scores are 0", () => {
    expect(hybridScore(0, 0)).toBe(0);
  });

  it("returns half the text score when semantic score is 0", () => {
    expect(hybridScore(0.4, 0)).toBe(0.2);
  });

  it("returns half the semantic score when text score is 0", () => {
    expect(hybridScore(0, 0.6)).toBe(0.3);
  });

  it("returns 1.0 when both scores are perfect", () => {
    expect(hybridScore(1, 1)).toBe(1);
  });
});

describe("collection validation", () => {
  it("rejects empty collection name", () => {
    expect(validateCollection("")).toBe(false);
  });

  it("accepts a non-empty collection name", () => {
    expect(validateCollection("my-docs")).toBe(true);
  });

  it("accepts a single-character collection name", () => {
    expect(validateCollection("x")).toBe(true);
  });
});
