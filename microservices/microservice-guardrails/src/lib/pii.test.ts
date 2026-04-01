/**
 * Unit tests for PII detection and redaction — no database required.
 */

import { describe, expect, test } from "bun:test";
import { redactPII, scanPII } from "./pii.js";

describe("scanPII", () => {
  test("detects email addresses", () => {
    const matches = scanPII("Contact me at user@example.com for details");
    const emails = matches.filter((m) => m.type === "email");
    expect(emails.length).toBe(1);
    expect(emails[0]?.value).toBe("user@example.com");
  });

  test("detects US phone number with parentheses", () => {
    const matches = scanPII("Call me at (555) 123-4567 please");
    const phones = matches.filter((m) => m.type === "phone");
    expect(phones.length).toBeGreaterThanOrEqual(1);
    expect(phones.some((p) => p.value.includes("555"))).toBe(true);
  });

  test("detects international phone number", () => {
    const matches = scanPII("My number is +1-555-123-4567");
    const phones = matches.filter((m) => m.type === "phone");
    expect(phones.length).toBeGreaterThanOrEqual(1);
    expect(phones.some((p) => p.value.includes("+1"))).toBe(true);
  });

  test("detects SSN", () => {
    const matches = scanPII("My SSN is 123-45-6789");
    const ssns = matches.filter((m) => m.type === "ssn");
    expect(ssns.length).toBe(1);
    expect(ssns[0]?.value).toBe("123-45-6789");
  });

  test("detects valid Visa credit card number (Luhn check)", () => {
    const matches = scanPII("Card: 4111111111111111");
    const ccs = matches.filter((m) => m.type === "credit_card");
    expect(ccs.length).toBe(1);
    expect(ccs[0]?.value.replace(/\D/g, "")).toBe("4111111111111111");
  });

  test("detects credit card with spaces", () => {
    const matches = scanPII("Card: 4111 1111 1111 1111");
    const ccs = matches.filter((m) => m.type === "credit_card");
    expect(ccs.length).toBe(1);
  });

  test("detects credit card with dashes", () => {
    const matches = scanPII("Card: 4111-1111-1111-1111");
    const ccs = matches.filter((m) => m.type === "credit_card");
    expect(ccs.length).toBe(1);
  });

  test("rejects invalid credit card number (fails Luhn check)", () => {
    const matches = scanPII("Card: 4111111111111112");
    const ccs = matches.filter((m) => m.type === "credit_card");
    expect(ccs.length).toBe(0);
  });

  test("detects IP addresses", () => {
    const matches = scanPII("Server at 192.168.1.100");
    const ips = matches.filter((m) => m.type === "ip_address");
    expect(ips.length).toBe(1);
    expect(ips[0]?.value).toBe("192.168.1.100");
  });

  test("does NOT false-positive on normal text", () => {
    const matches = scanPII("The number 42 is the answer to everything");
    expect(matches.length).toBe(0);
  });

  test("detects multiple PII types in one string", () => {
    const matches = scanPII(
      "Email: test@example.com, SSN: 123-45-6789, IP: 10.0.0.1",
    );
    const types = [...new Set(matches.map((m) => m.type))];
    expect(types).toContain("email");
    expect(types).toContain("ssn");
    expect(types).toContain("ip_address");
  });
});

describe("redactPII", () => {
  test("replaces email with [REDACTED_EMAIL]", () => {
    const text = "Contact user@example.com for info";
    const matches = scanPII(text);
    const redacted = redactPII(text, matches);
    expect(redacted).toContain("[REDACTED_EMAIL]");
    expect(redacted).not.toContain("user@example.com");
  });

  test("replaces SSN with [REDACTED_SSN]", () => {
    const text = "SSN: 123-45-6789";
    const matches = scanPII(text);
    const redacted = redactPII(text, matches);
    expect(redacted).toContain("[REDACTED_SSN]");
    expect(redacted).not.toContain("123-45-6789");
  });

  test("replaces phone with [REDACTED_PHONE]", () => {
    const text = "Call (555) 123-4567";
    const matches = scanPII(text);
    const phones = matches.filter((m) => m.type === "phone");
    const redacted = redactPII(text, phones);
    expect(redacted).toContain("[REDACTED_PHONE]");
  });

  test("returns original text when no matches", () => {
    const text = "Hello world";
    const redacted = redactPII(text, []);
    expect(redacted).toBe("Hello world");
  });
});
