/**
 * SDK-safe guardrail detectors.
 *
 * This module is intentionally pure: it has no Postgres, HTTP, CLI, or MCP
 * imports, so app runtimes can consume it without adopting the guardrails
 * microservice data plane.
 */

export type GuardrailRedactionKind =
  | "secret"
  | "credential"
  | "email"
  | "phone"
  | "credit_card"
  | "prompt_leak"
  | "custom";

export interface GuardrailRedaction {
  kind: GuardrailRedactionKind;
  label: string;
  count: number;
}

export interface RedactionResult {
  text: string;
  redactions: GuardrailRedaction[];
}

interface RedactionPattern {
  kind: GuardrailRedactionKind;
  label: string;
  pattern: RegExp;
  shouldRedact?: (match: string, source: string, offset: number) => boolean;
}

export interface RedactionOptions {
  includeKinds?: ReadonlyArray<GuardrailRedactionKind>;
  excludeKinds?: ReadonlyArray<GuardrailRedactionKind>;
}

export type PiiMatchType =
  | "email"
  | "phone"
  | "ssn"
  | "credit_card"
  | "ip_address"
  | "zip_code"
  | "date_of_birth"
  | "license_plate"
  | "medical_license";

export interface PiiMatch {
  type: PiiMatchType;
  value: string;
  start: number;
  end: number;
}

export interface PiiScanOptions {
  includeTypes?: ReadonlyArray<PiiMatchType>;
  excludeTypes?: ReadonlyArray<PiiMatchType>;
}

export interface PiiRedactionOptions extends PiiScanOptions {
  placeholderTemplate?: string;
}

export interface CredentialTextRedactionOptions {
  redactProviderKeys?: boolean;
}

export const PROMPT_LEAK_CANARY =
  "ALUMIA_SYSTEM_PROMPT_CANARY_DO_NOT_DISCLOSE_2026";

export const PROMPT_INJECTION_PATTERNS: Array<{ id: string; pattern: RegExp }> =
  [
    {
      id: "ignore-previous-instructions",
      pattern:
        /\b(ignore|disregard|override)\s+(all\s+)?(?:(previous|prior|above)\s+)?(system|developer)?\s*instructions?\b/i,
    },
    {
      id: "reveal-system-prompt",
      pattern:
        /\b(print|show|reveal|dump|exfiltrate|leak|repeat)\b.{0,80}\b(system prompt|developer instructions|hidden instructions|tool schema|tools schema)\b/i,
    },
    {
      id: "instruction-hierarchy-attack",
      pattern:
        /\b(system|developer|tool)\s+message\b.{0,80}\b(verbatim|raw|exact|full)\b/i,
    },
    {
      id: "jailbreak-roleplay",
      pattern: /\b(DAN|do anything now|jailbreak|developer mode|god mode)\b/i,
    },
    {
      id: "indirect-tool-exfiltration",
      pattern:
        /\b(call|use|invoke)\b.{0,80}\b(tool|connector|api)\b.{0,120}\b(send|post|upload|exfiltrate)\b/i,
    },
    {
      id: "hidden-webpage-instructions",
      pattern:
        /\b(this (webpage|document|email) contains instructions for the ai|assistant must ignore the user)\b/i,
    },
  ];

export const PROMPT_LEAK_PATTERNS: Array<{
  id: string;
  pattern: RegExp;
  weight: number;
}> = [
  { id: "valid-channels", pattern: /\bvalid channels\s*:/i, weight: 3 },
  {
    id: "developer-instructions",
    pattern: /\bdeveloper (message|instructions)\b/i,
    weight: 2,
  },
  { id: "namespace-tools", pattern: /\bnamespace\s+\w+\s*\{/i, weight: 3 },
  { id: "tool-definition", pattern: /\btype\s+\w+\s*=\s*\(/i, weight: 2 },
  { id: "knowledge-cutoff", pattern: /\bknowledge cutoff\s*:/i, weight: 2 },
  { id: "current-date", pattern: /\bcurrent date\s*:/i, weight: 1 },
  { id: "system-prompt-label", pattern: /\bsystem prompt\s*:/i, weight: 2 },
  { id: "system-channel", pattern: /\bchannel must be included\b/i, weight: 2 },
  { id: "tools-header", pattern: /(^|\n)\s*#{1,3}\s*tools\b/i, weight: 2 },
];

export const PROMPT_LEAK_SCORE_THRESHOLD = 6;

export const PROMPT_LEAK_SIGNATURES: Array<{ id: string; terms: string[] }> = [
  {
    id: "codex-system-prompt",
    terms: [
      "you are codex",
      "valid channels",
      "analysis",
      "commentary",
      "final",
    ],
  },
  {
    id: "tool-schema",
    terms: ["namespace functions", "type exec_command", "target channel"],
  },
  {
    id: "agent-rules",
    terms: ["agents.md instructions", "branch safety", "never use git worktrees"],
  },
  {
    id: "alumia-platform-system-prompt",
    terms: [
      "you are ala, an ai agent on the alumia platform",
      "platform capabilities",
      "custom instructions",
    ],
  },
  {
    id: "alumia-behavior-rules",
    terms: [
      "## behavior",
      "never fabricate urls",
      "verify before reporting success",
      "don't echo large tool outputs",
    ],
  },
];

const PROMPT_LEAK_ZERO_WIDTH_PATTERN = /[\u200b-\u200f\ufeff]/g;

function normalizePromptLeakText(text: string): string {
  return text
    .replace(PROMPT_LEAK_ZERO_WIDTH_PATTERN, "")
    .replace(/\r\n/g, "\n")
    .toLowerCase()
    .replace(/[ \t]+/g, " ")
    .trim();
}

function compactPromptLeakText(text: string): string {
  return normalizePromptLeakText(text).replace(/[^a-z0-9]+/g, "");
}

const REDACTION_PATTERNS: RedactionPattern[] = [
  {
    kind: "secret",
    label: "api-key",
    pattern:
      /\b(?:sk|pk|rk|xox[baprs]|gh[pousr]|glpat|ya29|AIza)[A-Za-z0-9_\-]{16,}\b/g,
  },
  {
    kind: "credential",
    label: "aws-access-key-id",
    pattern: /\bA(?:KIA|SIA)[0-9A-Z]{16}\b/g,
  },
  {
    kind: "credential",
    label: "github-token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g,
  },
  {
    kind: "credential",
    label: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._\-+/=]{16,}\b/gi,
  },
  {
    kind: "credential",
    label: "credential-assignment",
    pattern:
      /\b(?:api[_-]?key|token|secret|password|credential|authorization|cookie)\s*[:=]\s*["']?[^"',\s}]{8,}/gi,
    shouldRedact: (match) =>
      !match.includes("[redacted]") && !match.includes("<REDACTED:"),
  },
  {
    kind: "credential",
    label: "database-url",
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mongodb|redis):\/\/[^:\s/@]+:[^@\s]+@[^\s"')]+/gi,
  },
  {
    kind: "credential",
    label: "credential-url",
    pattern:
      /\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:[^@\s]+@[^\s"')]+/gi,
  },
  {
    kind: "secret",
    label: "private-key",
    pattern:
      /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    kind: "secret",
    label: "certificate",
    pattern: /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
  },
  {
    kind: "email",
    label: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    kind: "phone",
    label: "phone",
    pattern: /(?<![A-Za-z0-9-])(?:\+?\d[\d .()\-]{7,}\d)(?![A-Za-z0-9-])/g,
  },
  {
    kind: "credit_card",
    label: "credit-card",
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    shouldRedact: (match, source, offset) =>
      isLikelyCreditCard(match) &&
      !isXStatusUrlIdentifier(source, offset, match),
  },
];

const DEFAULT_STRINGIFY_MAX_LENGTH = 20_000;
const DEFAULT_REDACTION_KINDS = new Set<GuardrailRedactionKind>([
  "secret",
  "credential",
]);

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function isLikelyCreditCard(value: string): boolean {
  const digits = digitsOnly(value);
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function tokenBounds(source: string, offset: number, length: number) {
  let start = offset;
  while (start > 0 && !/[\s<>"'`]/.test(source[start - 1])) start -= 1;

  let end = offset + length;
  while (end < source.length && !/[\s<>"'`]/.test(source[end])) end += 1;

  return { start, end };
}

function trimUrlPunctuation(value: string): string {
  return value.replace(/[),.;\]}]+$/g, "");
}

function isXStatusUrlIdentifier(
  source: string,
  offset: number,
  match: string,
): boolean {
  const digits = digitsOnly(match);
  if (!digits) return false;

  const { start, end } = tokenBounds(source, offset, match.length);
  const token = trimUrlPunctuation(source.slice(start, end));
  if (!/^https?:\/\//i.test(token)) return false;

  try {
    const url = new URL(token);
    const hostname = url.hostname.toLowerCase();
    if (
      hostname !== "x.com" &&
      hostname !== "twitter.com" &&
      hostname !== "mobile.twitter.com"
    ) {
      return false;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    const statusIndex = segments.findIndex((segment) => segment === "status");
    if (statusIndex === -1) return false;
    return segments[statusIndex + 1] === digits;
  } catch {
    return false;
  }
}

function isIpv4Literal(value: string): boolean {
  return /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(
    value.trim(),
  );
}

const PII_PATTERNS: Array<{
  type: PiiMatchType;
  pattern: RegExp;
  validate?: (match: string) => boolean;
}> = [
  {
    type: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    type: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    type: "credit_card",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    validate: isLikelyCreditCard,
  },
  {
    type: "phone",
    pattern:
      /(?<![A-Za-z0-9-])(?:\+?\d[\d .()\-]{7,}\d)(?![A-Za-z0-9-])/g,
    validate: (match) => digitsOnly(match).length >= 7 && !isIpv4Literal(match),
  },
  {
    type: "ip_address",
    pattern:
      /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  },
  {
    type: "ip_address",
    pattern:
      /\b(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){7}|[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6}::[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?::[0-9a-fA-F]{1,4}){1,7}|::)\b/gi,
  },
  {
    type: "zip_code",
    pattern: /\b\d{5}(?:-\d{4})?\b/g,
  },
  {
    type: "date_of_birth",
    pattern:
      /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b|\b(?:19|20)\d{2}[-\/](?:0[1-9]|1[0-2])[-\/](?:0[1-9]|[12]\d|3[01])\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:0?[1-9]|[12]\d|3[01]),?\s+(?:19|20)\d{2}\b|\b(?:0?[1-9]|[12]\d|3[01])\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:19|20)\d{2}\b/gi,
  },
  {
    type: "license_plate",
    pattern:
      /\b[A-Z]{1,3}[-\s]?[0-9][-\s]?[A-Z]{0,2}[-\s]?[0-9]{0,4}\b|\b[0-9]{1,4}[-\s]?[A-Z]{1,3}[-\s]?[A-Z]{0,3}\b/g,
  },
  {
    type: "medical_license",
    pattern: /\b[1-9]\d{9}\b/g,
  },
];

const PII_TYPE_PRIORITY: Record<PiiMatchType, number> = {
  credit_card: 100,
  ssn: 95,
  email: 90,
  phone: 80,
  ip_address: 70,
  date_of_birth: 60,
  medical_license: 50,
  license_plate: 40,
  zip_code: 10,
};

const PII_TYPE_LABELS: Record<PiiMatchType, string> = {
  credit_card: "credit card",
  date_of_birth: "date of birth",
  email: "email",
  ip_address: "IP address",
  license_plate: "license plate",
  medical_license: "medical license",
  phone: "phone",
  ssn: "SSN",
  zip_code: "ZIP code",
};

function findPiiMatches(text: string): PiiMatch[] {
  const matches: PiiMatch[] = [];
  for (const item of PII_PATTERNS) {
    const pattern = new RegExp(item.pattern.source, item.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (item.validate && !item.validate(match[0])) continue;
      matches.push({
        type: item.type,
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  return matches;
}

function piiMatchesOverlap(a: PiiMatch, b: PiiMatch): boolean {
  return a.start < b.end && b.start < a.end;
}

function normalizePiiMatches(matches: PiiMatch[]): PiiMatch[] {
  const selected: PiiMatch[] = [];
  const ranked = [...matches].sort((a, b) => {
    const priority = PII_TYPE_PRIORITY[b.type] - PII_TYPE_PRIORITY[a.type];
    if (priority !== 0) return priority;
    const length = b.end - b.start - (a.end - a.start);
    if (length !== 0) return length;
    return a.start - b.start;
  });

  for (const match of ranked) {
    if (!selected.some((existing) => piiMatchesOverlap(existing, match))) {
      selected.push(match);
    }
  }

  return selected.sort((a, b) => a.start - b.start);
}

function formatPiiPlaceholder(
  match: PiiMatch,
  template = "[REDACTED_{TYPE}]",
): string {
  return template
    .replaceAll("{type}", match.type)
    .replaceAll("{TYPE}", match.type.toUpperCase())
    .replaceAll("{label}", PII_TYPE_LABELS[match.type]);
}

export function detectPromptInjection(text: string): string[] {
  if (!text.trim()) return [];
  return PROMPT_INJECTION_PATTERNS.filter(({ pattern }) =>
    pattern.test(text),
  ).map(({ id }) => id);
}

export function redactPromptInjectionText(text: string): RedactionResult {
  if (!text.trim()) return { text, redactions: [] };

  let count = 0;
  let redacted = text;
  for (const { pattern } of PROMPT_INJECTION_PATTERNS) {
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;
    redacted = redacted.replace(new RegExp(pattern.source, flags), () => {
      count += 1;
      return "<REDACTED:prompt-injection>";
    });
  }

  return {
    text: redacted,
    redactions:
      count > 0
        ? [{ kind: "custom", label: "prompt-injection-tool-result", count }]
        : [],
  };
}

export function detectPromptLeak(text: string): string[] {
  if (!text.trim()) return [];

  const reasons: string[] = [];
  const normalized = normalizePromptLeakText(text);

  if (
    compactPromptLeakText(normalized).includes(
      compactPromptLeakText(PROMPT_LEAK_CANARY),
    )
  ) {
    reasons.push("prompt-leak-canary");
  }

  for (const signature of PROMPT_LEAK_SIGNATURES) {
    if (signature.terms.every((term) => normalized.includes(term))) {
      reasons.push(signature.id);
    }
  }

  let score = 0;
  const weightedReasons: string[] = [];
  for (const { id, pattern, weight } of PROMPT_LEAK_PATTERNS) {
    if (pattern.test(text)) {
      score += weight;
      weightedReasons.push(id);
    }
  }
  if (score >= PROMPT_LEAK_SCORE_THRESHOLD) {
    reasons.push(`weighted-prompt-signature:${weightedReasons.join(",")}`);
  }

  return reasons;
}

export function scanPii(
  text: string,
  options: PiiScanOptions = {},
): PiiMatch[] {
  if (!text.trim()) return [];
  const includeTypes = new Set(options.includeTypes ?? []);
  const excludeTypes = new Set(options.excludeTypes ?? []);
  return normalizePiiMatches(findPiiMatches(text)).filter((match) => {
    if (includeTypes.size > 0 && !includeTypes.has(match.type)) return false;
    return !excludeTypes.has(match.type);
  });
}

export function redactPiiText(
  text: string,
  options: PiiRedactionOptions = {},
): {
  text: string;
  matches: PiiMatch[];
} {
  const matches = scanPii(text, options);
  if (matches.length === 0) return { text, matches };

  let redacted = text;
  for (const match of [...matches].sort((a, b) => b.start - a.start)) {
    redacted =
      redacted.slice(0, match.start) +
      formatPiiPlaceholder(match, options.placeholderTemplate) +
      redacted.slice(match.end);
  }

  return { text: redacted, matches };
}

export function redactSensitiveText(
  text: string,
  options: RedactionOptions = {},
): RedactionResult {
  let redacted = text;
  const redactions = new Map<string, GuardrailRedaction>();
  const includedKinds = new Set(options.includeKinds ?? DEFAULT_REDACTION_KINDS);
  const excludedKinds = new Set(options.excludeKinds ?? []);

  for (const item of REDACTION_PATTERNS) {
    if (!includedKinds.has(item.kind)) continue;
    if (excludedKinds.has(item.kind)) continue;
    let count = 0;
    redacted = redacted.replace(
      item.pattern,
      (match: string, offset: number) => {
        if (item.shouldRedact && !item.shouldRedact(match, redacted, offset)) {
          return match;
        }
        count += 1;
        return `<REDACTED:${item.label}>`;
      },
    );
    if (count > 0) {
      const key = `${item.kind}:${item.label}`;
      redactions.set(key, {
        kind: item.kind,
        label: item.label,
        count,
      });
    }
  }

  return { text: redacted, redactions: [...redactions.values()] };
}

export function redactCredentialText(
  text: string,
  options: CredentialTextRedactionOptions = {},
): string {
  const { redactProviderKeys = true } = options;
  let redacted = text
    .replace(
      /\b(authorization|proxy-authorization)\s*[:=]\s*["']?(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi,
      "$1: $2 [redacted]",
    )
    .replace(
      /\b(authorization|proxy-authorization)\s*[:=]\s*["']?(?!(?:Bearer|Basic)\b)[^"',\s}&]+/gi,
      "$1=[redacted]",
    )
    .replace(
      /\b(x[-_ ]?api[-_ ]?key|token|api[_ -]?key|secret|password|cookie)\s*[:=]\s*["']?[^"',\s}&]+/gi,
      "$1=[redacted]",
    );

  if (redactProviderKeys) {
    redacted = redacted
      .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, "[redacted Anthropic key]")
      .replace(/\bAIza[0-9A-Za-z_-]{16,}\b/g, "[redacted Google key]")
      .replace(/\bxai-[A-Za-z0-9_-]{8,}\b/g, "[redacted xAI key]")
      .replace(/\b[rs]k_(?:live|test)_[A-Za-z0-9]{8,}\b/g, "[redacted Stripe key]")
      .replace(/\bnpm_[A-Za-z0-9]{16,}\b/g, "[redacted npm token]")
      .replace(
        /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
        "[redacted JWT]",
      )
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 [redacted]")
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted OpenAI key]")
      .replace(/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, "[redacted GitHub token]")
      .replace(/\bA(?:KIA|SIA)[0-9A-Z]{16}\b/g, "[redacted AWS key]");
  }

  return redacted;
}

export function containsLikelySecret(text: string): boolean {
  return redactSensitiveText(text).redactions.some(
    (redaction) =>
      redaction.kind === "secret" || redaction.kind === "credential",
  );
}

export function safeStringify(
  value: unknown,
  maxLength = DEFAULT_STRINGIFY_MAX_LENGTH,
): string {
  if (typeof value === "string") return value.slice(0, maxLength);
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, child) => {
      if (child && typeof child === "object") {
        if (seen.has(child)) return "[Circular]";
        seen.add(child);
      }
      return child;
    }).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}
