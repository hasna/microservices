/**
 * Main guard entry points — checkInput and checkOutput.
 */

import type { Sql } from "postgres";
import { detectPromptInjection } from "./injection.js";
import { redactPII, scanPII } from "./pii.js";
import { evaluatePolicy } from "./policy.js";
import { checkToxicity } from "./toxicity.js";
import { logViolation } from "./violations.js";

export interface GuardViolation {
  type: string;
  severity: string;
  details: any;
}

export interface GuardResult {
  safe: boolean;
  sanitized: string;
  violations: GuardViolation[];
}

/**
 * Check input text: prompt injection -> PII -> toxicity -> policy.
 * Logs any violations to the database.
 */
export async function checkInput(
  sql: Sql,
  text: string,
  workspaceId?: string,
): Promise<GuardResult> {
  const violations: GuardViolation[] = [];
  let sanitized = text;

  // 1. Prompt injection detection
  const injection = detectPromptInjection(text);
  if (injection.detected) {
    violations.push({
      type: "prompt_injection",
      severity: injection.confidence >= 0.7 ? "critical" : "high",
      details: {
        patterns: injection.patterns,
        confidence: injection.confidence,
      },
    });
    await logViolation(sql, {
      workspaceId,
      type: "prompt_injection",
      direction: "input",
      contentSnippet: text.slice(0, 200),
      details: {
        patterns: injection.patterns,
        confidence: injection.confidence,
      },
      severity: injection.confidence >= 0.7 ? "critical" : "high",
    });
  }

  // 2. PII detection
  const piiMatches = scanPII(text);
  if (piiMatches.length > 0) {
    const piiTypes = [...new Set(piiMatches.map((m) => m.type))];
    violations.push({
      type: "pii_detected",
      severity: "medium",
      details: { pii_types: piiTypes, count: piiMatches.length },
    });
    await logViolation(sql, {
      workspaceId,
      type: "pii_detected",
      direction: "input",
      contentSnippet: text.slice(0, 200),
      details: { pii_types: piiTypes, count: piiMatches.length },
      severity: "medium",
    });
  }

  // 3. Toxicity check
  const toxicity = checkToxicity(text);
  if (toxicity.toxic) {
    violations.push({
      type: "toxicity",
      severity: toxicity.score >= 0.7 ? "high" : "medium",
      details: { score: toxicity.score, categories: toxicity.categories },
    });
    await logViolation(sql, {
      workspaceId,
      type: "toxicity",
      direction: "input",
      contentSnippet: text.slice(0, 200),
      details: { score: toxicity.score, categories: toxicity.categories },
      severity: toxicity.score >= 0.7 ? "high" : "medium",
    });
  }

  // 4. Policy evaluation
  if (workspaceId) {
    const policyResult = await evaluatePolicy(
      sql,
      workspaceId,
      sanitized,
      "input",
    );
    if (!policyResult.passed) {
      for (const v of policyResult.violations) {
        violations.push({
          type: "policy_violation",
          severity: v.action === "block" ? "high" : "low",
          details: {
            rule_name: v.rule_name,
            rule_type: v.rule_type,
            ...v.details,
          },
        });
        await logViolation(sql, {
          workspaceId,
          type: "policy_violation",
          direction: "input",
          contentSnippet: text.slice(0, 200),
          details: {
            rule_name: v.rule_name,
            rule_type: v.rule_type,
            ...v.details,
          },
          severity: v.action === "block" ? "high" : "low",
        });
      }
    }
    sanitized = policyResult.sanitized;
  }

  return {
    safe: violations.length === 0,
    sanitized,
    violations,
  };
}

/**
 * Check output text: PII -> toxicity -> policy (output direction).
 * Automatically redacts PII from output.
 */
export async function checkOutput(
  sql: Sql,
  text: string,
  workspaceId?: string,
): Promise<GuardResult> {
  const violations: GuardViolation[] = [];
  let sanitized = text;

  // 1. PII detection + auto-redact
  const piiMatches = scanPII(text);
  if (piiMatches.length > 0) {
    const piiTypes = [...new Set(piiMatches.map((m) => m.type))];
    violations.push({
      type: "pii_detected",
      severity: "medium",
      details: { pii_types: piiTypes, count: piiMatches.length },
    });
    sanitized = redactPII(sanitized, piiMatches);
    await logViolation(sql, {
      workspaceId,
      type: "pii_detected",
      direction: "output",
      contentSnippet: text.slice(0, 200),
      details: { pii_types: piiTypes, count: piiMatches.length },
      severity: "medium",
    });
  }

  // 2. Toxicity check
  const toxicity = checkToxicity(text);
  if (toxicity.toxic) {
    violations.push({
      type: "toxicity",
      severity: toxicity.score >= 0.7 ? "high" : "medium",
      details: { score: toxicity.score, categories: toxicity.categories },
    });
    await logViolation(sql, {
      workspaceId,
      type: "toxicity",
      direction: "output",
      contentSnippet: text.slice(0, 200),
      details: { score: toxicity.score, categories: toxicity.categories },
      severity: toxicity.score >= 0.7 ? "high" : "medium",
    });
  }

  // 3. Policy evaluation (output direction)
  if (workspaceId) {
    const policyResult = await evaluatePolicy(
      sql,
      workspaceId,
      sanitized,
      "output",
    );
    if (!policyResult.passed) {
      for (const v of policyResult.violations) {
        violations.push({
          type: "policy_violation",
          severity: v.action === "block" ? "high" : "low",
          details: {
            rule_name: v.rule_name,
            rule_type: v.rule_type,
            ...v.details,
          },
        });
        await logViolation(sql, {
          workspaceId,
          type: "policy_violation",
          direction: "output",
          contentSnippet: text.slice(0, 200),
          details: {
            rule_name: v.rule_name,
            rule_type: v.rule_type,
            ...v.details,
          },
          severity: v.action === "block" ? "high" : "low",
        });
      }
    }
    sanitized = policyResult.sanitized;
  }

  return {
    safe: violations.length === 0,
    sanitized,
    violations,
  };
}

/**
 * Streaming input guard — checks chunks as they arrive from an async generator.
 * Yields chunks (potentially sanitized) and streams violations in parallel.
 */
export async function* checkInputStream(
  sql: Sql,
  chunks: AsyncGenerator<string>,
  workspaceId?: string,
): AsyncGenerator<{ chunk: string; safe: boolean; violations: GuardViolation[] }> {
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += chunk;
    const result = await checkInput(sql, buffer, workspaceId);
    yield {
      chunk: result.sanitized,
      safe: result.safe,
      violations: result.violations,
    };
  }
}

/**
 * Streaming output guard — checks each output chunk for PII, toxicity, policy.
 * Yields sanitized chunks as they're generated.
 */
export async function* checkOutputStream(
  sql: Sql,
  chunks: AsyncGenerator<string>,
  workspaceId?: string,
): AsyncGenerator<{ chunk: string; safe: boolean; violations: GuardViolation[] }> {
  for await (const chunk of chunks) {
    const result = await checkOutput(sql, chunk, workspaceId);
    yield {
      chunk: result.sanitized,
      safe: result.safe,
      violations: result.violations,
    };
  }
}
