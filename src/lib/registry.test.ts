import { describe, test, expect } from "bun:test";
import {
  MICROSERVICES,
  CATEGORIES,
  getMicroservice,
  getMicroservicesByCategory,
  searchMicroservices,
} from "./registry";

describe("Registry", () => {
  test("has microservices", () => {
    expect(MICROSERVICES.length).toBeGreaterThan(0);
  });

  test("has categories", () => {
    expect(CATEGORIES.length).toBeGreaterThan(0);
  });

  test("getMicroservice finds by name", () => {
    const ms = getMicroservice("contacts");
    expect(ms).toBeDefined();
    expect(ms!.name).toBe("contacts");
  });

  test("getMicroservice finds with microservice- prefix", () => {
    const ms = getMicroservice("microservice-contacts");
    expect(ms).toBeDefined();
    expect(ms!.name).toBe("contacts");
  });

  test("getMicroservice returns undefined for unknown", () => {
    expect(getMicroservice("nonexistent")).toBeUndefined();
  });

  test("getMicroservicesByCategory returns correct items", () => {
    const finance = getMicroservicesByCategory("Finance");
    expect(finance.length).toBeGreaterThan(0);
    expect(finance.every((m) => m.category === "Finance")).toBe(true);
  });

  test("searchMicroservices finds by name", () => {
    const results = searchMicroservices("invoice");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((m) => m.name === "invoices")).toBe(true);
  });

  test("searchMicroservices finds by tag", () => {
    const results = searchMicroservices("billing");
    expect(results.length).toBeGreaterThan(0);
  });

  test("searchMicroservices returns empty for no match", () => {
    const results = searchMicroservices("zzzznonexistent");
    expect(results.length).toBe(0);
  });

  test("all microservices have required fields", () => {
    for (const ms of MICROSERVICES) {
      expect(ms.name).toBeTruthy();
      expect(ms.displayName).toBeTruthy();
      expect(ms.description).toBeTruthy();
      expect(ms.category).toBeTruthy();
      expect(Array.isArray(ms.tags)).toBe(true);
      expect(CATEGORIES).toContain(ms.category);
    }
  });
});
