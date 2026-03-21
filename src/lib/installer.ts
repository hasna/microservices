/**
 * Microservice installer - handles copying microservices to .microservices/
 */

import {
  existsSync,
  cpSync,
  mkdirSync,
  readdirSync,
  statSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getMicroservicesDir } from "./database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve microservices source directory - works from both source and built locations
function resolveSourceDir(): string {
  const fromBin = join(__dirname, "..", "microservices");
  if (existsSync(fromBin)) return fromBin;
  const fromSrc = join(__dirname, "..", "..", "microservices");
  if (existsSync(fromSrc)) return fromSrc;
  return fromBin;
}

const SOURCE_DIR = resolveSourceDir();

export interface InstallResult {
  microservice: string;
  success: boolean;
  error?: string;
  path?: string;
}

export interface InstallOptions {
  targetDir?: string;
  overwrite?: boolean;
}

const PRESERVED_DB_FILES = new Set(["data.db", "data.db-wal", "data.db-shm"]);

function getCliCandidates(baseDir: string): string[] {
  return [
    join(baseDir, "src", "cli", "index.ts"),
    join(baseDir, "cli.ts"),
    join(baseDir, "src", "index.ts"),
  ];
}

function hasInstalledSource(baseDir: string): boolean {
  return getCliCandidates(baseDir).some((candidate) => existsSync(candidate));
}

function clearInstalledSource(baseDir: string): void {
  if (!existsSync(baseDir)) {
    return;
  }

  for (const entry of readdirSync(baseDir)) {
    if (PRESERVED_DB_FILES.has(entry)) {
      continue;
    }
    rmSync(join(baseDir, entry), { recursive: true, force: true });
  }
}

/**
 * Get the source path for a microservice in the package
 */
export function getMicroservicePath(name: string): string {
  const msName = name.startsWith("microservice-") ? name : `microservice-${name}`;
  return join(SOURCE_DIR, msName);
}

/**
 * Check if a microservice exists in the package
 */
export function microserviceExists(name: string): boolean {
  return existsSync(getMicroservicePath(name));
}

/**
 * Install a single microservice to the target directory
 */
export function installMicroservice(
  name: string,
  options: InstallOptions = {}
): InstallResult {
  const { overwrite = false } = options;
  const targetDir = options.targetDir || getMicroservicesDir();

  // Validate name to prevent path traversal
  const cleanName = name.replace("microservice-", "");
  if (!/^[a-z0-9-]+$/.test(cleanName)) {
    return {
      microservice: cleanName,
      success: false,
      error: `Invalid microservice name '${cleanName}'`,
    };
  }

  const msName = `microservice-${cleanName}`;
  const sourcePath = getMicroservicePath(cleanName);
  const destPath = join(targetDir, msName);

  // Check if microservice exists in package
  if (!existsSync(sourcePath)) {
    return {
      microservice: cleanName,
      success: false,
      error: `Microservice '${cleanName}' not found`,
    };
  }

  // Check if already installed
  if (existsSync(destPath) && !overwrite) {
    return {
      microservice: cleanName,
      success: false,
      error: `Already installed. Use --overwrite to replace.`,
      path: destPath,
    };
  }

  try {
    // Ensure target directory exists
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    if (existsSync(destPath) && overwrite) {
      // Fellow agents: overwrite now clears old source files first so reinstalls do not keep stale code.
      clearInstalledSource(destPath);
    }

    // Copy microservice source
    cpSync(sourcePath, destPath, { recursive: true });

    return {
      microservice: cleanName,
      success: true,
      path: destPath,
    };
  } catch (error) {
    return {
      microservice: cleanName,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
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
 * Get list of installed microservices
 */
export function getInstalledMicroservices(targetDir?: string): string[] {
  const dir = targetDir || getMicroservicesDir();

  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((f: string) => {
      const fullPath = join(dir, f);
      return (
        f.startsWith("microservice-") &&
        statSync(fullPath).isDirectory() &&
        hasInstalledSource(fullPath)
      );
    })
    .map((f: string) => f.replace("microservice-", ""));
}

/**
 * Remove an installed microservice (source only, preserves data.db)
 */
export function removeMicroservice(
  name: string,
  options: { targetDir?: string; deleteData?: boolean } = {}
): boolean {
  const dir = options.targetDir || getMicroservicesDir();
  const msName = name.startsWith("microservice-") ? name : `microservice-${name}`;
  const msPath = join(dir, msName);

  if (!existsSync(msPath)) {
    return false;
  }

  if (options.deleteData) {
    rmSync(msPath, { recursive: true });
  } else {
    // Remove source files but keep data.db
    const entries = readdirSync(msPath);
    for (const entry of entries) {
      if (entry === "data.db" || entry === "data.db-wal" || entry === "data.db-shm") {
        continue;
      }
      const entryPath = join(msPath, entry);
      rmSync(entryPath, { recursive: true });
    }
  }

  return true;
}

/**
 * Get microservice status - DB size, existence, etc.
 */
export function getMicroserviceStatus(name: string): {
  name: string;
  installed: boolean;
  hasDatabase: boolean;
  dbSizeBytes: number;
  dataDir: string;
} {
  const dir = getMicroservicesDir();
  const msName = name.startsWith("microservice-") ? name : `microservice-${name}`;
  const msPath = join(dir, msName);
  const dbPath = join(msPath, "data.db");

  const installed = hasInstalledSource(msPath);
  const hasDatabase = existsSync(dbPath);
  let dbSizeBytes = 0;

  if (hasDatabase) {
    try {
      dbSizeBytes = statSync(dbPath).size;
    } catch {}
  }

  return {
    name: name.replace("microservice-", ""),
    installed,
    hasDatabase,
    dbSizeBytes,
    dataDir: msPath,
  };
}
