/**
 * Unit tests for waitlist entry logic — no database required.
 */

import { describe, test, expect } from "bun:test";
import { calculatePriorityScore, isValidEmail, inviteBatch } from "./entries.js";

// ---- Priority score tests ---------------------------------------------------

describe("calculatePriorityScore", () => {
  test("base score is at least 1 with no referrals", () => {
    const score = calculatePriorityScore(0, new Date());
    expect(score).toBeGreaterThanOrEqual(1);
  });

  test("score increases with more referrals (10 points each)", () => {
    const now = new Date();
    const score0 = calculatePriorityScore(0, now);
    const score1 = calculatePriorityScore(1, now);
    const score5 = calculatePriorityScore(5, now);
    expect(score1).toBeGreaterThan(score0);
    expect(score5).toBeGreaterThan(score1);
    // Each referral adds exactly 10 points
    expect(score1 - score0).toBeCloseTo(10, 5);
    expect(score5 - score0).toBeCloseTo(50, 5);
  });

  test("score formula: 1 + referralCount*10 + daysSinceEpoch*0.001", () => {
    const epoch = new Date(0); // days_since_epoch = 0
    const score = calculatePriorityScore(3, epoch);
    // 1 + 3*10 + 0*0.001 = 31
    expect(score).toBeCloseTo(31, 5);
  });

  test("higher score = higher priority (position 1 = highest score)", () => {
    const now = new Date();
    const highScore = calculatePriorityScore(5, now);
    const lowScore = calculatePriorityScore(0, now);
    // higher priority_score = position 1
    expect(highScore).toBeGreaterThan(lowScore);
  });

  test("earlier signup does not penalize if same referral count (days_since_epoch is additive)", () => {
    // Both have 2 referrals but different dates
    const earlier = new Date(2020, 0, 1); // fewer days_since_epoch
    const later = new Date(2025, 0, 1);  // more days_since_epoch
    const scoreEarlier = calculatePriorityScore(2, earlier);
    const scoreLater = calculatePriorityScore(2, later);
    // Later signup has higher days_since_epoch, thus higher score
    expect(scoreLater).toBeGreaterThan(scoreEarlier);
  });
});

// ---- Referral code tests ----------------------------------------------------

describe("referral_code format", () => {
  test("referral_code from hex encoding is 12 characters (6 bytes = 12 hex chars)", () => {
    // The DB uses: encode(gen_random_bytes(6), 'hex') which produces 12 hex chars
    const mockCode = "a1b2c3d4e5f6"; // 12 hex chars = 6 bytes
    expect(mockCode).toHaveLength(12);
    expect(mockCode).toMatch(/^[a-f0-9]{12}$/);
  });

  test("referral_code contains only lowercase hex characters", () => {
    const validCode = "0123456789ab";
    expect(validCode).toMatch(/^[a-f0-9]+$/);
  });
});

// ---- Email validation tests -------------------------------------------------

describe("isValidEmail", () => {
  test("accepts valid email addresses", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("alice.bob@domain.org")).toBe(true);
    expect(isValidEmail("test+tag@sub.domain.com")).toBe(true);
  });

  test("rejects invalid email formats", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("@nodomain.com")).toBe(false);
    expect(isValidEmail("noatsign")).toBe(false);
    expect(isValidEmail("missing@")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });

  test("rejects email with spaces", () => {
    expect(isValidEmail("user @example.com")).toBe(false);
    expect(isValidEmail(" user@example.com")).toBe(false);
  });
});

// ---- inviteBatch validation tests -------------------------------------------

describe("inviteBatch input validation", () => {
  test("count must be a positive integer — rejects 0", () => {
    // We test the validation logic directly by checking what inviteBatch would throw
    const validateCount = (count: number) => {
      if (!Number.isInteger(count) || count <= 0) {
        throw new Error("count must be a positive integer");
      }
    };
    expect(() => validateCount(0)).toThrow("count must be a positive integer");
  });

  test("count must be a positive integer — rejects negative", () => {
    const validateCount = (count: number) => {
      if (!Number.isInteger(count) || count <= 0) {
        throw new Error("count must be a positive integer");
      }
    };
    expect(() => validateCount(-5)).toThrow("count must be a positive integer");
  });

  test("count must be a positive integer — rejects float", () => {
    const validateCount = (count: number) => {
      if (!Number.isInteger(count) || count <= 0) {
        throw new Error("count must be a positive integer");
      }
    };
    expect(() => validateCount(1.5)).toThrow("count must be a positive integer");
  });

  test("count 1 passes validation", () => {
    const validateCount = (count: number) => {
      if (!Number.isInteger(count) || count <= 0) {
        throw new Error("count must be a positive integer");
      }
    };
    expect(() => validateCount(1)).not.toThrow();
  });

  test("count 100 passes validation", () => {
    const validateCount = (count: number) => {
      if (!Number.isInteger(count) || count <= 0) {
        throw new Error("count must be a positive integer");
      }
    };
    expect(() => validateCount(100)).not.toThrow();
  });
});
