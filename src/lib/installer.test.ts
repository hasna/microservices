import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getInstalledMicroservices,
  getMicroserviceStatus,
  installMicroservice,
  removeMicroservice,
} from "./installer.js";

describe("Installer", () => {
  let tempDir: string;
  let previousMicroservicesDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "open-microservices-installer-"));
    previousMicroservicesDir = process.env["MICROSERVICES_DIR"];
    process.env["MICROSERVICES_DIR"] = tempDir;
  });

  afterEach(() => {
    if (previousMicroservicesDir === undefined) {
      delete process.env["MICROSERVICES_DIR"];
    } else {
      process.env["MICROSERVICES_DIR"] = previousMicroservicesDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("overwrite install removes stale source files but preserves the database", () => {
    const firstInstall = installMicroservice("contacts", { targetDir: tempDir });
    expect(firstInstall.success).toBe(true);

    const installDir = join(tempDir, "microservice-contacts");
    const stalePath = join(installDir, "stale.txt");
    const dbPath = join(installDir, "data.db");

    mkdirSync(join(installDir, "src", "obsolete"), { recursive: true });
    writeFileSync(stalePath, "stale");
    writeFileSync(join(installDir, "src", "obsolete", "old.ts"), "old");
    writeFileSync(dbPath, "db");

    const overwritten = installMicroservice("contacts", {
      targetDir: tempDir,
      overwrite: true,
    });

    expect(overwritten.success).toBe(true);
    expect(existsSync(stalePath)).toBe(false);
    expect(existsSync(join(installDir, "src", "obsolete", "old.ts"))).toBe(false);
    expect(existsSync(dbPath)).toBe(true);
    expect(existsSync(join(installDir, "src", "cli", "index.ts"))).toBe(true);
  });

  test("removed microservice with preserved database is not reported as installed", () => {
    const installed = installMicroservice("contacts", { targetDir: tempDir });
    expect(installed.success).toBe(true);

    const dbPath = join(tempDir, "microservice-contacts", "data.db");
    writeFileSync(dbPath, "db");

    const removed = removeMicroservice("contacts", { targetDir: tempDir });
    expect(removed).toBe(true);

    expect(getInstalledMicroservices(tempDir)).not.toContain("contacts");

    const status = getMicroserviceStatus("contacts");
    expect(status.installed).toBe(false);
    expect(status.hasDatabase).toBe(true);
    expect(status.dataDir).toBe(join(tempDir, "microservice-contacts"));
  });
});
