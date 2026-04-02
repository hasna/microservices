import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMicroserviceCommand } from "./runner.js";

describe("Runner", () => {
  test("returns unknown error for unknown microservice", async () => {
    const result = await runMicroserviceCommand("does-not-exist", ["status"]);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown microservice");
  });

  test("returns install hint when global binary is missing", async () => {
    const temp = mkdtempSync(join(tmpdir(), "open-microservices-runner-"));
    const previous = process.env.BUN_INSTALL;
    process.env.BUN_INSTALL = temp;

    try {
      const result = await runMicroserviceCommand("auth", ["status"]);
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not installed");
      expect(result.stderr).toContain("@hasna/microservice-auth");
    } finally {
      if (previous === undefined) {
        delete process.env.BUN_INSTALL;
      } else {
        process.env.BUN_INSTALL = previous;
      }
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
