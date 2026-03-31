/**
 * PII (Personally Identifiable Information) detection and redaction.
 */

export interface PIIMatch {
  type: string;
  value: string;
  start: number;
  end: number;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_US_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const PHONE_INTL_RE = /\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const CC_RE = /\b(\d[ -]?){13,19}\b/g;
const IP_RE = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
const ZIP_US_RE = /\b\d{5}(?:-\d{4})?\b/g;
const DOB_RE = /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/g;

/**
 * Luhn algorithm — validates credit card numbers.
 */
function luhnCheck(num: string): boolean {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i]!, 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function findMatches(text: string, regex: RegExp, type: string): PIIMatch[] {
  const matches: PIIMatch[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(regex.source, regex.flags);
  while ((m = re.exec(text)) !== null) {
    matches.push({ type, value: m[0], start: m.index, end: m.index + m[0].length });
  }
  return matches;
}

/**
 * Scan text for PII patterns. Returns all matches with positions.
 */
export function scanPII(text: string): PIIMatch[] {
  const matches: PIIMatch[] = [];

  matches.push(...findMatches(text, EMAIL_RE, "email"));
  matches.push(...findMatches(text, SSN_RE, "ssn"));

  // Credit cards: find candidates then Luhn-validate
  const ccCandidates = findMatches(text, CC_RE, "credit_card");
  for (const cc of ccCandidates) {
    if (luhnCheck(cc.value)) {
      matches.push(cc);
    }
  }

  // Phone: US format then international (deduplicate overlapping)
  const phoneMatches = [
    ...findMatches(text, PHONE_US_RE, "phone"),
    ...findMatches(text, PHONE_INTL_RE, "phone"),
  ];
  // Deduplicate overlapping phone matches
  const seen = new Set<string>();
  for (const p of phoneMatches) {
    const key = `${p.start}:${p.end}`;
    if (!seen.has(key)) {
      // Filter out short digit-only matches that aren't real phone numbers
      const digits = p.value.replace(/\D/g, "");
      if (digits.length >= 7) {
        seen.add(key);
        matches.push(p);
      }
    }
  }

  matches.push(...findMatches(text, IP_RE, "ip_address"));

  // ZIP codes: only match if not already part of another match (SSN, CC, phone)
  const zipCandidates = findMatches(text, ZIP_US_RE, "zip_code");
  for (const z of zipCandidates) {
    const overlaps = matches.some(
      (m) => z.start >= m.start && z.end <= m.end
    );
    if (!overlaps) {
      matches.push(z);
    }
  }

  matches.push(...findMatches(text, DOB_RE, "date_of_birth"));

  // Sort by position
  matches.sort((a, b) => a.start - b.start);

  return matches;
}

/**
 * Redact PII from text, replacing each match with [REDACTED_TYPE].
 */
export function redactPII(text: string, matches: PIIMatch[]): string {
  if (matches.length === 0) return text;

  // Sort by start position descending so replacements don't shift indices
  const sorted = [...matches].sort((a, b) => b.start - a.start);

  let result = text;
  for (const m of sorted) {
    const label = `[REDACTED_${m.type.toUpperCase()}]`;
    result = result.slice(0, m.start) + label + result.slice(m.end);
  }

  return result;
}
