/**
 * Unit tests for stats logic — no database required.
 */

import { describe, test, expect } from "bun:test";
import { computePercentile, computeErrorRate } from "./stats.js";

// ---- Percentile computation -------------------------------------------------

describe("computePercentile", () => {
  test("p50 of [100, 200, 300] is 200", () => {
    expect(computePercentile([100, 200, 300], 50)).toBe(200);
  });

  test("p95 of a 100-element array returns near the top", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => (i + 1) * 10); // 10, 20, ..., 1000
    const p95 = computePercentile(sorted, 95);
    // p95 should be between 950 and 1000
    expect(p95).toBeGreaterThanOrEqual(940);
    expect(p95).toBeLessThanOrEqual(1000);
  });

  test("p50 and p95 of single-element array returns that element", () => {
    expect(computePercentile([42], 50)).toBe(42);
    expect(computePercentile([42], 95)).toBe(42);
  });

  test("p0 returns first element", () => {
    expect(computePercentile([10, 20, 30, 40, 50], 0)).toBe(10);
  });

  test("p100 returns last element", () => {
    expect(computePercentile([10, 20, 30, 40, 50], 100)).toBe(50);
  });

  test("empty array returns 0", () => {
    expect(computePercentile([], 50)).toBe(0);
    expect(computePercentile([], 95)).toBe(0);
  });

  test("percentiles are interpolated correctly between elements", () => {
    // [100, 200] — p50 should be 150 (midpoint)
    expect(computePercentile([100, 200], 50)).toBe(150);
  });
});

// ---- Error rate computation -------------------------------------------------

describe("computeErrorRate", () => {
  test("error rate = errored / total * 100", () => {
    expect(computeErrorRate(5, 100)).toBe(5);
    expect(computeErrorRate(25, 50)).toBe(50);
    expect(computeErrorRate(1, 3)).toBeCloseTo(33.333, 2);
  });

  test("error rate is 0 when no errors", () => {
    expect(computeErrorRate(0, 100)).toBe(0);
  });

  test("error rate is 100 when all errored", () => {
    expect(computeErrorRate(10, 10)).toBe(100);
  });

  test("error rate is 0 when total is 0 (no division by zero)", () => {
    expect(computeErrorRate(0, 0)).toBe(0);
  });
});
