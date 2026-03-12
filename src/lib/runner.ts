/**
 * Microservice runner - spawns individual microservice CLIs as subprocesses
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
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

  try {
    const proc = Bun.spawn(["bun", "run", cliPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        MICROSERVICES_DIR: getMicroservicesDir(),
      },
    });

    // Timeout handling
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Command timed out")), timeout);
    });

    const result = await Promise.race([proc.exited, timeoutPromise]);
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    return {
      success: result === 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: result as number,
    };
  } catch (error) {
    return {
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    };
  }
}

/**
 * Get available operations for a microservice by running --help
 */
export async function getMicroserviceOperations(name: string): Promise<{
  commands: string[];
  helpText: string;
}> {
  const result = await runMicroserviceCommand(name, ["--help"]);

  if (!result.success && !result.stdout) {
    return { commands: [], helpText: result.stderr || "No help available" };
  }

  const helpText = result.stdout || result.stderr;

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
