/**
 * Microservice installer — installs @hasna/microservice-* npm packages globally.
 *
 * Each microservice is an independent npm package with its own binary.
 * Install = `bun install -g @hasna/microservice-<name>`
 * Run     = `microservice-<name> <command>`
 */

import { execSync, execFileSync } from "node:child_process";
import { getMicroservice, MICROSERVICES, type MicroserviceMeta } from "./registry.js";

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

/**
 * Check if a microservice binary is available in PATH
 */
export function microserviceExists(name: string): boolean {
  const meta = getMicroservice(name);
  if (!meta) return false;
  try {
    execSync(`which ${meta.binary}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the installed version of a microservice
 */
export function getMicroserviceVersion(name: string): string | null {
  const meta = getMicroservice(name);
  if (!meta) return null;
  try {
    const out = execFileSync(meta.binary, ["--version"], { encoding: "utf8" }).trim();
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
  options: InstallOptions = {}
): InstallResult {
  const meta = getMicroservice(name);
  if (!meta) {
    return { microservice: name, success: false, error: `Unknown microservice '${name}'` };
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
  options: InstallOptions = {}
): InstallResult[] {
  return names.map((name) => installMicroservice(name, options));
}

/**
 * Get list of installed microservices (those whose binary is in PATH)
 */
export function getInstalledMicroservices(): string[] {
  return MICROSERVICES.filter((m) => microserviceExists(m.name)).map((m) => m.name);
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
export type { InstallOptions };
export interface LegacyInstallResult extends InstallResult {
  path?: string;
}
