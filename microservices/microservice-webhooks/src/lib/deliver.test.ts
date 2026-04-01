import { describe, expect, it } from "bun:test";
import { backoffSeconds, computeSignature, matchesEvent } from "./deliver.js";

describe("computeSignature", () => {
  it("produces sha256=<64 hex chars> format", () => {
    const sig = computeSignature("my-secret", JSON.stringify({ foo: "bar" }));
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("is deterministic for same inputs", () => {
    const body = JSON.stringify({ event: "test", id: "123" });
    const sig1 = computeSignature("secret-key", body);
    const sig2 = computeSignature("secret-key", body);
    expect(sig1).toBe(sig2);
  });

  it("differs for different secrets", () => {
    const body = JSON.stringify({ foo: 1 });
    const sig1 = computeSignature("secret-a", body);
    const sig2 = computeSignature("secret-b", body);
    expect(sig1).not.toBe(sig2);
  });
});

describe("backoffSeconds", () => {
  it("attempt 1 → 30 seconds", () => {
    expect(backoffSeconds(1)).toBe(30);
  });

  it("attempt 2 → 60 seconds", () => {
    expect(backoffSeconds(2)).toBe(60);
  });

  it("attempt 3 → 120 seconds", () => {
    expect(backoffSeconds(3)).toBe(120);
  });

  it("caps at 3600 seconds", () => {
    // attempt 8 → 30 * 2^7 = 3840 → capped at 3600
    expect(backoffSeconds(8)).toBe(3600);
    expect(backoffSeconds(100)).toBe(3600);
  });
});

describe("matchesEvent", () => {
  it("empty events array matches all events (wildcard)", () => {
    expect(matchesEvent([], "user.created")).toBe(true);
    expect(matchesEvent([], "payment.succeeded")).toBe(true);
    expect(matchesEvent([], "anything")).toBe(true);
  });

  it("non-empty events array only matches listed events", () => {
    expect(matchesEvent(["user.created", "user.deleted"], "user.created")).toBe(
      true,
    );
    expect(matchesEvent(["user.created", "user.deleted"], "user.deleted")).toBe(
      true,
    );
    expect(
      matchesEvent(["user.created", "user.deleted"], "payment.succeeded"),
    ).toBe(false);
  });

  it("exact match is required (no partial matching)", () => {
    expect(matchesEvent(["user.created"], "user")).toBe(false);
    expect(matchesEvent(["user.created"], "user.created.extra")).toBe(false);
  });
});
