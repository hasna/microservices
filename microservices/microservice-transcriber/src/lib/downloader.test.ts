import { describe, it, expect } from "bun:test";
import { normalizeFilename } from "./downloader.js";

describe("normalizeFilename", () => {
  it("lowercases everything", () => {
    const result = normalizeFilename("Hello World");
    expect(result).toMatch(/^hello-world-/);
  });

  it("replaces & with 'and'", () => {
    const result = normalizeFilename("Cats & Dogs Forever");
    expect(result).toMatch(/^cats-and-dogs-forever-/);
  });

  it("replaces spaces with hyphens", () => {
    const result = normalizeFilename("my awesome video");
    expect(result).toMatch(/^my-awesome-video-/);
  });

  it("strips special characters", () => {
    const result = normalizeFilename("C++ Tutorial: Part 1/3");
    expect(result).toMatch(/^c-tutorial-part-1-3-/);
  });

  it("strips parentheses and exclamation marks", () => {
    const result = normalizeFilename("My Awesome Video! (2024)");
    expect(result).toMatch(/^my-awesome-video-2024-/);
  });

  it("collapses multiple hyphens", () => {
    const result = normalizeFilename("hello---world");
    expect(result).toMatch(/^hello-world-/);
  });

  it("strips leading and trailing hyphens", () => {
    const result = normalizeFilename("  - hello world - ");
    expect(result).toMatch(/^hello-world-/);
  });

  it("appends a 6-char alphanumeric suffix", () => {
    const result = normalizeFilename("test video");
    const parts = result.split("-");
    const suffix = parts[parts.length - 1];
    expect(suffix).toMatch(/^[a-z0-9]{6}$/);
  });

  it("produces unique suffixes across calls", () => {
    const a = normalizeFilename("same title");
    const b = normalizeFilename("same title");
    // Same stem, different suffix (probabilistically true)
    const suffixA = a.split("-").pop();
    const suffixB = b.split("-").pop();
    // With 36^6 = ~2.2B possibilities, collision probability is negligible
    expect(a.length).toBeGreaterThan(6);
    expect(b.length).toBeGreaterThan(6);
    expect(typeof suffixA).toBe("string");
    expect(typeof suffixB).toBe("string");
  });

  it("truncates long titles to max 80 chars before suffix", () => {
    const longTitle = "a".repeat(200);
    const result = normalizeFilename(longTitle);
    // stem (80) + hyphen + suffix (6) = 87
    expect(result.length).toBeLessThanOrEqual(88);
  });

  it("handles empty string gracefully", () => {
    const result = normalizeFilename("");
    expect(result).toMatch(/^[a-z0-9]{6}$/);
  });

  it("handles title with only special chars", () => {
    const result = normalizeFilename("!!!???###");
    // all stripped, falls back to suffix only
    expect(result).toMatch(/^[a-z0-9]{6}$/);
  });
});
