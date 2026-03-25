import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getMicroserviceCliPath, getMicroserviceOperations, runMicroserviceCommand } from "./runner.js";

let tempDir: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "open-microservices-runner-"));
  savedEnv = {
    HASNA_MICROSERVICES_DIR: process.env["HASNA_MICROSERVICES_DIR"],
    MICROSERVICES_DIR: process.env["MICROSERVICES_DIR"],
  };
  process.env["HASNA_MICROSERVICES_DIR"] = tempDir;
  delete process.env["MICROSERVICES_DIR"];
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("getMicroserviceCliPath", () => {
  test("returns null when microservice is not installed", () => {
    const result = getMicroserviceCliPath("nonexistent");
    expect(result).toBeNull();
  });

  test("returns path to src/cli/index.ts when present", () => {
    const svcDir = join(tempDir, "microservice-myapp", "src", "cli");
    mkdirSync(svcDir, { recursive: true });
    writeFileSync(join(svcDir, "index.ts"), "// cli");

    const result = getMicroserviceCliPath("myapp");
    expect(result).toBe(join(tempDir, "microservice-myapp", "src", "cli", "index.ts"));
  });

  test("returns path to cli.ts when present", () => {
    const svcDir = join(tempDir, "microservice-myapp2");
    mkdirSync(svcDir, { recursive: true });
    writeFileSync(join(svcDir, "cli.ts"), "// cli");

    const result = getMicroserviceCliPath("myapp2");
    expect(result).toBe(join(tempDir, "microservice-myapp2", "cli.ts"));
  });

  test("accepts name with microservice- prefix", () => {
    const svcDir = join(tempDir, "microservice-myapp3", "src", "cli");
    mkdirSync(svcDir, { recursive: true });
    writeFileSync(join(svcDir, "index.ts"), "// cli");

    const result = getMicroserviceCliPath("microservice-myapp3");
    expect(result).not.toBeNull();
  });

  test("prefers src/cli/index.ts over cli.ts", () => {
    const svcDir = join(tempDir, "microservice-multi");
    const cliDir = join(svcDir, "src", "cli");
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(join(cliDir, "index.ts"), "// primary");
    writeFileSync(join(svcDir, "cli.ts"), "// secondary");

    const result = getMicroserviceCliPath("multi");
    expect(result).toBe(join(cliDir, "index.ts"));
  });
});

describe("runMicroserviceCommand", () => {
  test("returns failure when microservice not installed", async () => {
    const result = await runMicroserviceCommand("nonexistent-xyz", ["--help"]);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not found");
  });

  test("returns RunResult shape on success", async () => {
    // Create a minimal CLI that just echoes
    const svcDir = join(tempDir, "microservice-echo", "src", "cli");
    mkdirSync(svcDir, { recursive: true });
    writeFileSync(
      join(svcDir, "index.ts"),
      `console.log("hello from echo"); process.exit(0);`
    );

    const result = await runMicroserviceCommand("echo", []);
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("stderr");
    expect(result).toHaveProperty("exitCode");
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("hello from echo");
  });

  test("captures non-zero exit code as failure", async () => {
    const svcDir = join(tempDir, "microservice-failer", "src", "cli");
    mkdirSync(svcDir, { recursive: true });
    writeFileSync(
      join(svcDir, "index.ts"),
      `console.error("something went wrong"); process.exit(2);`
    );

    const result = await runMicroserviceCommand("failer", []);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(2);
  });

  test("passes args to the subprocess", async () => {
    const svcDir = join(tempDir, "microservice-echoargs", "src", "cli");
    mkdirSync(svcDir, { recursive: true });
    writeFileSync(
      join(svcDir, "index.ts"),
      `console.log(JSON.stringify(process.argv.slice(2)));`
    );

    const result = await runMicroserviceCommand("echoargs", ["foo", "bar"]);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("foo");
    expect(result.stdout).toContain("bar");
  });
});

describe("getMicroserviceOperations", () => {
  test("returns empty commands for uninstalled microservice", async () => {
    const result = await getMicroserviceOperations("nonexistent-abc");
    expect(result.commands).toEqual([]);
    expect(result.helpText).toContain("not found");
  });

  test("parses commands from help text", async () => {
    const svcDir = join(tempDir, "microservice-helpable", "src", "cli");
    mkdirSync(svcDir, { recursive: true });
    // Simulate commander-style help output
    writeFileSync(
      join(svcDir, "index.ts"),
      `console.log(\`Usage: helpable [options] [command]

Commands:
  list     List all items
  create   Create an item
  delete   Delete an item
  help     display help
\`);`
    );

    const result = await getMicroserviceOperations("helpable");
    expect(result.commands.length).toBeGreaterThan(0);
    expect(result.commands).toContain("list");
    expect(result.commands).toContain("create");
    expect(result.helpText).toContain("List all items");
  });
});
