import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isolatedBunInstall = mkdtempSync(
  join(tmpdir(), "open-microservices-cli-"),
);
mkdirSync(join(isolatedBunInstall, "bin"), { recursive: true });

afterAll(() => {
  rmSync(isolatedBunInstall, { recursive: true, force: true });
});

function runCli(args: string[]) {
  return Bun.spawnSync(["bun", "run", "./src/cli/index.tsx", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BUN_INSTALL: isolatedBunInstall,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("CLI JSON output", () => {
  test("list --json returns paginated payload", () => {
    const result = runCli(["list", "--json"]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout.toString()) as {
      total: number;
      count: number;
      offset: number;
      limit: number | null;
      services: Array<{ name: string; installed: boolean }>;
    };
    expect(typeof parsed.total).toBe("number");
    expect(typeof parsed.count).toBe("number");
    expect(parsed.offset).toBe(0);
    expect(parsed.limit).toBe(null);
    expect(parsed.services.length).toBeGreaterThan(0);
    expect(typeof parsed.services[0]?.name).toBe("string");
    expect(typeof parsed.services[0]?.installed).toBe("boolean");
  });

  test("list --json supports category/limit/offset", () => {
    const result = runCli([
      "list",
      "--category",
      "AI",
      "--limit",
      "2",
      "--offset",
      "1",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout.toString()) as {
      category: string | null;
      limit: number | null;
      offset: number;
      services: Array<{ category: string }>;
    };
    expect(parsed.category).toBe("AI");
    expect(parsed.limit).toBe(2);
    expect(parsed.offset).toBe(1);
    expect(parsed.services.every((service) => service.category === "AI")).toBe(
      true,
    );
  });

  test("status --json returns object for named service", () => {
    const result = runCli(["status", "auth", "--json"]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout.toString()) as {
      name: string;
      installed: boolean;
      meta?: { package?: string };
    };
    expect(parsed.name).toBe("auth");
    expect(typeof parsed.installed).toBe("boolean");
    expect(parsed.meta?.package).toBe("@hasna/microservice-auth");
  });

  test("search --json returns matching results", () => {
    const result = runCli(["search", "auth", "--json"]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout.toString()) as Array<{
      name: string;
    }>;
    expect(parsed.some((entry) => entry.name === "auth")).toBe(true);
  });

  test("info --json returns full metadata", () => {
    const result = runCli(["info", "auth", "--json"]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout.toString()) as {
      name: string;
      binary: string;
      installed: boolean;
    };
    expect(parsed.name).toBe("auth");
    expect(parsed.binary).toBe("microservice-auth");
    expect(typeof parsed.installed).toBe("boolean");
  });

  test("info --json accepts full npm package names", () => {
    const result = runCli(["info", "@hasna/microservice-auth", "--json"]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout.toString()) as {
      name: string;
      package: string;
      binary: string;
    };
    expect(parsed.name).toBe("auth");
    expect(parsed.package).toBe("@hasna/microservice-auth");
    expect(parsed.binary).toBe("microservice-auth");
  });

  test("check-env --json returns summary payload", () => {
    const result = runCli(["check-env", "--json"]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout.toString()) as {
      summary: { installed: number; allOk: boolean };
      services: unknown[];
    };
    expect(typeof parsed.summary.installed).toBe("number");
    expect(typeof parsed.summary.allOk).toBe("boolean");
    expect(Array.isArray(parsed.services)).toBe(true);
  });
  test("remove without --yes fails in non-interactive mode", () => {
    const result = runCli(["remove", "auth"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Re-run with --yes");
  });

  test("remove --yes returns non-zero when target is not installed", () => {
    const result = runCli(["remove", "does-not-exist", "--yes"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "Failed to remove does-not-exist",
    );
  });

  test("install returns non-zero when any target fails", () => {
    const result = runCli(["install", "does-not-exist"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain("does-not-exist");
  });

  test("serve-all starts binaries resolved from BUN_INSTALL even when they are not on PATH", async () => {
    const temp = mkdtempSync(join(tmpdir(), "open-microservices-serve-all-"));
    const binDir = join(temp, "bin");
    const binaryPath = join(binDir, "microservice-auth");

    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      binaryPath,
      [
        "#!/usr/bin/env bash",
        'if [ "$1" = "serve" ]; then',
        '  echo "ready-from-auth"',
        "  while true; do sleep 1; done",
        "fi",
        "",
      ].join("\n"),
    );
    chmodSync(binaryPath, 0o755);

    try {
      const output = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          const proc = spawn(
            "bun",
            ["run", "./src/cli/index.tsx", "serve-all"],
            {
              cwd: process.cwd(),
              env: {
                ...process.env,
                BUN_INSTALL: temp,
                PATH: process.env.PATH ?? "",
              },
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          let stdout = "";
          let stderr = "";
          let settled = false;

          const finish = (
            callback: (output: { stdout: string; stderr: string }) => void,
          ) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            proc.kill("SIGINT");
            callback({ stdout, stderr });
          };

          const timeout = setTimeout(() => {
            finish((output) => {
              reject(
                new Error(
                  `Timed out waiting for serve-all output.\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`,
                ),
              );
            });
          }, 5000);

          proc.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
            if (stdout.includes("ready-from-auth")) {
              finish(resolve);
            }
          });
          proc.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
          });
          proc.on("error", (error) => {
            finish(() => reject(error));
          });
          proc.on("exit", (code) => {
            if (!settled) {
              finish((output) => {
                reject(
                  new Error(
                    `serve-all exited before starting fake service with code ${code}.\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`,
                  ),
                );
              });
            }
          });
        },
      );

      expect(output.stdout).toContain("ready-from-auth");
      expect(output.stderr).not.toContain("Failed to start");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
