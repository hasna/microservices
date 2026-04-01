import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findNearestPackageJson,
  getPackageVersion,
  readPackageVersion,
} from "./package-info.js";

describe("package info", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "open-microservices-package-info-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("findNearestPackageJson walks parent directories", () => {
    const root = join(tempDir, "repo");
    const nested = join(root, "src", "lib");
    mkdirSync(nested, { recursive: true });
    const packageJsonPath = join(root, "package.json");
    writeFileSync(packageJsonPath, JSON.stringify({ version: "1.2.3" }));

    expect(findNearestPackageJson(nested)).toBe(packageJsonPath);
  });

  test("readPackageVersion returns version from package.json", () => {
    const packageJsonPath = join(tempDir, "package.json");
    writeFileSync(packageJsonPath, JSON.stringify({ version: "9.8.7" }));

    expect(readPackageVersion(packageJsonPath)).toBe("9.8.7");
  });

  test("getPackageVersion falls back when no package.json exists", () => {
    const missingRoot = join(tempDir, "missing");
    mkdirSync(missingRoot, { recursive: true });

    expect(getPackageVersion(missingRoot)).toBe("0.0.1");
  });
});
