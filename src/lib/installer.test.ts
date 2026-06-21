import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
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
  installMicroservice,
  microserviceExists,
  removeMicroservice,
  resolveMicroserviceBinary,
} from "./installer.js";
import { MICROSERVICES, type MicroserviceMeta } from "./registry.js";

function withEnv<T>(updates: NodeJS.ProcessEnv, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(updates)) {
    previous.set(key, process.env[key]);
    process.env[key] = updates[key];
  }

  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function withInjectedMicroservice<T>(
  name: string,
  packageName: string,
  run: () => T,
): T {
  const service: MicroserviceMeta = {
    name,
    displayName: "Shell Safe",
    description: "Injected test-only service metadata",
    category: "Infrastructure",
    package: packageName,
    binary: `microservice-${name}`,
    schemaPrefix: name,
    tags: ["test"],
    requiredEnv: [],
  };

  MICROSERVICES.push(service);

  try {
    return run();
  } finally {
    const index = MICROSERVICES.lastIndexOf(service);
    if (index !== -1) {
      MICROSERVICES.splice(index, 1);
    }
  }
}

function writeFakeBun(binDir: string): void {
  const fakeBun = join(binDir, "bun");
  writeFileSync(fakeBun, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(fakeBun, 0o755);
}

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

  test("installMicroservice does not evaluate package names through a shell", () => {
    const temp = mkdtempSync(join(tmpdir(), "open-microservices-shell-"));
    const binDir = join(temp, "bin");
    const marker = join(temp, "shell-injection-ran");

    mkdirSync(binDir, { recursive: true });
    writeFakeBun(binDir);

    try {
      withEnv(
        {
          BUN_INSTALL: temp,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
        () =>
          withInjectedMicroservice(
            "shell-safe-install",
            `@hasna/microservice-shell-safe; touch ${marker}`,
            () => {
              installMicroservice("shell-safe-install", {
                force: true,
              });

              expect(existsSync(marker)).toBe(false);
            },
          ),
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test("removeMicroservice does not evaluate package names through a shell", () => {
    const temp = mkdtempSync(join(tmpdir(), "open-microservices-shell-"));
    const binDir = join(temp, "bin");
    const marker = join(temp, "shell-injection-ran");

    mkdirSync(binDir, { recursive: true });
    writeFakeBun(binDir);

    try {
      withEnv(
        {
          BUN_INSTALL: temp,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
        () =>
          withInjectedMicroservice(
            "shell-safe-remove",
            `@hasna/microservice-shell-safe; touch ${marker}`,
            () => {
              removeMicroservice("shell-safe-remove");
              expect(existsSync(marker)).toBe(false);
            },
          ),
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
