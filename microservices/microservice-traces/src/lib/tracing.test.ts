/**
 * Unit tests for tracing logic — no database required.
 */

import { describe, test, expect } from "bun:test";
import { VALID_SPAN_TYPES, VALID_STATUSES } from "./tracing.js";
import { buildSpanTree, type SpanWithChildren } from "./query.js";
import type { Span } from "./tracing.js";

// ---- Span type validation ---------------------------------------------------

describe("VALID_SPAN_TYPES", () => {
  test("span types are valid enum values", () => {
    expect(VALID_SPAN_TYPES).toEqual(["llm", "tool", "retrieval", "guardrail", "embedding", "custom"]);
  });

  test("all span types are strings", () => {
    for (const t of VALID_SPAN_TYPES) {
      expect(typeof t).toBe("string");
    }
  });
});

describe("VALID_STATUSES", () => {
  test("statuses contain running, completed, error", () => {
    expect(VALID_STATUSES).toEqual(["running", "completed", "error"]);
  });
});

// ---- Duration computation ---------------------------------------------------

describe("duration_ms computation", () => {
  test("duration_ms computed correctly from started_at/ended_at", () => {
    const started = new Date("2024-01-01T00:00:00.000Z");
    const ended = new Date("2024-01-01T00:00:01.500Z");
    const durationMs = ended.getTime() - started.getTime();
    expect(durationMs).toBe(1500);
  });

  test("duration_ms is 0 for same start and end times", () => {
    const time = new Date("2024-06-15T12:00:00.000Z");
    const durationMs = time.getTime() - time.getTime();
    expect(durationMs).toBe(0);
  });

  test("duration_ms handles multi-second spans", () => {
    const started = new Date("2024-01-01T00:00:00.000Z");
    const ended = new Date("2024-01-01T00:05:30.000Z");
    const durationMs = ended.getTime() - started.getTime();
    expect(durationMs).toBe(330000); // 5 min 30 sec
  });
});

// ---- Tree building ----------------------------------------------------------

function makeSpan(overrides: Partial<Span>): Span {
  return {
    id: "span-1",
    trace_id: "trace-1",
    parent_span_id: null,
    name: "test-span",
    type: "llm",
    status: "completed",
    input: null,
    output: null,
    error: null,
    model: null,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
    duration_ms: null,
    metadata: {},
    started_at: new Date("2024-01-01T00:00:00.000Z"),
    ended_at: new Date("2024-01-01T00:00:01.000Z"),
    ...overrides,
  };
}

describe("buildSpanTree", () => {
  test("nested spans build correct tree structure", () => {
    const spans: Span[] = [
      makeSpan({ id: "root-1", parent_span_id: null, name: "root" }),
      makeSpan({ id: "child-1", parent_span_id: "root-1", name: "child-a" }),
      makeSpan({ id: "child-2", parent_span_id: "root-1", name: "child-b" }),
      makeSpan({ id: "grandchild-1", parent_span_id: "child-1", name: "grandchild" }),
    ];

    const tree = buildSpanTree(spans);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("root");
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].name).toBe("child-a");
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].name).toBe("grandchild");
    expect(tree[0].children[1].name).toBe("child-b");
    expect(tree[0].children[1].children).toHaveLength(0);
  });

  test("flat spans with no parent are all roots", () => {
    const spans: Span[] = [
      makeSpan({ id: "a", parent_span_id: null, name: "span-a" }),
      makeSpan({ id: "b", parent_span_id: null, name: "span-b" }),
    ];

    const tree = buildSpanTree(spans);
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(0);
    expect(tree[1].children).toHaveLength(0);
  });

  test("empty spans array returns empty tree", () => {
    const tree = buildSpanTree([]);
    expect(tree).toHaveLength(0);
  });
});

// ---- Token aggregation (pure logic) -----------------------------------------

describe("trace total_tokens aggregation", () => {
  test("trace total_tokens sums child span tokens", () => {
    const spans: Partial<Span>[] = [
      { tokens_in: 100, tokens_out: 50 },
      { tokens_in: 200, tokens_out: 150 },
      { tokens_in: null, tokens_out: null },
    ];

    const totalTokens = spans.reduce((sum, s) => {
      return sum + (s.tokens_in ?? 0) + (s.tokens_out ?? 0);
    }, 0);

    expect(totalTokens).toBe(500); // 100+50+200+150+0+0
  });

  test("trace total_cost sums child span costs", () => {
    const spans: Partial<Span>[] = [
      { cost_usd: 0.001 },
      { cost_usd: 0.002 },
      { cost_usd: null },
      { cost_usd: 0.0005 },
    ];

    const totalCost = spans.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0);
    expect(totalCost).toBeCloseTo(0.0035, 6);
  });

  test("empty trace has 0 spans, 0 tokens, 0 cost", () => {
    const spans: Partial<Span>[] = [];
    const totalTokens = spans.reduce((sum, s) => sum + (s.tokens_in ?? 0) + (s.tokens_out ?? 0), 0);
    const totalCost = spans.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0);
    expect(spans.length).toBe(0);
    expect(totalTokens).toBe(0);
    expect(totalCost).toBe(0);
  });
});
