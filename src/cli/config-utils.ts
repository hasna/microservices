import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function parseTimeoutMs(
  raw: string | undefined,
  fallback: number = 30000,
): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Timeout must be a positive integer in milliseconds.");
  }

  return value;
}

export function ensureParentDirectory(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function upsertClaudeMcpConfig(
  content: string | undefined,
  command: string,
): string {
  const parsed = content ? JSON.parse(content) : {};
  const config = parsed as {
    mcpServers?: Record<
      string,
      { type: string; command: string; args: string[]; env: object }
    >;
  };

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  config.mcpServers.microservices = {
    type: "stdio",
    command,
    args: [],
    env: {},
  };

  return JSON.stringify(config, null, 2);
}

function tomlBasicString(value: string): string {
  let escaped = "";

  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    switch (char) {
      case "\b":
        escaped += "\\b";
        break;
      case "\t":
        escaped += "\\t";
        break;
      case "\n":
        escaped += "\\n";
        break;
      case "\f":
        escaped += "\\f";
        break;
      case "\r":
        escaped += "\\r";
        break;
      case '"':
        escaped += '\\"';
        break;
      case "\\":
        escaped += "\\\\";
        break;
      default:
        escaped +=
          code <= 0x1f || code === 0x7f
            ? `\\u${code.toString(16).padStart(4, "0")}`
            : char;
    }
  }

  return `"${escaped}"`;
}

export function upsertCodexMcpConfig(
  content: string | undefined,
  command: string,
): { content: string; alreadyRegistered: boolean } {
  const existing = content ?? "";
  if (existing.includes("[mcp_servers.microservices]")) {
    return { content: existing, alreadyRegistered: true };
  }

  const trimmed = existing.trimEnd();
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : "";
  return {
    content: `${prefix}[mcp_servers.microservices]\ncommand = ${tomlBasicString(command)}\n`,
    alreadyRegistered: false,
  };
}

export function upsertGeminiMcpConfig(
  content: string | undefined,
  command: string,
): string {
  const parsed = content ? JSON.parse(content) : {};
  const config = parsed as {
    mcpServers?: Record<string, { command: string; args: string[] }>;
  };

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  config.mcpServers.microservices = {
    command,
    args: [],
  };

  return JSON.stringify(config, null, 2);
}
