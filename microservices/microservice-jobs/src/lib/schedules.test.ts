import { describe, it, expect } from "bun:test";
import { shouldFire } from "./schedules.js";

describe("shouldFire — cron matching", () => {
  it("* * * * * matches any time", () => {
    expect(shouldFire("* * * * *", new Date("2024-01-15T10:30:00"))).toBe(true);
  });

  it("matches specific minute", () => {
    const d = new Date("2024-01-15T10:30:00");
    expect(shouldFire("30 * * * *", d)).toBe(true);
    expect(shouldFire("15 * * * *", d)).toBe(false);
  });

  it("matches specific hour", () => {
    const d = new Date("2024-01-15T09:00:00");
    expect(shouldFire("0 9 * * *", d)).toBe(true);
    expect(shouldFire("0 10 * * *", d)).toBe(false);
  });

  it("*/5 matches every 5 minutes", () => {
    expect(shouldFire("*/5 * * * *", new Date("2024-01-15T10:00:00"))).toBe(true);
    expect(shouldFire("*/5 * * * *", new Date("2024-01-15T10:05:00"))).toBe(true);
    expect(shouldFire("*/5 * * * *", new Date("2024-01-15T10:03:00"))).toBe(false);
  });

  it("matches day of week (Monday=1)", () => {
    const monday = new Date("2024-01-15T09:00:00"); // 2024-01-15 is a Monday
    expect(shouldFire("0 9 * * 1", monday)).toBe(true);
    expect(shouldFire("0 9 * * 2", monday)).toBe(false);
  });

  it("matches specific date", () => {
    const d = new Date("2024-01-15T00:00:00");
    expect(shouldFire("0 0 15 * *", d)).toBe(true);
    expect(shouldFire("0 0 16 * *", d)).toBe(false);
  });

  it("0 0 * * * fires at midnight only", () => {
    expect(shouldFire("0 0 * * *", new Date("2024-01-15T00:00:00"))).toBe(true);
    expect(shouldFire("0 0 * * *", new Date("2024-01-15T12:00:00"))).toBe(false);
  });
});

describe("backoff calculation", () => {
  it("exponential backoff grows correctly", () => {
    const backoff = (attempt: number) => Math.min(Math.pow(2, attempt) * 5, 3600);
    expect(backoff(1)).toBe(10);
    expect(backoff(2)).toBe(20);
    expect(backoff(3)).toBe(40);
    expect(backoff(10)).toBe(3600); // capped at 1 hour
  });
});
