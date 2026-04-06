/**
 * Custom rule DSL evaluator.
 *
 * guard_rules table stores user-defined rules with a simple DSL pattern.
 *
 * DSL functions available in rule patterns:
 *   contains(pii.email)           — text contains an email address
 *   contains(pii.phone)           — text contains a phone number
 *   contains(pii.ssn)             — text contains an SSN
 *   contains(pii.credit_card)     — text contains a credit card number
 *   contains(pii.ip_address)      — text contains an IPv4/IPv6 address
 *   contains(pii.date_of_birth)   — text contains a date of birth
 *   contains(pii.license_plate)   — text contains a license plate
 *   contains(pii.medical_license) — text contains a medical license (NPI)
 *   contains_any(pii.email, pii.phone, ...)  — text contains any of these PII types
 *   regex_match("pattern")         — text matches a regex pattern
 *   pattern_match("pattern", "flags") — regex with explicit flags (g,i,m,s)
 *   word_count() > N              — word count comparison
 *   contains_word("word")          — text contains exact word (case-insensitive)
 *   contains_phrase("phrase")      — text contains phrase
 *   length() > N                  — character length comparison
 *   starts_with("prefix")          — text starts with prefix (exact)
 *   ends_with("suffix")            — text ends with suffix (exact)
 *   contains_prefix("prefix")      — text starts with prefix
 *   contains_suffix("suffix")      — text ends with suffix
 *   levenshtein_distance("a","b") < N — edit distance comparison
 *   similarity_score("text") > N   — Jaccard word similarity 0-1
 *   entity_count(pii.XXX) > N      — count of a specific PII type
 *
 * Severity levels: low, medium, high, critical
 * Actions: block (stop and throw), redact (replace with placeholder),
 *          warn (flag but continue), log (record only)
 */

import type { Sql } from "postgres";
import { scanPII } from "./pii.js";

// ---- Types ------------------------------------------------------------------

export interface GuardRule {
  id: string;
  name: string;
  pattern: string; // DSL pattern expression
  severity: "low" | "medium" | "high" | "critical";
  action: "block" | "redact" | "warn" | "log";
  enabled: boolean;
  priority: number; // Lower = evaluated first
  created_at: Date;
}

export interface DSLResult {
  matched: boolean;
  details: {
    rule_name?: string;
    matched_expression?: string;
    matched_value?: string;
    position?: { start: number; end: number };
  };
  sanitized?: string; // If action is redact, contains sanitized text
}

// ---- DSL Evaluator ----------------------------------------------------------

/**
 * Evaluate a DSL rule pattern against text.
 * Returns { matched: boolean, details: {...}, sanitized?: string }
 */
export function evaluateDSLRule(
  rule: { name: string; pattern: string; action: string },
  text: string,
): DSLResult {
  const expression = rule.pattern.trim();

  try {
    const matched = evalDSLExpression(expression, text);

    if (!matched.matched) {
      return { matched: false, details: {} };
    }

    let sanitized: string | undefined;
    if (rule.action === "redact" && matched.value) {
      sanitized = text.replace(
        matched.value,
        `[${rule.name.toUpperCase()}_REDACTED]`,
      );
    }

    return {
      matched: true,
      details: {
        rule_name: rule.name,
        matched_expression: expression,
        matched_value: matched.value,
        position: matched.position,
      },
      sanitized,
    };
  } catch (err) {
    // DSL evaluation error — treat as no match but log
    return {
      matched: false,
      details: { rule_name: rule.name, matched_expression: expression },
    };
  }
}

interface MatchResult {
  matched: boolean;
  value?: string;
  position?: { start: number; end: number };
}

function evalDSLExpression(expr: string, text: string): MatchResult {
  // ---- contains_any(pii.email, pii.phone, ...) --------------------------------
  const containsAnyMatch = expr.match(/^contains_any\(\s*(pii\.\w+(?:\s*,\s*pii\.\w+)*)\s*\)$/);
  if (containsAnyMatch) {
    const typesStr = containsAnyMatch[1]!;
    const piiTypes = typesStr.split(",").map((t) => t.trim());
    const piiDetectors: Record<string, RegExp> = {
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      phone: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
      ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
      credit_card: /\b(?:\d[ -]?){13,19}\b/g,
      ip_address: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b|\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){7}\b|\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6}::[0-9a-fA-F]{1,4}\b/g,
      date_of_birth: /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b|\b(?:19|20)\d{2}[-\/](?:0[1-9]|1[0-2])[-\/](?:0[1-9]|[12]\d|3[01])\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:0[1-9]|[12]\d|3[01]),?\s+(?:19|20)\d{2}\b/gi,
      license_plate: /\b[A-Z]{1,3}[-\s]?[0-9]{1,4}[-\s]?[A-Z]{0,3}\b|\b[0-9]{1,4}[-\s]?[A-Z]{1,3}[-\s]?[A-Z]{0,3}\b|\b[A-Z]{2}[-\s]?[0-9]{1,2}[-\s]?[A-Z]{1,3}\b|\b[A-Z]{2}[0-9]{3,4}[A-Z]{2}\b/g,
      medical_license: /\b[1-9]\d{9}\b/g,
    };

    for (const piiType of piiTypes) {
      const type = piiType.replace("pii.", "");
      const re = piiDetectors[type];
      if (!re) continue;
      const matches = text.match(re);
      if (matches && matches.length > 0) {
        const idx = text.indexOf(matches[0]!);
        return { matched: true, value: matches[0], position: { start: idx, end: idx + matches[0].length } };
      }
    }
    return { matched: false };
  }

  // ---- starts_with("prefix") -----------------------------------------------
  const startsWithMatch = expr.match(/^starts_with\(\s*"([^"]+)"\s*\)$/);
  if (startsWithMatch) {
    const prefix = startsWithMatch[1]!;
    const idx = text.indexOf(prefix);
    if (idx !== 0) return { matched: false };
    return { matched: true, value: prefix, position: { start: 0, end: prefix.length } };
  }

  // ---- ends_with("suffix") --------------------------------------------------
  const endsWithMatch = expr.match(/^ends_with\(\s*"([^"]+)"\s*\)$/);
  if (endsWithMatch) {
    const suffix = endsWithMatch[1]!;
    const idx = text.lastIndexOf(suffix);
    if (idx !== text.length - suffix.length) return { matched: false };
    return { matched: true, value: suffix, position: { start: idx, end: text.length } };
  }

  // ---- contains_prefix("prefix") -----------------------------------------
  // Like starts_with but matches anywhere in text (prefix anywhere)
  const containsPrefixMatch = expr.match(/^contains_prefix\(\s*"([^"]+)"\s*\)$/);
  if (containsPrefixMatch) {
    const prefix = containsPrefixMatch[1]!;
    if (!text.startsWith(prefix)) return { matched: false };
    return { matched: true, value: prefix, position: { start: 0, end: prefix.length } };
  }

  // ---- contains_suffix("suffix") -----------------------------------------
  const containsSuffixMatch = expr.match(/^contains_suffix\(\s*"([^"]+)"\s*\)$/);
  if (containsSuffixMatch) {
    const suffix = containsSuffixMatch[1]!;
    if (!text.endsWith(suffix)) return { matched: false };
    return { matched: true, value: suffix, position: { start: text.length - suffix.length, end: text.length } };
  }

  // ---- levenshtein_distance("a", "b") < N ---------------------------------
  const levenshteinMatch = expr.match(/^levenshtein_distance\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)\s*([><=!]+)\s*(\d+)$/);
  if (levenshteinMatch) {
    const a = levenshteinMatch[1]!;
    const b = levenshteinMatch[2]!;
    const op = levenshteinMatch[3]!;
    const threshold = parseInt(levenshteinMatch[4]!, 10);
    const distance = levenshtein(a, b);
    let matched = false;
    switch (op) {
      case ">": matched = distance > threshold; break;
      case ">=": matched = distance >= threshold; break;
      case "<": matched = distance < threshold; break;
      case "<=": matched = distance <= threshold; break;
      case "==": matched = distance === threshold; break;
      case "!=": matched = distance !== threshold; break;
    }
    return { matched, value: String(distance) };
  }

  // ---- similarity_score("reference text") > N ------------------------------
  // Jaccard similarity between query words and reference text words
  const similarityMatch = expr.match(/^similarity_score\(\s*"([^"]+)"\s*\)\s*([><=!]+)\s*(\d+(?:\.\d+)?)$/);
  if (similarityMatch) {
    const reference = similarityMatch[1]!;
    const op = similarityMatch[2]!;
    const threshold = parseFloat(similarityMatch[3]!);
    const refWords = new Set(reference.toLowerCase().split(/\s+/).filter(Boolean));
    const textWords = new Set(text.toLowerCase().split(/\s+/).filter(Boolean));
    const intersection = [...refWords].filter((w) => textWords.has(w)).length;
    const union = new Set([...refWords, ...textWords]).size;
    const score = union > 0 ? intersection / union : 0;
    let matched = false;
    switch (op) {
      case ">": matched = score > threshold; break;
      case ">=": matched = score >= threshold; break;
      case "<": matched = score < threshold; break;
      case "<=": matched = score <= threshold; break;
      case "==": matched = Math.abs(score - threshold) < 0.001; break;
      case "!=": matched = score !== threshold; break;
    }
    return { matched, value: String(score.toFixed(4)) };
  }

  // ---- entity_count(pii.XXX) > N --------------------------------------------
  const entityCountMatch = expr.match(/^entity_count\(pii\.(\w+)\)\s*([><=!]+)\s*(\d+)$/);
  if (entityCountMatch) {
    const piiType = entityCountMatch[1]!;
    const op = entityCountMatch[2]!;
    const threshold = parseInt(entityCountMatch[3]!, 10);
    const piiDetectors: Record<string, RegExp> = {
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      phone: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
      ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
      credit_card: /\b(?:\d[ -]?){13,19}\b/g,
      ip_address: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b|\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){7}\b|\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6}::[0-9a-fA-F]{1,4}\b/g,
      date_of_birth: /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b|\b(?:19|20)\d{2}[-\/](?:0[1-9]|1[0-2])[-\/](?:0[1-9]|[12]\d|3[01])\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:0[1-9]|[12]\d|3[01]),?\s+(?:19|20)\d{2}\b/gi,
      license_plate: /\b[A-Z]{1,3}[-\s]?[0-9]{1,4}[-\s]?[A-Z]{0,3}\b|\b[0-9]{1,4}[-\s]?[A-Z]{1,3}[-\s]?[A-Z]{0,3}\b|\b[A-Z]{2}[-\s]?[0-9]{1,2}[-\s]?[A-Z]{1,3}\b|\b[A-Z]{2}[0-9]{3,4}[A-Z]{2}\b/g,
      medical_license: /\b[1-9]\d{9}\b/g,
    };
    const re = piiDetectors[piiType];
    if (!re) return { matched: false };
    const matches = text.match(re) ?? [];
    const count = matches.length;
    let matched = false;
    switch (op) {
      case ">": matched = count > threshold; break;
      case ">=": matched = count >= threshold; break;
      case "<": matched = count < threshold; break;
      case "<=": matched = count <= threshold; break;
      case "==": matched = count === threshold; break;
      case "!=": matched = count !== threshold; break;
    }
    return { matched, value: String(count) };
  }

  // ---- contains(pii.XXX) ----------------------------------------------------
  const piiMatch = expr.match(/^contains\(pii\.(\w+)\)$/);
  if (piiMatch) {
    const piiType = piiMatch[1]!;
    const piiDetectors: Record<string, RegExp> = {
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      phone: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
      ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
      credit_card: /\b(?:\d[ -]?){13,19}\b/g,
      ip_address: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b|\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){7}\b|\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6}::[0-9a-fA-F]{1,4}\b/g,
      date_of_birth: /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b|\b(?:19|20)\d{2}[-\/](?:0[1-9]|1[0-2])[-\/](?:0[1-9]|[12]\d|3[01])\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:0[1-9]|[12]\d|3[01]),?\s+(?:19|20)\d{2}\b/gi,
      license_plate: /\b[A-Z]{1,3}[-\s]?[0-9]{1,4}[-\s]?[A-Z]{0,3}\b|\b[0-9]{1,4}[-\s]?[A-Z]{1,3}[-\s]?[A-Z]{0,3}\b|\b[A-Z]{2}[-\s]?[0-9]{1,2}[-\s]?[A-Z]{1,3}\b|\b[A-Z]{2}[0-9]{3,4}[A-Z]{2}\b/g,
      medical_license: /\b[1-9]\d{9}\b/g, // NPI number: 10 digits starting with non-zero
    };

    const re = piiDetectors[piiType];
    if (!re) return { matched: false };

    const matches = text.match(re);
    if (!matches || matches.length === 0) return { matched: false };

    // Find first match position
    const firstMatch = matches[0]!;
    const idx = text.indexOf(firstMatch);
    return {
      matched: true,
      value: firstMatch,
      position: { start: idx, end: idx + firstMatch.length },
    };
  }

  // ---- regex_match("pattern") ------------------------------------------------
  const regexMatch = expr.match(/^regex_match\(\s*"([^"]+)"\s*\)$/);
  if (regexMatch) {
    const pattern = regexMatch[1]!;
    try {
      const re = new RegExp(pattern, "gi");
      const match = re.exec(text);
      if (!match) return { matched: false };
      return {
        matched: true,
        value: match[0],
        position: { start: match.index, end: match.index + match[0].length },
      };
    } catch {
      return { matched: false };
    }
  }

  // ---- pattern_match("pattern", "flags") ------------------------------------
  // Enhanced regex_match with explicit flags support (g, i, m, s)
  const patternMatch = expr.match(/^pattern_match\(\s*"([^"]+)"\s*(?:,\s*"([^"]*)")?\s*\)$/);
  if (patternMatch) {
    const pattern = patternMatch[1]!;
    const flags = patternMatch[2] ?? "gi";
    try {
      const re = new RegExp(pattern, flags);
      const match = re.exec(text);
      if (!match) return { matched: false };
      return {
        matched: true,
        value: match[0],
        position: { start: match.index, end: match.index + match[0].length },
      };
    } catch {
      return { matched: false };
    }
  }

  // ---- contains_word("word") ------------------------------------------------
  const containsWordMatch = expr.match(/^contains_word\(\s*"([^"]+)"\s*\)$/);
  if (containsWordMatch) {
    const word = containsWordMatch[1]!;
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const match = re.exec(text);
    if (!match) return { matched: false };
    return { matched: true, value: match[0], position: { start: match.index, end: match.index + match[0].length } };
  }

  // ---- contains_phrase("phrase") -------------------------------------------
  const containsPhraseMatch = expr.match(/^contains_phrase\(\s*"([^"]+)"\s*\)$/);
  if (containsPhraseMatch) {
    const phrase = containsPhraseMatch[1]!;
    const idx = text.toLowerCase().indexOf(phrase.toLowerCase());
    if (idx === -1) return { matched: false };
    const actual = text.slice(idx, idx + phrase.length);
    return { matched: true, value: actual, position: { start: idx, end: idx + phrase.length } };
  }

  // ---- word_count() > N ------------------------------------------------------
  const wordCountMatch = expr.match(/^word_count\(\)\s*([><=!]+)\s*(\d+)$/);
  if (wordCountMatch) {
    const op = wordCountMatch[1]!;
    const threshold = parseInt(wordCountMatch[2]!, 10);
    const count = text.split(/\s+/).filter(Boolean).length;
    let matched = false;
    switch (op) {
      case ">": matched = count > threshold; break;
      case ">=": matched = count >= threshold; break;
      case "<": matched = count < threshold; break;
      case "<=": matched = count <= threshold; break;
      case "==": matched = count === threshold; break;
      case "!=": matched = count !== threshold; break;
    }
    return { matched, value: String(count) };
  }

  // ---- length() > N ----------------------------------------------------------
  const lengthMatch = expr.match(/^length\(\)\s*([><=!]+)\s*(\d+)$/);
  if (lengthMatch) {
    const op = lengthMatch[1]!;
    const threshold = parseInt(lengthMatch[2]!, 10);
    const len = text.length;
    let matched = false;
    switch (op) {
      case ">": matched = len > threshold; break;
      case ">=": matched = len >= threshold; break;
      case "<": matched = len < threshold; break;
      case "<=": matched = len <= threshold; break;
      case "==": matched = len === threshold; break;
      case "!=": matched = len !== threshold; break;
    }
    return { matched, value: String(len) };
  }

  // Fallback: treat as plain regex if it looks like one
  if (expr.startsWith("/") && expr.endsWith("/")) {
    const pattern = expr.slice(1, -1);
    try {
      const re = new RegExp(pattern, "gi");
      const match = re.exec(text);
      if (!match) return { matched: false };
      return {
        matched: true,
        value: match[0],
        position: { start: match.index, end: match.index + match[0].length },
      };
    } catch {
      return { matched: false };
    }
  }

  return { matched: false };
}

// ---- String utilities --------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j]! = a[i - 1]! === b[j - 1]!
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

/**
 * Validate a DSL pattern without executing it.
 * Returns { valid: true } or { valid: false, error: string, position?: number }
 */
export function validateDSLPattern(pattern: string): { valid: true } | { valid: false; error: string; position?: number } {
  if (!pattern || !pattern.trim()) {
    return { valid: false, error: "Pattern cannot be empty" };
  }

  // Check balanced parentheses
  let depth = 0;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "(") depth++;
    else if (pattern[i] === ")") {
      depth--;
      if (depth < 0) return { valid: false, error: "Unbalanced parentheses: extra ')'", position: i };
    }
  }
  if (depth !== 0) return { valid: false, error: "Unbalanced parentheses: missing ')'" };

  // Check balanced quotes
  const quotes: Record<string, number> = { '"': 0, "'": 0 };
  let inQuote: string | null = null;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (inQuote) {
      if (ch === inQuote) {
        quotes[inQuote]--;
        inQuote = null;
      }
    } else {
      if (ch === '"' || ch === "'") {
        quotes[ch]++;
        inQuote = ch;
      }
    }
  }
  if (inQuote) return { valid: false, error: "Unterminated string literal" };
  if (quotes['"'] !== 0) return { valid: false, error: "Unbalanced double quotes" };
  if (quotes["'"] !== 0) return { valid: false, error: "Unbalanced single quotes" };

  // Validate function calls - extract and check function names
  const validFunctions = new Set([
    "contains", "contains_any", "contains_word", "contains_phrase",
    "regex_match", "pattern_match", "word_count", "entity_count",
    "length", "starts_with", "ends_with", "contains_prefix", "contains_suffix",
    "levenshtein_distance", "similarity_score",
  ]);

  const fnCallRegex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  let match;
  while ((match = fnCallRegex.exec(pattern)) !== null) {
    const fnName = match[1]!;
    if (!validFunctions.has(fnName)) {
      return { valid: false, error: `Unknown function '${fnName}'`, position: match.index };
    }
  }

  // Check for dangerous patterns (attempts to inject code)
  if (/[{}\\]/.test(pattern)) {
    return { valid: false, error: "Pattern contains forbidden characters" };
  }

  return { valid: true };
}

// ---- CRUD -------------------------------------------------------------------

export async function addGuardRule(
  sql: Sql,
  opts: {
    name: string;
    pattern: string;
    severity?: "low" | "medium" | "high" | "critical";
    action?: "block" | "redact" | "warn" | "log";
    priority?: number;
    enabled?: boolean;
  },
): Promise<GuardRule> {
  const {
    name,
    pattern,
    severity = "medium",
    action = "warn",
    priority = 100,
    enabled = true,
  } = opts;

  const [row] = await sql`
    INSERT INTO guardrails.guard_rules (name, pattern, severity, action, priority, enabled)
    VALUES (${name}, ${pattern}, ${severity}, ${action}, ${priority}, ${enabled})
    RETURNING *
  `;
  return row as unknown as GuardRule;
}

export async function listGuardRules(
  sql: Sql,
  filters?: { enabled?: boolean; severity?: string },
): Promise<GuardRule[]> {
  if (filters?.enabled !== undefined && filters?.severity) {
    const rows = await sql`
      SELECT * FROM guardrails.guard_rules
      WHERE enabled = ${filters.enabled} AND severity = ${filters.severity}
      ORDER BY priority ASC, created_at ASC
    `;
    return rows as unknown as GuardRule[];
  }
  if (filters?.enabled !== undefined) {
    const rows = await sql`
      SELECT * FROM guardrails.guard_rules
      WHERE enabled = ${filters.enabled}
      ORDER BY priority ASC, created_at ASC
    `;
    return rows as unknown as GuardRule[];
  }
  if (filters?.severity) {
    const rows = await sql`
      SELECT * FROM guardrails.guard_rules
      WHERE severity = ${filters.severity}
      ORDER BY priority ASC, created_at ASC
    `;
    return rows as unknown as GuardRule[];
  }

  const rows = await sql`
    SELECT * FROM guardrails.guard_rules
    ORDER BY priority ASC, created_at ASC
  `;
  return rows as unknown as GuardRule[];
}

export async function toggleGuardRule(
  sql: Sql,
  id: string,
  enabled: boolean,
): Promise<GuardRule | null> {
  const [row] = await sql`
    UPDATE guardrails.guard_rules
    SET enabled = ${enabled}
    WHERE id = ${id}
    RETURNING *
  `;
  return (row as unknown as GuardRule) ?? null;
}

export async function deleteGuardRule(sql: Sql, id: string): Promise<boolean> {
  const result = await sql`DELETE FROM guardrails.guard_rules WHERE id = ${id}`;
  return result.count > 0;
}

export async function updateGuardRule(
  sql: Sql,
  id: string,
  updates: Partial<{
    name: string;
    pattern: string;
    severity: "low" | "medium" | "high" | "critical";
    action: "block" | "redact" | "warn" | "log";
    priority: number;
    enabled: boolean;
  }>,
): Promise<GuardRule | null> {
  const sets: string[] = [];
  const vals: any[] = [];
  let idx = 1;

  if (updates.name !== undefined) {
    sets.push(`name = $${idx++}`);
    vals.push(updates.name);
  }
  if (updates.pattern !== undefined) {
    sets.push(`pattern = $${idx++}`);
    vals.push(updates.pattern);
  }
  if (updates.severity !== undefined) {
    sets.push(`severity = $${idx++}`);
    vals.push(updates.severity);
  }
  if (updates.action !== undefined) {
    sets.push(`action = $${idx++}`);
    vals.push(updates.action);
  }
  if (updates.priority !== undefined) {
    sets.push(`priority = $${idx++}`);
    vals.push(updates.priority);
  }
  if (updates.enabled !== undefined) {
    sets.push(`enabled = $${idx++}`);
    vals.push(updates.enabled);
  }

  if (sets.length === 0) return null;

  vals.push(id);
  const [row] = await sql.unsafe(
    `UPDATE guardrails.guard_rules SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    vals,
  ) as any[];
  return (row as unknown as GuardRule) ?? null;
}

// ---- Rule Evaluation across all active rules --------------------------------

export interface EvaluateGuardRulesResult {
  passed: boolean;
  matched_rules: Array<{
    rule: GuardRule;
    result: DSLResult;
  }>;
  sanitized: string;
  blocked: boolean;
}

/**
 * Evaluate all enabled rules in priority order.
 * First non-'log' match determines the outcome.
 * - 'block': sets blocked=true, stops further evaluation
 * - 'redact': sanitizes text, continues
 * - 'warn': records match, continues
 * - 'log': records match, continues (never blocks)
 */
export async function evaluateGuardRules(
  sql: Sql,
  text: string,
): Promise<EvaluateGuardRulesResult> {
  const rules = await listGuardRules(sql, { enabled: true });

  const matchedRules: Array<{ rule: GuardRule; result: DSLResult }> = [];
  let sanitized = text;
  let blocked = false;
  let blockAction: "block" | null = null;

  for (const rule of rules) {
    if (blockAction === "block") break; // Already blocked, stop

    const result = evaluateDSLRule(rule, text);

    if (result.matched) {
      matchedRules.push({ rule, result });

      if (result.sanitized) {
        sanitized = result.sanitized;
      }

      if (rule.action === "block") {
        blocked = true;
        blockAction = "block";
        break;
      }
    }
  }

  return {
    passed: matchedRules.length === 0 || matchedRules.every((m) => m.rule.action === "log"),
    matched_rules: matchedRules,
    sanitized,
    blocked,
  };
}
