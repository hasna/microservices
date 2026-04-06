/**
 * Data classifier — categorizes text content by sensitivity level
 * and detects whether it contains restricted data types.
 */

import type { Sql } from "postgres";
import { scanPII } from "./pii.js";

export type SensitivityLevel = "public" | "internal" | "confidential" | "restricted";

export interface ClassificationResult {
  level: SensitivityLevel;
  score: number; // 0-1 confidence
  reasons: string[];
  detectedTypes: string[];
  requiresEncryption: boolean;
  retentionDays: number | null;
}

const SENSITIVITY_PATTERNS: Record<string, { level: SensitivityLevel; patterns: RegExp[] }> = {
  restricted: {
    level: "restricted",
    patterns: [
      /ssn/i, /social\s*security/i, /passport\s*number/i,
      /national\s*id/i, /tax\s*id/i, /driver\s*license/i,
    ],
  },
  confidential: {
    level: "confidential",
    patterns: [
      /password/i, /secret/i, /private\s*key/i, /api\s*key/i,
      /credit\s*card/i, /bank\s*account/i, /salary/i,
      /medical/i, /health\s*record/i, /diagnosis/i,
    ],
  },
  internal: {
    level: "internal",
    patterns: [
      /internal\s*only/i, /confidential/i, /proprietary/i,
      /not\s*for\s*public/i, /internal\s*use/i,
    ],
  },
};

const RETENTION_DAYS: Record<SensitivityLevel, number | null> = {
  public: 90,
  internal: 365,
  confidential: 730,
  restricted: null, // indefinite/never auto-delete
};

const ENCRYPTION_REQUIRED: Record<SensitivityLevel, boolean> = {
  public: false,
  internal: false,
  confidential: true,
  restricted: true,
};

export async function classifyContent(
  sql: Sql,
  content: string,
  workspaceId?: string,
): Promise<ClassificationResult> {
  const reasons: string[] = [];
  const detectedTypes: string[] = [];

  // Check PII first
  const piiResults = await scanPII(content);
  if (piiResults.length > 0) {
    const types = [...new Set(piiResults.map((r) => r.type))];
    detectedTypes.push(...types);
    reasons.push(`Contains ${types.length} PII type(s): ${types.join(", ")}`);
  }

  // Check sensitivity patterns
  let maxLevel: SensitivityLevel = "public";
  let score = 0.5;

  for (const [category, config] of Object.entries(SENSITIVITY_PATTERNS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(content)) {
        reasons.push(`Matched "${category}" pattern: ${pattern.source}`);
        const levelIndex = ["public", "internal", "confidential", "restricted"].indexOf(config.level);
        if (levelIndex > ["public", "internal", "confidential", "restricted"].indexOf(maxLevel)) {
          maxLevel = config.level;
        }
        score = Math.max(score, 0.8);
      }
    }
  }

  // Adjust score based on content length and context
  if (content.length > 1000) {
    score = Math.min(score + 0.1, 1);
  }

  if (detectedTypes.length > 2) {
    maxLevel = maxLevel === "public" ? "internal" : maxLevel;
    score = Math.min(score + 0.15, 1);
  }

  // Override to restricted if multiple high-risk PII types
  const highRiskPII = piiResults.filter((r) =>
    ["ssn", "credit_card", "bank_account", "password", "api_key"].includes(r.type),
  );
  if (highRiskPII.length > 0) {
    maxLevel = "restricted";
    score = 0.95;
  }

  if (reasons.length === 0) {
    reasons.push("No sensitive patterns detected");
    score = 0.3;
  }

  return {
    level: maxLevel,
    score,
    reasons,
    detectedTypes,
    requiresEncryption: ENCRYPTION_REQUIRED[maxLevel],
    retentionDays: RETENTION_DAYS[maxLevel],
  };
}

export async function classifyBatch(
  sql: Sql,
  contents: string[],
  workspaceId?: string,
): Promise<ClassificationResult[]> {
  return Promise.all(contents.map((c) => classifyContent(sql, c, workspaceId)));
}

export function sensitivityLabel(level: SensitivityLevel): string {
  const labels: Record<SensitivityLevel, string> = {
    public: "Public — no access restrictions",
    internal: "Internal — for employees only",
    confidential: "Confidential — encryption required",
    restricted: "Restricted — maximum security required",
  };
  return labels[level];
}
