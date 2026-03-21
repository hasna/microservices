import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_VERSION = "0.0.1";

export function findNearestPackageJson(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

export function readPackageVersion(packageJsonPath: string): string {
  const raw = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
    version?: unknown;
  };
  return typeof raw.version === "string" && raw.version.length > 0
    ? raw.version
    : DEFAULT_VERSION;
}

export function getPackageVersion(startDir?: string): string {
  const resolvedStartDir =
    startDir ?? dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = findNearestPackageJson(resolvedStartDir);
  if (!packageJsonPath) {
    return DEFAULT_VERSION;
  }
  return readPackageVersion(packageJsonPath);
}
