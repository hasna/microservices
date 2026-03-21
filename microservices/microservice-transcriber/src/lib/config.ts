/**
 * Persistent config for microservice-transcriber.
 * Stored as JSON alongside data.db in the .microservices directory.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface TranscriberConfig {
  defaultProvider: "elevenlabs" | "openai" | "deepgram";
  defaultLanguage: string;
  defaultFormat: "txt" | "srt" | "vtt" | "json";
  diarize: boolean;
  vocab: string[]; // custom vocabulary hints for transcription accuracy
  feeds: Array<{ url: string; title: string | null; lastChecked: string | null }>;
  webhook: string | null; // URL to POST when transcription completes
}

export const CONFIG_DEFAULTS: TranscriberConfig = {
  defaultProvider: "elevenlabs",
  defaultLanguage: "en",
  defaultFormat: "txt",
  diarize: false,
  vocab: [],
  feeds: [],
  webhook: null,
};

function getConfigPath(): string {
  if (process.env["MICROSERVICES_DIR"]) {
    return join(process.env["MICROSERVICES_DIR"], "microservice-transcriber", "config.json");
  }

  let dir = resolve(process.cwd());
  while (true) {
    const msDir = join(dir, ".microservices");
    if (existsSync(msDir)) return join(msDir, "microservice-transcriber", "config.json");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
  return join(home, ".microservices", "microservice-transcriber", "config.json");
}

export function getConfig(): TranscriberConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return { ...CONFIG_DEFAULTS };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return { ...CONFIG_DEFAULTS, ...raw };
  } catch {
    return { ...CONFIG_DEFAULTS };
  }
}

export function setConfig(updates: Partial<TranscriberConfig>): TranscriberConfig {
  const current = getConfig();
  const next = { ...current, ...updates };
  const path = getConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function resetConfig(): TranscriberConfig {
  const path = getConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(CONFIG_DEFAULTS, null, 2), "utf8");
  return { ...CONFIG_DEFAULTS };
}

export const CONFIG_KEYS = ["defaultProvider", "defaultLanguage", "defaultFormat", "diarize", "vocab", "webhook"] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];
