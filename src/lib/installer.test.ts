import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getBunGlobalBinDir,
  getInstalledMicroservices,
  getMicroserviceStatus,
  microserviceExists,
  resolveMicroserviceBinary,
} from "./installer.js";
import { MICROSERVICES } from "./registry.js";

describe("Installer", () => {
  test("getInstalledMicroservices returns array", () => {
    const installed = getInstalledMicroservices();
    expect(Array.isArray(installed)).toBe(true);
    // All entries should be valid service names
    for (const name of installed) {
      expect(MICROSERVICES.some((m) => m.name === name)).toBe(true);
    }
  });

  test("getMicroserviceStatus returns correct shape for known service", () => {
    const status = getMicroserviceStatus("auth");
    expect(status.name).toBe("auth");
    expect(typeof status.installed).toBe("boolean");
    expect(status.meta).toBeDefined();
    expect(status.meta?.package).toBe("@hasna/microservice-auth");
  });

  test("getMicroserviceStatus returns unknown=false meta for nonexistent", () => {
    const status = getMicroserviceStatus("nonexistent");
    expect(status.installed).toBe(false);
    expect(status.meta).toBeUndefined();
  });

  test("microserviceExists returns boolean", () => {
    expect(typeof microserviceExists("auth")).toBe("boolean");
    expect(typeof microserviceExists("nonexistent")).toBe("boolean");
    expect(microserviceExists("nonexistent")).toBe(false);
  });

  test("all services have valid metadata", () => {
    for (const ms of MICROSERVICES) {
      const status = getMicroserviceStatus(ms.name);
      expect(status.name).toBe(ms.name);
      expect(status.meta).toBeDefined();
    }
  }, 15000);

  test("getBunGlobalBinDir prefers BUN_INSTALL/bin", () => {
    expect(
      getBunGlobalBinDir({
        BUN_INSTALL: "/tmp/custom-bun",
        HOME: "/tmp/home",
      }),
    ).toBe("/tmp/custom-bun/bin");
  });

  test("resolveMicroserviceBinary resolves executable from BUN_INSTALL", () => {
    const temp = mkdtempSync(join(tmpdir(), "open-microservices-bin-"));
    const binDir = join(temp, "bin");
    const binaryPath = join(binDir, "microservice-auth");

    mkdirSync(binDir, { recursive: true });
    writeFileSync(binaryPath, "#!/usr/bin/env bash\necho 0.0.1\n");
    chmodSync(binaryPath, 0o755);

    const previous = process.env.BUN_INSTALL;
    process.env.BUN_INSTALL = temp;
    try {
      expect(resolveMicroserviceBinary("auth")).toBe(binaryPath);
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
