/**
 * Content filtering — detect and redact PII/sensitive content from message text.
 */

export type FilterPattern =
  | "email"
  | "phone"
  | "ssn"
  | "credit_card"
  | "ip_address"
  | "api_key"
  | "password"
  | "jwt";

export interface FilterMatch {
  type: FilterPattern;
  start: number;
  end: number;
  masked: string;
  original_length: number;
}

export interface FilterResult {
  original: string;
  filtered: string;
  matches: FilterMatch[];
  match_count: number;
}

const PATTERNS: Record<FilterPattern, RegExp> = {
  email: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
  phone: /\b(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
  ssn: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  credit_card: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  ip_address: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  api_key: /\b(?:api[_-]?key|apikey|api_secret|apiSecret)[=:\s]["']?([A-Za-z0-9_\-]{20,})/gi,
  password: /\b(?:password|passwd|pwd|secret)[=:\s]["']?[^\s"']{4,}/gi,
  jwt: /\beyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b/g,
};

const MASK_CHARS = "***";
const MASK: Record<FilterPattern, string> = {
  email: `[${MASK_CHARS}_EMAIL]`,
  phone: `[${MASK_CHARS}_PHONE]`,
  ssn: `[${MASK_CHARS}_SSN]`,
  credit_card: `[${MASK_CHARS}_CARD]`,
  ip_address: `[${MASK_CHARS}_IP]`,
  api_key: `[${MASK_CHARS}_APIKEY]`,
  password: `[${MASK_CHARS}_PWD]`,
  jwt: `[${MASK_CHARS}_JWT]`,
};

/**
 * Detect and redact sensitive content from a string.
 */
export function redactContent(
  text: string,
  patterns: FilterPattern[] = ["email", "phone", "ssn", "credit_card", "api_key", "password", "jwt"],
): FilterResult {
  const matches: FilterMatch[] = [];
  let filtered = text;

  for (const p of patterns) {
    const regex = new RegExp(PATTERNS[p].source, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        type: p,
        start: match.index,
        end: match.index + match[0].length,
        masked: MASK[p],
        original_length: match[0].length,
      });
    }
  }

  // Sort by position descending to replace from end to start
  matches.sort((a, b) => b.start - a.start);

  for (const m of matches) {
    filtered = filtered.slice(0, m.start) + m.masked + filtered.slice(m.end);
  }

  return {
    original: text,
    filtered,
    matches,
    match_count: matches.length,
  };
}

/**
 * Redact content in a batch of messages.
 */
export async function redactMessages<T extends { content: string }>(
  messages: T[],
  patterns?: FilterPattern[],
): Promise<Array<T & { filtered_content: string; filter_matches: FilterMatch[] }>> {
  return messages.map((msg) => {
    const result = redactContent(msg.content, patterns);
    return {
      ...msg,
      filtered_content: result.filtered,
      filter_matches: result.matches,
    };
  });
}

/**
 * Get a summary of detected patterns without actually redacting.
 */
export function detectSensitiveContent(text: string): FilterResult {
  return redactContent(text);
}
