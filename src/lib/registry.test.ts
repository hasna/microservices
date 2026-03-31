import { describe, test, expect } from "bun:test";
import { MICROSERVICES, CATEGORIES, getMicroservice, getMicroservicesByCategory, searchMicroservices } from "./registry.js";

describe("Registry", () => {
  test("has 15 production microservices", () => {
    expect(MICROSERVICES.length).toBe(15);
  });

  test("has all expected service names", () => {
    const names = MICROSERVICES.map((m) => m.name);
    // Original 8
    expect(names).toContain("auth");
    expect(names).toContain("teams");
    expect(names).toContain("billing");
    expect(names).toContain("notify");
    expect(names).toContain("files");
    expect(names).toContain("audit");
    expect(names).toContain("flags");
    expect(names).toContain("jobs");
    // New 7
    expect(names).toContain("llm");
    expect(names).toContain("memory");
    expect(names).toContain("search");
    expect(names).toContain("usage");
    expect(names).toContain("webhooks");
    expect(names).toContain("onboarding");
    expect(names).toContain("waitlist");
  });

  test("has categories", () => {
    expect(CATEGORIES.length).toBeGreaterThan(0);
  });

  test("getMicroservice finds by name", () => {
    const ms = getMicroservice("auth");
    expect(ms).toBeDefined();
    expect(ms!.name).toBe("auth");
    expect(ms!.package).toBe("@hasna/microservice-auth");
  });

  test("getMicroservice finds with microservice- prefix", () => {
    const ms = getMicroservice("microservice-billing");
    expect(ms).toBeDefined();
    expect(ms!.name).toBe("billing");
  });

  test("getMicroservice returns undefined for unknown", () => {
    expect(getMicroservice("nonexistent")).toBeUndefined();
  });

  test("getMicroservicesByCategory returns correct items", () => {
    const identity = getMicroservicesByCategory("Identity");
    expect(identity.length).toBeGreaterThan(0);
    expect(identity.every((m) => m.category === "Identity")).toBe(true);
  });

  test("searchMicroservices finds auth by name", () => {
    const results = searchMicroservices("auth");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((m) => m.name === "auth")).toBe(true);
  });

  test("searchMicroservices finds by tag", () => {
    const results = searchMicroservices("stripe");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((m) => m.name === "billing")).toBe(true);
  });

  test("searchMicroservices returns empty for no match", () => {
    expect(searchMicroservices("zzzznonexistent")).toHaveLength(0);
  });

  test("all microservices have required fields", () => {
    for (const ms of MICROSERVICES) {
      expect(ms.name).toBeTruthy();
      expect(ms.displayName).toBeTruthy();
      expect(ms.description).toBeTruthy();
      expect(ms.category).toBeTruthy();
      expect(ms.package).toMatch(/^@hasna\/microservice-/);
      expect(ms.binary).toMatch(/^microservice-/);
      expect(ms.schemaPrefix).toBeTruthy();
      expect(Array.isArray(ms.tags)).toBe(true);
      expect(Array.isArray(ms.requiredEnv)).toBe(true);
      expect(CATEGORIES).toContain(ms.category);
    }
  });

  test("all DATABASE_URL in requiredEnv", () => {
    for (const ms of MICROSERVICES) {
      expect(ms.requiredEnv).toContain("DATABASE_URL");
    }
  });
});
