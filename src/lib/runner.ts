/**
 * Microservice runner - spawns individual microservice CLIs as subprocesses
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { getMicroservicesDir } from "./database.js";

export interface RunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Get the CLI entry point for an installed microservice
 */
export function getMicroserviceCliPath(name: string): string | null {
  const dir = getMicroservicesDir();
  const msName = name.startsWith("microservice-") ? name : `microservice-${name}`;

  // Check multiple possible entry points
  const candidates = [
    join(dir, msName, "src", "cli", "index.ts"),
    join(dir, msName, "cli.ts"),
    join(dir, msName, "src", "index.ts"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Run a microservice CLI command as a subprocess
 */
export async function runMicroserviceCommand(
  name: string,
  args: string[],
  timeout: number = 30000
): Promise<RunResult> {
  const cliPath = getMicroserviceCliPath(name);
  if (!cliPath) {
    return {
      success: false,
      stdout: "",
      stderr: `Microservice '${name}' CLI not found. Is it installed?`,
      exitCode: 1,
    };
  }

  return new Promise((resolve) => {
    const child = execFile(
      "bun",
      ["run", cliPath, ...args],
      {
        timeout,
        env: {
          ...process.env,
          MICROSERVICES_DIR: getMicroservicesDir(),
        },
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error && "killed" in error && error.killed) {
          resolve({
            success: false,
            stdout: "",
            stderr: "Command timed out",
            exitCode: 1,
          });
          return;
        }

        const exitCode = error?.code
          ? typeof error.code === "number"
            ? error.code
            : 1
          : 0;

        resolve({
          success: exitCode === 0,
          stdout: (stdout || "").trim(),
          stderr: (stderr || "").trim(),
          exitCode,
        });
      }
    );
  });
}

/**
 * Get available operations for a microservice by running --help
 */
export async function getMicroserviceOperations(name: string): Promise<{
  commands: string[];
  helpText: string;
}> {
  const result = await runMicroserviceCommand(name, ["--help"]);

  // Commander writes help to stdout with exit 0
  const helpText = result.stdout || result.stderr;
  if (!helpText) {
    return { commands: [], helpText: "No help available" };
  }

  // Parse commands from help text
  const commands: string[] = [];
  const lines = helpText.split("\n");
  for (const line of lines) {
    const match = line.match(/^\s{2,4}(\w[\w-]*)\s/);
    if (match) {
      commands.push(match[1]);
    }
  }

  return { commands, helpText };
}
