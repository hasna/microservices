import { describe, expect, test } from "bun:test";
import { PG_MIGRATIONS } from "./pg-migrations.js";

describe("PG_MIGRATIONS", () => {
  test("is a non-empty array", () => {
    expect(Array.isArray(PG_MIGRATIONS)).toBe(true);
    expect(PG_MIGRATIONS.length).toBeGreaterThan(0);
  });

  test("every entry is a non-empty string", () => {
    for (const migration of PG_MIGRATIONS) {
      expect(typeof migration).toBe("string");
      expect(migration.trim().length).toBeGreaterThan(0);
    }
  });

  test("contains _migrations tracking table", () => {
    const hasMigrations = PG_MIGRATIONS.some(
      (m) => m.includes("_migrations") && m.toUpperCase().includes("CREATE TABLE")
    );
    expect(hasMigrations).toBe(true);
  });

  test("contains feedback table", () => {
    const hasFeedback = PG_MIGRATIONS.some(
      (m) => m.includes("feedback") && m.toUpperCase().includes("CREATE TABLE")
    );
    expect(hasFeedback).toBe(true);
  });

  test("feedback table has required columns", () => {
    const feedbackMigration = PG_MIGRATIONS.find(
      (m) => m.includes("feedback") && m.toUpperCase().includes("CREATE TABLE")
    );
    expect(feedbackMigration).toBeDefined();
    expect(feedbackMigration).toContain("message");
    expect(feedbackMigration).toContain("email");
    expect(feedbackMigration).toContain("category");
    expect(feedbackMigration).toContain("version");
  });

  test("has at least 2 migrations", () => {
    expect(PG_MIGRATIONS.length).toBeGreaterThanOrEqual(2);
  });

  test("all SQL statements start with a known DDL keyword", () => {
    const ddlKeywords = ["CREATE", "ALTER", "DROP", "INSERT", "UPDATE"];
    for (const migration of PG_MIGRATIONS) {
      const trimmed = migration.trim().toUpperCase();
      const startsWithDdl = ddlKeywords.some((kw) => trimmed.startsWith(kw));
      expect(startsWithDdl).toBe(true);
    }
  });
});
