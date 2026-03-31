/**
 * Microservice runner — executes installed microservice binaries.
 *
 * Each microservice binary is installed globally via bun:
 *   microservice-auth migrate
 *   microservice-billing serve
 */

import { execFile } from "node:child_process";
import { getMicroservice } from "./registry.js";
import { microserviceExists } from "./installer.js";

export interface RunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a microservice CLI command
 */
export async function runMicroserviceCommand(
  name: string,
  args: string[],
  timeout: number = 30000
): Promise<RunResult> {
  const meta = getMicroservice(name);
  if (!meta) {
    return { success: false, stdout: "", stderr: `Unknown microservice '${name}'`, exitCode: 1 };
  }

  if (!microserviceExists(name)) {
    return {
      success: false,
      stdout: "",
      stderr: `microservice-${name} is not installed. Run: bun install -g ${meta.package}`,
      exitCode: 1,
    };
  }

  return new Promise((resolve) => {
    execFile(
      meta.binary,
      args,
      { timeout, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && "killed" in error && error.killed) {
          resolve({ success: false, stdout: "", stderr: "Command timed out", exitCode: 1 });
          return;
        }
        const exitCode =
          error?.code ? (typeof error.code === "number" ? error.code : 1) : 0;
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
 * Get available commands for a microservice by running --help
 */
export async function getMicroserviceOperations(name: string): Promise<{
  commands: string[];
  helpText: string;
}> {
  const result = await runMicroserviceCommand(name, ["--help"]);
  const helpText = result.stdout || result.stderr;
  if (!helpText) return { commands: [], helpText: "No help available" };

  const commands: string[] = [];
  for (const line of helpText.split("\n")) {
    const match = line.match(/^\s{2,4}(\w[\w-]*)\s/);
    if (match) commands.push(match[1]);
  }
  return { commands, helpText };
}

/** @deprecated Use runMicroserviceCommand directly */
export function getMicroserviceCliPath(_name: string): string | null {
  return null;
}
