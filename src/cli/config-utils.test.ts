import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureParentDirectory,
  parseTimeoutMs,
  upsertClaudeMcpConfig,
  upsertCodexMcpConfig,
  upsertGeminiMcpConfig,
} from "./config-utils.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const path of tempPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("config utils", () => {
  test("parseTimeoutMs accepts positive integers", () => {
    expect(parseTimeoutMs("45000")).toBe(45000);
    expect(parseTimeoutMs(undefined)).toBe(30000);
  });

  test("parseTimeoutMs rejects invalid values", () => {
    expect(() => parseTimeoutMs("0")).toThrow(
      "Timeout must be a positive integer in milliseconds.",
    );
    expect(() => parseTimeoutMs("nan")).toThrow(
      "Timeout must be a positive integer in milliseconds.",
    );
    expect(() => parseTimeoutMs("1.5")).toThrow(
      "Timeout must be a positive integer in milliseconds.",
    );
  });

  test("ensureParentDirectory creates nested directories", () => {
    const root = mkdtempSync(join(tmpdir(), "open-microservices-config-"));
    tempPaths.push(root);
    const target = join(root, ".codex", "config.toml");

    ensureParentDirectory(target);

    expect(existsSync(join(root, ".codex"))).toBe(true);
  });

  test("upsertCodexMcpConfig appends config only once", () => {
    const first = upsertCodexMcpConfig(undefined, "microservices-mcp");
    expect(first.alreadyRegistered).toBe(false);
    expect(first.content).toContain("[mcp_servers.microservices]");

    const second = upsertCodexMcpConfig(first.content, "microservices-mcp");
    expect(second.alreadyRegistered).toBe(true);
    expect(second.content).toBe(first.content);
  });

  test("upsertClaudeMcpConfig writes stdio server config", () => {
    const content = upsertClaudeMcpConfig(undefined, "microservices-mcp");
    const parsed = JSON.parse(content) as {
      mcpServers: Record<string, { command: string; type: string }>;
    };

    expect(parsed.mcpServers.microservices.command).toBe("microservices-mcp");
    expect(parsed.mcpServers.microservices.type).toBe("stdio");
  });

  test("upsertGeminiMcpConfig writes command config", () => {
    const content = upsertGeminiMcpConfig(undefined, "/tmp/microservices-mcp");
    const parsed = JSON.parse(content) as {
      mcpServers: Record<string, { command: string }>;
    };

    expect(parsed.mcpServers.microservices.command).toBe(
      "/tmp/microservices-mcp",
    );
  });
});
