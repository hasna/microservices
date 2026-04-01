import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb, getDb } from "../db/client.js";
import { migrate } from "../db/migrations.js";

describe("microservice-__name__", () => {
  const HAS_DB = Boolean(process.env.DATABASE_URL);

  beforeAll(async () => {
    // Ensure database URL is set for tests
    if (!HAS_DB) {
      console.warn("Skipping DB tests: DATABASE_URL not set");
      return;
    }
    const sql = getDb();
    await migrate(sql);
  });

  afterAll(async () => {
    if (HAS_DB) await closeDb();
  });

  test("should pass basic health check", () => {
    expect(true).toBe(true);
  });

  // Add more specific tests for your microservice logic here
  // test("should create a record", async () => { ... });
});
