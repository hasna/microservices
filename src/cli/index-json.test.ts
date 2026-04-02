import { describe, expect, test } from "bun:test";

function runCli(args: string[]) {
  return Bun.spawnSync(["bun", "run", "./src/cli/index.tsx", ...args], {
    cwd: process.cwd(),
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
    expect(result.stderr.toString()).toContain("Failed to remove does-not-exist");
  });

});
