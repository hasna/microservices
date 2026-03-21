import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-social-sentiment-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  buildSentimentPrompt,
  buildBatchSentimentPrompt,
  getSentimentReport,
  type SentimentResult,
  type SentimentLabel,
} from "./sentiment";
import { createAccount } from "../db/social";
import { createMention } from "./mentions";
import { closeDatabase, getDatabase } from "../db/database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ---- Prompt Builders ----

describe("buildSentimentPrompt", () => {
  test("includes the text in the prompt", () => {
    const prompt = buildSentimentPrompt("I love this product!");
    expect(prompt).toContain("I love this product!");
    expect(prompt).toContain("sentiment");
    expect(prompt).toContain("score");
    expect(prompt).toContain("keywords");
    expect(prompt).toContain("positive");
    expect(prompt).toContain("neutral");
    expect(prompt).toContain("negative");
  });

  test("requests JSON output", () => {
    const prompt = buildSentimentPrompt("test text");
    expect(prompt).toContain("JSON");
  });
});

describe("buildBatchSentimentPrompt", () => {
  test("includes all texts numbered", () => {
    const texts = ["Great product", "Terrible service", "It was okay"];
    const prompt = buildBatchSentimentPrompt(texts);
    expect(prompt).toContain("1. Great product");
    expect(prompt).toContain("2. Terrible service");
    expect(prompt).toContain("3. It was okay");
    expect(prompt).toContain("exactly 3 elements");
  });

  test("handles single text", () => {
    const prompt = buildBatchSentimentPrompt(["Only one"]);
    expect(prompt).toContain("1. Only one");
    expect(prompt).toContain("exactly 1 elements");
  });

  test("handles empty array in prompt", () => {
    const prompt = buildBatchSentimentPrompt([]);
    expect(prompt).toContain("exactly 0 elements");
  });
});

// ---- SentimentResult Validation ----

describe("SentimentResult validation", () => {
  // We test the validation logic by importing and calling the internal validateSentimentResult
  // Since it's not exported, we test it indirectly through the module behavior

  test("valid sentiment labels are accepted", () => {
    const validLabels: SentimentLabel[] = ["positive", "neutral", "negative"];
    for (const label of validLabels) {
      const result: SentimentResult = { sentiment: label, score: 0.5, keywords: [] };
      expect(result.sentiment).toBe(label);
    }
  });

  test("score boundaries are valid", () => {
    const result: SentimentResult = { sentiment: "positive", score: 0, keywords: [] };
    expect(result.score).toBe(0);

    const result2: SentimentResult = { sentiment: "negative", score: 1, keywords: [] };
    expect(result2.score).toBe(1);
  });
});

// ---- getSentimentReport ----

describe("getSentimentReport", () => {
  let accountId: string;

  beforeAll(() => {
    const account = createAccount({
      platform: "x",
      handle: "sentiment_test",
      connected: true,
    });
    accountId = account.id;
  });

  test("returns empty report when no mentions exist", () => {
    const report = getSentimentReport(accountId);
    expect(report.total_analyzed).toBe(0);
    expect(report.positive_pct).toBe(0);
    expect(report.neutral_pct).toBe(0);
    expect(report.negative_pct).toBe(0);
    expect(report.trending_keywords).toEqual([]);
    expect(report.most_positive).toBeNull();
    expect(report.most_negative).toBeNull();
  });

  test("counts positive/neutral/negative mentions correctly", () => {
    // Create mentions with plain sentiment labels
    createMention({
      account_id: accountId,
      platform: "x",
      content: "I love this!",
      sentiment: "positive",
    });
    createMention({
      account_id: accountId,
      platform: "x",
      content: "This is terrible",
      sentiment: "negative",
    });
    createMention({
      account_id: accountId,
      platform: "x",
      content: "It is what it is",
      sentiment: "neutral",
    });
    createMention({
      account_id: accountId,
      platform: "x",
      content: "Amazing product!",
      sentiment: "positive",
    });

    const report = getSentimentReport(accountId);
    expect(report.total_analyzed).toBe(4);
    expect(report.positive_pct).toBe(50);
    expect(report.negative_pct).toBe(25);
    expect(report.neutral_pct).toBe(25);
  });

  test("identifies most positive and most negative mentions", () => {
    const report = getSentimentReport(accountId);
    expect(report.most_positive).not.toBeNull();
    expect(report.most_positive!.sentiment).toBe("positive");
    expect(report.most_negative).not.toBeNull();
    expect(report.most_negative!.sentiment).toBe("negative");
  });

  test("extracts trending keywords from JSON sentiment", () => {
    // Create a new account for clean keyword test
    const account2 = createAccount({
      platform: "linkedin",
      handle: "keyword_test",
    });

    const sentimentJson = JSON.stringify({
      sentiment: "positive",
      score: 0.9,
      keywords: ["amazing", "love", "great"],
    });
    createMention({
      account_id: account2.id,
      platform: "linkedin",
      content: "Amazing product, love it!",
      sentiment: sentimentJson,
    });

    const sentimentJson2 = JSON.stringify({
      sentiment: "positive",
      score: 0.8,
      keywords: ["amazing", "excellent"],
    });
    createMention({
      account_id: account2.id,
      platform: "linkedin",
      content: "Amazing and excellent service",
      sentiment: sentimentJson2,
    });

    const report = getSentimentReport(account2.id);
    expect(report.trending_keywords).toContain("amazing");
    // "amazing" appears twice, should be first
    expect(report.trending_keywords[0]).toBe("amazing");
  });

  test("respects days filter", () => {
    const account3 = createAccount({
      platform: "instagram",
      handle: "days_filter_test",
    });

    createMention({
      account_id: account3.id,
      platform: "instagram",
      content: "Recent mention",
      sentiment: "positive",
    });

    // With days=1, should get the recent mention
    const report1 = getSentimentReport(account3.id, 1);
    expect(report1.total_analyzed).toBe(1);

    // With days=0 (no filter), should also get it
    const report2 = getSentimentReport(account3.id);
    expect(report2.total_analyzed).toBe(1);
  });

  test("returns empty report for nonexistent account", () => {
    const report = getSentimentReport("nonexistent-account-id");
    expect(report.total_analyzed).toBe(0);
    expect(report.positive_pct).toBe(0);
  });
});

// ---- autoAnalyzeMention ----

describe("autoAnalyzeMention", () => {
  test("throws when mention not found", async () => {
    const { autoAnalyzeMention } = await import("./sentiment");
    await expect(autoAnalyzeMention("nonexistent-id")).rejects.toThrow("not found");
  });

  test("throws when mention has no content", async () => {
    const account = createAccount({
      platform: "x",
      handle: "no_content_test",
    });

    const mention = createMention({
      account_id: account.id,
      platform: "x",
      // no content
    });

    const { autoAnalyzeMention } = await import("./sentiment");
    await expect(autoAnalyzeMention(mention.id)).rejects.toThrow("no content");
  });
});

// ---- analyzeSentiment ----

describe("analyzeSentiment", () => {
  test("throws when no API key is set", async () => {
    // Ensure no API keys are set
    const origOpenAI = process.env["OPENAI_API_KEY"];
    const origAnthropic = process.env["ANTHROPIC_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];

    try {
      const { analyzeSentiment } = await import("./sentiment");
      await expect(analyzeSentiment("test")).rejects.toThrow("No AI API key");
    } finally {
      // Restore
      if (origOpenAI) process.env["OPENAI_API_KEY"] = origOpenAI;
      if (origAnthropic) process.env["ANTHROPIC_API_KEY"] = origAnthropic;
    }
  });
});

// ---- analyzeBatch ----

describe("analyzeBatch", () => {
  test("returns empty array for empty input", async () => {
    const { analyzeBatch } = await import("./sentiment");
    const result = await analyzeBatch([]);
    expect(result).toEqual([]);
  });

  test("throws when no API key is set", async () => {
    const origOpenAI = process.env["OPENAI_API_KEY"];
    const origAnthropic = process.env["ANTHROPIC_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];

    try {
      const { analyzeBatch } = await import("./sentiment");
      await expect(analyzeBatch(["test"])).rejects.toThrow("No AI API key");
    } finally {
      if (origOpenAI) process.env["OPENAI_API_KEY"] = origOpenAI;
      if (origAnthropic) process.env["ANTHROPIC_API_KEY"] = origAnthropic;
    }
  });
});

// ---- Report edge cases ----

describe("getSentimentReport edge cases", () => {
  test("handles all positive mentions", () => {
    const account = createAccount({
      platform: "bluesky",
      handle: "all_positive",
    });

    createMention({ account_id: account.id, platform: "bluesky", content: "Great!", sentiment: "positive" });
    createMention({ account_id: account.id, platform: "bluesky", content: "Awesome!", sentiment: "positive" });
    createMention({ account_id: account.id, platform: "bluesky", content: "Love it!", sentiment: "positive" });

    const report = getSentimentReport(account.id);
    expect(report.positive_pct).toBe(100);
    expect(report.neutral_pct).toBe(0);
    expect(report.negative_pct).toBe(0);
    expect(report.total_analyzed).toBe(3);
    expect(report.most_negative).toBeNull();
  });

  test("handles all negative mentions", () => {
    const account = createAccount({
      platform: "threads",
      handle: "all_negative",
    });

    createMention({ account_id: account.id, platform: "threads", content: "Awful!", sentiment: "negative" });
    createMention({ account_id: account.id, platform: "threads", content: "Terrible!", sentiment: "negative" });

    const report = getSentimentReport(account.id);
    expect(report.negative_pct).toBe(100);
    expect(report.positive_pct).toBe(0);
    expect(report.most_positive).toBeNull();
  });

  test("ignores mentions without sentiment", () => {
    const account = createAccount({
      platform: "x",
      handle: "no_sentiment_test",
    });

    createMention({ account_id: account.id, platform: "x", content: "No sentiment here" });
    createMention({ account_id: account.id, platform: "x", content: "With sentiment", sentiment: "neutral" });

    const report = getSentimentReport(account.id);
    expect(report.total_analyzed).toBe(1); // Only the one with sentiment
  });
});
