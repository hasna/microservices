import { describe, it, expect } from "bun:test";
import { wordDiff, formatDiff, diffStats } from "./diff.js";

describe("wordDiff", () => {
  it("detects equal text", () => {
    const entries = wordDiff("hello world", "hello world");
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("equal");
  });

  it("detects additions", () => {
    const entries = wordDiff("hello world", "hello beautiful world");
    expect(entries.some((e) => e.type === "added" && e.text === "beautiful")).toBe(true);
  });

  it("detects removals", () => {
    const entries = wordDiff("hello beautiful world", "hello world");
    expect(entries.some((e) => e.type === "removed" && e.text === "beautiful")).toBe(true);
  });

  it("handles completely different text", () => {
    const entries = wordDiff("foo bar", "baz qux");
    expect(entries.some((e) => e.type === "removed")).toBe(true);
    expect(entries.some((e) => e.type === "added")).toBe(true);
  });
});

describe("formatDiff", () => {
  it("formats additions with [+ +]", () => {
    const entries = wordDiff("hello", "hello world");
    expect(formatDiff(entries)).toContain("[+world+]");
  });

  it("formats removals with [- -]", () => {
    const entries = wordDiff("hello world", "hello");
    expect(formatDiff(entries)).toContain("[-world-]");
  });
});

describe("diffStats", () => {
  it("calculates similarity", () => {
    const entries = wordDiff("hello world foo", "hello world bar");
    const stats = diffStats(entries);
    expect(stats.equal).toBe(2);
    expect(stats.similarity).toBeGreaterThanOrEqual(50);
  });

  it("100% for identical text", () => {
    const entries = wordDiff("same text", "same text");
    expect(diffStats(entries).similarity).toBe(100);
  });
});
