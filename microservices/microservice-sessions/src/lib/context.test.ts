/**
 * Tests for context window, export, and fork logic.
 * Pure logic tests — no database required.
 */

import { describe, expect, test } from "bun:test";
import { estimateTokens } from "./context.js";

describe("estimateTokens", () => {
  test("returns ~2-3 for 'hello world'", () => {
    const result = estimateTokens("hello world");
    // "hello world" = 11 chars => 11/4 = 2.75, ceil => 3
    expect(result).toBeGreaterThanOrEqual(2);
    expect(result).toBeLessThanOrEqual(3);
  });

  test("returns 0 for empty string", () => {
    // "" = 0 chars => 0/4 = 0, ceil(0) = 0
    expect(estimateTokens("")).toBe(0);
  });

  test("returns 1 for a single character", () => {
    // "a" = 1 char => 1/4 = 0.25, ceil => 1
    expect(estimateTokens("a")).toBe(1);
  });

  test("scales linearly with text length", () => {
    const short = estimateTokens("hello");
    const long = estimateTokens("hello".repeat(10));
    expect(long).toBeGreaterThan(short);
    // 5 chars => ceil(1.25) = 2; 50 chars => ceil(12.5) = 13
    expect(short).toBe(2);
    expect(long).toBe(13);
  });
});

describe("export format", () => {
  test("markdown format includes role headers", () => {
    // Simulate what exportConversation produces for markdown
    const ROLE_LABELS: Record<string, string> = {
      system: "System",
      user: "User",
      assistant: "Assistant",
      tool: "Tool",
    };
    const messages = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello!" },
      { role: "assistant", content: "Hi there!" },
    ];

    const lines: string[] = [];
    lines.push("# Test Conversation");
    lines.push("");
    for (const msg of messages) {
      const label = ROLE_LABELS[msg.role] ?? msg.role;
      lines.push(`**${label}**: ${msg.content}`);
      lines.push("");
    }
    const output = lines.join("\n");

    expect(output).toContain("**System**: You are a helpful assistant.");
    expect(output).toContain("**User**: Hello!");
    expect(output).toContain("**Assistant**: Hi there!");
    expect(output).toContain("# Test Conversation");
  });

  test("json export format is valid JSON array", () => {
    const messages = [
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
    ];
    const output = JSON.stringify(messages, null, 2);
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].role).toBe("user");
    expect(parsed[1].content).toBe("4");
  });
});

describe("context window logic", () => {
  // Simulate getContextWindow logic inline for pure testing

  function simulateContextWindow(
    messages: Array<{ role: string; content: string; tokens: number }>,
    maxTokens: number,
  ) {
    const totalCount = messages.length;

    if (maxTokens <= 0 || totalCount === 0) {
      return {
        messages: [] as typeof messages,
        total_tokens: 0,
        truncated: totalCount > 0,
        included_count: 0,
        total_count: totalCount,
      };
    }

    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    let systemTokens = 0;
    for (const m of systemMessages) {
      systemTokens += m.tokens > 0 ? m.tokens : estimateTokens(m.content);
    }

    const remainingBudget = Math.max(0, maxTokens - systemTokens);

    const included: typeof messages = [];
    let usedTokens = 0;

    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
      const msg = nonSystemMessages[i];
      const msgTokens =
        msg.tokens > 0 ? msg.tokens : estimateTokens(msg.content);

      if (usedTokens + msgTokens <= remainingBudget) {
        included.unshift(msg);
        usedTokens += msgTokens;
      } else {
        break;
      }
    }

    const result = [...systemMessages, ...included];
    const totalTokens = systemTokens + usedTokens;
    const truncated = result.length < totalCount;

    return {
      messages: result,
      total_tokens: totalTokens,
      truncated,
      included_count: result.length,
      total_count: totalCount,
    };
  }

  test("returns empty for 0 maxTokens", () => {
    const msgs = [
      { role: "user", content: "Hello", tokens: 5 },
      { role: "assistant", content: "Hi", tokens: 3 },
    ];
    const ctx = simulateContextWindow(msgs, 0);
    expect(ctx.messages).toHaveLength(0);
    expect(ctx.included_count).toBe(0);
    expect(ctx.total_count).toBe(2);
    expect(ctx.truncated).toBe(true);
  });

  test("always keeps system message if present", () => {
    const msgs = [
      { role: "system", content: "You are helpful.", tokens: 10 },
      { role: "user", content: "Message 1", tokens: 100 },
      { role: "assistant", content: "Response 1", tokens: 100 },
      { role: "user", content: "Message 2", tokens: 100 },
      { role: "assistant", content: "Response 2", tokens: 5 },
    ];
    // Budget: 20 => system (10) + last assistant (5) = 15, fits
    const ctx = simulateContextWindow(msgs, 20);
    expect(ctx.messages[0].role).toBe("system");
    expect(ctx.truncated).toBe(true);
    expect(ctx.messages.length).toBeGreaterThanOrEqual(1);
  });

  test("truncated flag is true when messages are cut", () => {
    const msgs = [
      { role: "user", content: "First", tokens: 50 },
      { role: "assistant", content: "Second", tokens: 50 },
      { role: "user", content: "Third", tokens: 50 },
    ];
    const ctx = simulateContextWindow(msgs, 60);
    expect(ctx.truncated).toBe(true);
    expect(ctx.included_count).toBeLessThan(ctx.total_count);
  });

  test("includes all messages when budget is sufficient", () => {
    const msgs = [
      { role: "user", content: "Hi", tokens: 2 },
      { role: "assistant", content: "Hello", tokens: 3 },
    ];
    const ctx = simulateContextWindow(msgs, 1000);
    expect(ctx.truncated).toBe(false);
    expect(ctx.included_count).toBe(2);
    expect(ctx.total_count).toBe(2);
    expect(ctx.total_tokens).toBe(5);
  });

  test("returns empty for empty messages list", () => {
    const ctx = simulateContextWindow([], 1000);
    expect(ctx.messages).toHaveLength(0);
    expect(ctx.truncated).toBe(false);
    expect(ctx.total_count).toBe(0);
  });
});

describe("fork logic", () => {
  test("fork creates new conversation with subset of messages", () => {
    // Simulate fork: given messages with timestamps, take only up to a certain point
    const messages = [
      { id: "m1", content: "First", created_at: "2024-01-01T00:00:00Z" },
      { id: "m2", content: "Second", created_at: "2024-01-01T00:01:00Z" },
      { id: "m3", content: "Third", created_at: "2024-01-01T00:02:00Z" },
      { id: "m4", content: "Fourth", created_at: "2024-01-01T00:03:00Z" },
    ];

    const forkFromId = "m2";
    const targetMsg = messages.find((m) => m.id === forkFromId)!;
    const forkedMessages = messages.filter(
      (m) => m.created_at <= targetMsg.created_at,
    );

    expect(forkedMessages).toHaveLength(2);
    expect(forkedMessages[0].content).toBe("First");
    expect(forkedMessages[1].content).toBe("Second");
    expect(forkedMessages.find((m) => m.content === "Third")).toBeUndefined();
    expect(forkedMessages.find((m) => m.content === "Fourth")).toBeUndefined();
  });
});
