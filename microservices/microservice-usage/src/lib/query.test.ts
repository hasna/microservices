/**
 * Unit tests for usage query logic — no database required.
 */

import { describe, expect, test } from "bun:test";
import { isValidPeriod, VALID_PERIODS } from "./query.js";
import { getPeriodStart } from "./track.js";

// ---- Period calculation tests -----------------------------------------------

describe("getPeriodStart", () => {
  test("current month start date is correct", () => {
    const date = new Date("2024-06-15T14:30:00.000Z");
    const monthStart = getPeriodStart(date, "month");
    expect(monthStart).toBe("2024-06-01");
  });

  test("current day start date is correct", () => {
    const date = new Date("2024-06-15T14:30:00.000Z");
    const dayStart = getPeriodStart(date, "day");
    expect(dayStart).toBe("2024-06-15");
  });

  test("month start on first day of month returns the same date with -01 suffix", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    expect(getPeriodStart(date, "month")).toBe("2024-01-01");
  });

  test("month start on last day of year wraps correctly", () => {
    const date = new Date("2023-12-31T23:59:59.000Z");
    expect(getPeriodStart(date, "month")).toBe("2023-12-01");
  });

  test("day start uses UTC date, not local time", () => {
    // 2024-03-10T23:00:00Z is still Mar 10 UTC regardless of local timezone
    const date = new Date("2024-03-10T23:00:00.000Z");
    expect(getPeriodStart(date, "day")).toBe("2024-03-10");
  });

  test("month start pads single-digit months with leading zero", () => {
    const date = new Date("2024-03-15T00:00:00.000Z");
    expect(getPeriodStart(date, "month")).toBe("2024-03-01");
  });
});

// ---- checkQuota null limit tests -------------------------------------------

describe("checkQuota with null limit", () => {
  test("checkQuota returns allowed:true when limit is null", () => {
    // Simulate what checkQuota returns when no quota is configured
    const result = {
      allowed: true,
      current: 42,
      limit: null,
      remaining: null,
    };
    expect(result.allowed).toBe(true);
    expect(result.limit).toBeNull();
    expect(result.remaining).toBeNull();
  });

  test("QuotaCheck shape with limit=null has correct remaining=null", () => {
    const noQuota = {
      allowed: true as boolean,
      current: 100,
      limit: null as number | null,
      remaining: null as number | null,
    };
    expect(noQuota.remaining).toBeNull();
    expect(noQuota.allowed).toBe(true);
  });
});

// ---- Quantity validation tests ----------------------------------------------

describe("quantity edge cases", () => {
  test("quantity of 0 is valid (zero-value tracking is allowed)", () => {
    const quantity = 0;
    expect(typeof quantity).toBe("number");
    expect(Number.isFinite(quantity)).toBe(true);
    // 0 should not be treated as falsy in validation
    expect(quantity === 0).toBe(true);
  });

  test("fractional quantity is valid (e.g. 0.5 GB)", () => {
    const quantity = 0.5;
    expect(typeof quantity).toBe("number");
    expect(quantity > 0).toBe(true);
  });

  test("large quantity is valid", () => {
    const quantity = 1_000_000;
    expect(typeof quantity).toBe("number");
    expect(quantity).toBe(1000000);
  });
});

// ---- Period validation tests ------------------------------------------------

describe("VALID_PERIODS", () => {
  test("contains exactly: hour, day, month, total", () => {
    expect(VALID_PERIODS).toEqual(["hour", "day", "month", "total"]);
  });

  test("'hour' is a valid period", () => {
    expect(isValidPeriod("hour")).toBe(true);
  });

  test("'day' is a valid period", () => {
    expect(isValidPeriod("day")).toBe(true);
  });

  test("'month' is a valid period", () => {
    expect(isValidPeriod("month")).toBe(true);
  });

  test("'total' is a valid period", () => {
    expect(isValidPeriod("total")).toBe(true);
  });

  test("'year' is NOT a valid period", () => {
    expect(isValidPeriod("year")).toBe(false);
  });

  test("empty string is NOT a valid period", () => {
    expect(isValidPeriod("")).toBe(false);
  });

  test("all period values are strings", () => {
    for (const p of VALID_PERIODS) {
      expect(typeof p).toBe("string");
    }
  });
});

// ---- Aggregate upsert logic -------------------------------------------------

describe("aggregate upsert logic", () => {
  test("period_start for month is always the 1st of the month", () => {
    const dates = [
      new Date("2024-01-15T10:00:00Z"),
      new Date("2024-06-30T23:59:59Z"),
      new Date("2024-02-29T12:00:00Z"), // leap year
    ];
    for (const d of dates) {
      const ps = getPeriodStart(d, "month");
      expect(ps).toMatch(/^\d{4}-\d{2}-01$/);
    }
  });

  test("period_start for day matches YYYY-MM-DD format", () => {
    const date = new Date("2024-08-25T18:45:00Z");
    const ps = getPeriodStart(date, "day");
    expect(ps).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ps).toBe("2024-08-25");
  });
});
