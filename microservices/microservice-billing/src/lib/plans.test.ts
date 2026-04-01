import { describe, expect, it } from "bun:test";
import {
  VALID_CURRENCIES,
  VALID_INTERVALS,
  validatePlanData,
} from "./plans.js";

describe("validatePlanData", () => {
  it("should pass for a valid monthly plan", () => {
    const errors = validatePlanData({
      name: "Pro Plan",
      amount_cents: 999,
      currency: "usd",
      interval: "month",
    });
    expect(errors).toHaveLength(0);
  });

  it("should fail when amount_cents is negative", () => {
    const errors = validatePlanData({ name: "Bad Plan", amount_cents: -1 });
    expect(errors.some((e) => e.includes("amount_cents"))).toBe(true);
  });

  it("should fail when amount_cents is not an integer", () => {
    const errors = validatePlanData({ name: "Bad Plan", amount_cents: 9.99 });
    expect(errors.some((e) => e.includes("amount_cents"))).toBe(true);
  });

  it("should fail when name is empty string", () => {
    const errors = validatePlanData({ name: "", amount_cents: 100 });
    expect(errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("should fail when name is only whitespace", () => {
    const errors = validatePlanData({ name: "   ", amount_cents: 100 });
    expect(errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("should fail for an invalid currency", () => {
    const errors = validatePlanData({
      name: "Plan",
      amount_cents: 100,
      currency: "xyz",
    });
    expect(errors.some((e) => e.includes("currency"))).toBe(true);
  });

  it("should fail for an invalid interval", () => {
    const errors = validatePlanData({
      name: "Plan",
      amount_cents: 100,
      interval: "weekly" as any,
    });
    expect(errors.some((e) => e.includes("interval"))).toBe(true);
  });

  it("should pass with zero amount_cents (free plan)", () => {
    const errors = validatePlanData({ name: "Free", amount_cents: 0 });
    expect(errors).toHaveLength(0);
  });

  it("should pass for a yearly plan with valid currency", () => {
    const errors = validatePlanData({
      name: "Annual",
      amount_cents: 9900,
      currency: "eur",
      interval: "year",
    });
    expect(errors).toHaveLength(0);
  });

  it("should pass for a one_time payment plan", () => {
    const errors = validatePlanData({
      name: "Lifetime",
      amount_cents: 29900,
      interval: "one_time",
    });
    expect(errors).toHaveLength(0);
  });

  it("VALID_CURRENCIES should contain standard currencies", () => {
    expect(VALID_CURRENCIES).toContain("usd");
    expect(VALID_CURRENCIES).toContain("eur");
    expect(VALID_CURRENCIES).toContain("gbp");
  });

  it("VALID_INTERVALS should contain all three options", () => {
    expect(VALID_INTERVALS).toContain("month");
    expect(VALID_INTERVALS).toContain("year");
    expect(VALID_INTERVALS).toContain("one_time");
  });
});
