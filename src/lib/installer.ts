/**
 * Microservice installer — installs @hasna/microservice-* npm packages globally.
 *
 * Each microservice is an independent npm package with its own binary.
 * Install = `bun install -g @hasna/microservice-<name>`
 * Run     = `microservice-<name> <command>`
 */

import { execFileSync, execSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import {
  getMicroservice,
  MICROSERVICES,
  type MicroserviceMeta,
} from "./registry.js";

export interface InstallResult {
  microservice: string;
  success: boolean;
  error?: string;
  version?: string;
}

export interface InstallOptions {
  /** Force reinstall even if already installed */
  force?: boolean;
}

export function getBunGlobalBinDir(env: NodeJS.ProcessEnv = process.env): string {
  const bunInstall = env.BUN_INSTALL?.trim();
  if (bunInstall) {
    return join(bunInstall, "bin");
  }

  const home = env.HOME?.trim();
  if (!home) {
    throw new Error("Unable to determine Bun global bin path: HOME is not set.");
  }

  return join(home, ".bun", "bin");
}

export function resolveMicroserviceBinary(name: string): string | null {
  const meta = getMicroservice(name);
  if (!meta) return null;

  const binDir = getBunGlobalBinDir();
  const accessMode =
    process.platform === "win32" ? constants.F_OK : constants.X_OK;
  const candidates =
    process.platform === "win32"
      ? [join(binDir, `${meta.binary}.cmd`), join(binDir, `${meta.binary}.exe`)]
      : [join(binDir, meta.binary)];

  for (const candidate of candidates) {
    try {
      accessSync(candidate, accessMode);
      return candidate;
    } catch {
      // Try next candidate
    }
  }

  return null;
}

/**
 * Check if a microservice binary is available in Bun global bin.
 */
export function microserviceExists(name: string): boolean {
  return resolveMicroserviceBinary(name) !== null;
}

/**
 * Get the installed version of a microservice
 */
export function getMicroserviceVersion(name: string): string | null {
  const binaryPath = resolveMicroserviceBinary(name);
  if (!binaryPath) return null;
  try {
    const out = execFileSync(binaryPath, ["--version"], {
      encoding: "utf8",
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Install a single microservice globally via bun
 */
export function installMicroservice(
  name: string,
  options: InstallOptions = {},
): InstallResult {
  const meta = getMicroservice(name);
  if (!meta) {
    return {
      microservice: name,
      success: false,
      error: `Unknown microservice '${name}'`,
    };
  }

  if (microserviceExists(name) && !options.force) {
    const version = getMicroserviceVersion(name);
    return { microservice: name, success: true, version: version ?? undefined };
  }

  try {
    execSync(`bun install -g ${meta.package}`, { stdio: "pipe" });
    const version = getMicroserviceVersion(name);
    return { microservice: name, success: true, version: version ?? undefined };
  } catch (error) {
    return {
      microservice: name,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Install multiple microservices
 */
export function installMicroservices(
  names: string[],
  options: InstallOptions = {},
): InstallResult[] {
  return names.map((name) => installMicroservice(name, options));
}

/**
 * Get list of installed microservices (those whose binary is in PATH)
 */
export function getInstalledMicroservices(): string[] {
  return MICROSERVICES.filter((m) => microserviceExists(m.name)).map(
    (m) => m.name,
  );
}

/**
 * Remove an installed microservice
 */
export function removeMicroservice(name: string): boolean {
  const meta = getMicroservice(name);
  if (!meta) return false;
  try {
    execSync(`bun remove -g ${meta.package}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get status of a microservice
 */
export function getMicroserviceStatus(name: string): {
  name: string;
  installed: boolean;
  version: string | null;
  meta: MicroserviceMeta | undefined;
} {
  return {
    name: name.replace("microservice-", ""),
    installed: microserviceExists(name),
    version: getMicroserviceVersion(name),
    meta: getMicroservice(name),
  };
}

// Legacy compatibility exports
export interface LegacyInstallResult extends InstallResult {
  path?: string;
}
