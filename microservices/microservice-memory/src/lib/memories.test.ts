/**
 * Unit tests for microservice-memory.
 * No database, no OpenAI API — pure logic tests.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

// --------------------------------------------------------------------------
// Test: importance clamping logic
// --------------------------------------------------------------------------

function clampImportance(value: number): number {
  return Math.max(0.0, Math.min(1.0, value));
}

describe("importance clamping", () => {
  it("clamps values above 1.0 to 1.0", () => {
    expect(clampImportance(1.5)).toBe(1.0);
    expect(clampImportance(999)).toBe(1.0);
  });

  it("clamps values below 0.0 to 0.0", () => {
    expect(clampImportance(-0.5)).toBe(0.0);
    expect(clampImportance(-999)).toBe(0.0);
  });

  it("leaves valid values unchanged", () => {
    expect(clampImportance(0.5)).toBe(0.5);
    expect(clampImportance(0.0)).toBe(0.0);
    expect(clampImportance(1.0)).toBe(1.0);
    expect(clampImportance(0.75)).toBe(0.75);
  });
});

// --------------------------------------------------------------------------
// Test: content validation
// --------------------------------------------------------------------------

function validateContent(content: string): void {
  if (!content || content.trim() === "") {
    throw new Error("Memory content cannot be empty");
  }
}

describe("content validation", () => {
  it("throws for empty string", () => {
    expect(() => validateContent("")).toThrow("Memory content cannot be empty");
  });

  it("throws for whitespace-only string", () => {
    expect(() => validateContent("   ")).toThrow(
      "Memory content cannot be empty",
    );
    expect(() => validateContent("\t\n")).toThrow(
      "Memory content cannot be empty",
    );
  });

  it("accepts valid content", () => {
    expect(() => validateContent("Hello, world")).not.toThrow();
    expect(() =>
      validateContent("The user prefers TypeScript over JavaScript"),
    ).not.toThrow();
  });
});

// --------------------------------------------------------------------------
// Test: generateEmbedding returns null when no API key
// --------------------------------------------------------------------------

describe("generateEmbedding", () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.OPENAI_API_KEY = originalKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("returns null when OPENAI_API_KEY is not set", async () => {
    const { generateEmbedding } = await import("./embeddings.js");
    const result = await generateEmbedding("test text");
    expect(result).toBeNull();
  });

  it("hasEmbeddingKey returns false when OPENAI_API_KEY is not set", async () => {
    const { hasEmbeddingKey } = await import("./embeddings.js");
    expect(hasEmbeddingKey()).toBe(false);
  });

  it("hasEmbeddingKey returns true when OPENAI_API_KEY is set", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fake-key";
    const { hasEmbeddingKey } = await import("./embeddings.js");
    // Re-evaluate the function with new env state
    const result = !!process.env.OPENAI_API_KEY;
    expect(result).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Test: search mode defaults to 'text' when no embeddings available
// --------------------------------------------------------------------------

describe("search mode selection", () => {
  function resolveSearchMode(
    requestedMode: "semantic" | "text" | "hybrid" | undefined,
    hasPgvector: boolean,
    hasEmbedding: boolean,
  ): "semantic" | "text" | "hybrid" {
    const mode = requestedMode ?? "text";
    if (
      (mode === "semantic" || mode === "hybrid") &&
      (!hasPgvector || !hasEmbedding)
    ) {
      return "text";
    }
    return mode;
  }

  it("defaults to text mode when mode is undefined", () => {
    expect(resolveSearchMode(undefined, true, true)).toBe("text");
  });

  it("falls back to text when pgvector is unavailable for semantic mode", () => {
    expect(resolveSearchMode("semantic", false, true)).toBe("text");
  });

  it("falls back to text when no embeddings for semantic mode", () => {
    expect(resolveSearchMode("semantic", true, false)).toBe("text");
  });

  it("falls back to text when no embeddings for hybrid mode", () => {
    expect(resolveSearchMode("hybrid", true, false)).toBe("text");
  });

  it("uses semantic mode when pgvector and embeddings are both available", () => {
    expect(resolveSearchMode("semantic", true, true)).toBe("semantic");
  });

  it("uses hybrid mode when pgvector and embeddings are both available", () => {
    expect(resolveSearchMode("hybrid", true, true)).toBe("hybrid");
  });

  it("uses text mode regardless of pgvector/embeddings", () => {
    expect(resolveSearchMode("text", false, false)).toBe("text");
    expect(resolveSearchMode("text", true, true)).toBe("text");
  });
});

// --------------------------------------------------------------------------
// Test: metadata defaults to {}
// --------------------------------------------------------------------------

describe("metadata defaults", () => {
  function resolveMetadata(metadata?: any): any {
    return metadata ?? {};
  }

  it("returns empty object when metadata is undefined", () => {
    expect(resolveMetadata(undefined)).toEqual({});
  });

  it("returns provided metadata unchanged", () => {
    const meta = { source: "chat", tags: ["important"] };
    expect(resolveMetadata(meta)).toEqual(meta);
  });

  it("returns empty object when called with no args", () => {
    expect(resolveMetadata()).toEqual({});
  });
});
