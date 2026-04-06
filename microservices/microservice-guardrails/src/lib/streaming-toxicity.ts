/**
 * Streaming toxicity guard — real-time toxicity detection on ReadableStream chunks.
 *
 * Detects toxic content (insults, threats, hate speech, etc.) in real-time
 * as chunks arrive. Can abort the stream if toxicity threshold is exceeded.
 *
 * Uses a simple keyword/pattern based approach for streaming compatibility.
 * For production, consider integrating with a dedicated toxicity ML model.
 */

import { scanPII, type PIIMatch } from "./pii.js";

// Toxicity categories and their indicative patterns
const TOXICITY_PATTERNS: Record<string, RegExp[]> = {
  insult: [
    /\b(idiot|stupid|dumb|moron|loser|worthless|trash)\b/gi,
    /\b(you('re| are) (an? )?)?(idiot|stupid|dumb)\b/gi,
    /\b(shut up|get lost|go away|drop dead)\b/gi,
  ],
  threat: [
    /\b(i('ll| will)|gonna|going to)\s+(kill|hurt|destroy|ruin|end|murder)\b/gi,
    /\b(wish (you|him|her) (were |)dead)\b/gi,
    /\b(will|going to)\s+(regret|pay for this)\b/gi,
  ],
  hate_speech: [
    /\b(hate\s+you|despise|faggot|nigger|chink|spic|kike)\b/gi,
  ],
  profanity: [
    /\b(sh[i1]t|f[u\*]ck|a[s\$]s[hH]ole|b[i1]tch|bastard|d[a4]mn|crap)\b/gi,
    /\b(hell|ass|butt)|porn|xxx\b/gi,
  ],
  doxxing: [
    /\b(dox|doxx|leak)\s+(my|your|his|her)\s+(address|phone|ssn|social security)\b/gi,
    /\b(real name|home address)\s+(is|:)\s+\w/gi,
  ],
  self_harm: [
    /\b(self.?harm|cut myself|suicide|kill myself)\b/gi,
    /\b(don't want to (be alive|live|exist anymore))\b/gi,
  ],
};

export interface ToxicityMatch {
  category: string;
  match: string;
  start: number;
  end: number;
  severity: "low" | "medium" | "high" | "critical";
}

export interface StreamingToxicityConfig {
  /** If true, abort stream when toxicity is detected */
  abortOnToxicity?: boolean;
  /** Minimum severity to trigger abort (default: high) */
  abortThreshold?: "low" | "medium" | "high" | "critical";
  /** If true, collect all matches (default: true) */
  trackMatches?: boolean;
  /** Callback called when toxicity is detected */
  onToxicityDetected?: (matches: ToxicityMatch[]) => void;
}

interface ToxicityState {
  buffer: string;
  lastIndex: number;
  matches: ToxicityMatch[];
  aborted: boolean;
}

const SEVERITY_ORDER: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Scan text for toxicity patterns and return matches.
 */
export function scanToxicity(text: string): ToxicityMatch[] {
  const matches: ToxicityMatch[] = [];

  for (const [category, patterns] of Object.entries(TOXICITY_PATTERNS)) {
    for (const pattern of patterns) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        // Determine severity based on category
        let severity: "low" | "medium" | "high" | "critical" = "medium";
        if (category === "threat" || category === "hate_speech") {
          severity = "high";
        } else if (category === "self_harm" || category === "doxxing") {
          severity = "critical";
        } else if (category === "profanity") {
          severity = "low";
        }

        matches.push({
          category,
          match: match[0],
          start: match.index,
          end: match.index + match[0].length,
          severity,
        });
      }
    }
  }

  // Sort by position
  return matches.sort((a, b) => a.start - b.start);
}

/**
 * Wrap a ReadableStream and detect toxicity in real-time as chunks arrive.
 *
 * Since chunks may split toxic patterns across boundaries, we maintain a buffer
 * and scan it continuously.
 */
export function streamToxicityGuard(
  stream: ReadableStream<string>,
  config: StreamingToxicityConfig = {},
): ReadableStream<string> {
  const {
    abortOnToxicity = false,
    abortThreshold = "high",
    trackMatches = true,
    onToxicityDetected,
  } = config;

  let state: ToxicityState = {
    buffer: "",
    lastIndex: 0,
    matches: [],
    aborted: false,
  };

  const thresholdLevel = SEVERITY_ORDER[abortThreshold];

  return new ReadableStream<string>({
    async start(controller) {
      const reader = stream.getReader();
      try {
        while (true) {
          if (state.aborted) break;

          const { done, value } = await reader.read();
          if (done) break;

          state.buffer += value;
          const allMatches = scanToxicity(state.buffer);

          if (allMatches.length > state.matches.length) {
            const newMatches = allMatches.slice(state.matches.length);
            state.matches.push(...newMatches);

            // Check if we should abort
            if (abortOnToxicity) {
              const maxSeverity = newMatches.reduce(
                (max, m) => (SEVERITY_ORDER[m.severity] > max ? SEVERITY_ORDER[m.severity] : max),
                0,
              );
              if (maxSeverity >= thresholdLevel) {
                state.aborted = true;
                if (onToxicityDetected) {
                  onToxicityDetected(newMatches);
                }
                controller.error(new Error(`Toxicity detected: ${newMatches[0]?.category}`));
                return;
              }
            }

            if (onToxicityDetected) {
              onToxicityDetected(newMatches);
            }
          }

          // Yield buffered content
          controller.enqueue(state.buffer);
        }

        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

/**
 * Synchronously check text for toxicity.
 */
export function checkTextToxicity(
  text: string,
): { isToxic: boolean; matches: ToxicityMatch[]; maxSeverity: string | null } {
  const matches = scanToxicity(text);
  const maxSeverity = matches.length > 0
    ? matches.reduce((max, m) =>
        SEVERITY_ORDER[m.severity] > SEVERITY_ORDER[max] ? m.severity : max,
      "low" as const)
    : null;

  return {
    isToxic: matches.length > 0,
    matches,
    maxSeverity,
  };
}

/**
 * Combined streaming guard that checks both PII and toxicity.
 */
export interface CombinedStreamingConfig {
  redactPII?: boolean;
  detectToxicity?: boolean;
  abortOnToxicity?: boolean;
  abortThreshold?: "low" | "medium" | "high" | "critical";
  piiPlaceholderTemplate?: string;
  onToxicityDetected?: (matches: ToxicityMatch[]) => void;
  onPIIDetected?: (matches: PIIMatch[]) => void;
}

function isPIIMatch(text: string): PIIMatch[] {
  // Simple PII detection for streaming
  const patterns = [
    { type: "email", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
    { type: "phone", regex: /\b(\+?1[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}\b/g },
    { type: "ssn", regex: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g },
    { type: "credit_card", regex: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g },
    { type: "ip_address", regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g },
  ];

  const matches: PIIMatch[] = [];
  for (const { type, regex } of patterns) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        type,
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

/**
 * Wrap a ReadableStream and guard against both PII and toxicity in real-time.
 */
export function streamCombinedGuard(
  stream: ReadableStream<string>,
  config: CombinedStreamingConfig = {},
): ReadableStream<string> {
  const {
    redactPII = true,
    detectToxicity = true,
    abortOnToxicity = false,
    abortThreshold = "high",
    piiPlaceholderTemplate = "[REDACTED_{type}]",
    onToxicityDetected,
    onPIIDetected,
  } = config;

  let state = {
    buffer: "",
    piiMatches: [] as PIIMatch[],
    toxicityMatches: [] as ToxicityMatch[],
    aborted: false,
  };

  const thresholdLevel = SEVERITY_ORDER[abortThreshold];

  return new ReadableStream<string>({
    async start(controller) {
      const reader = stream.getReader();
      try {
        while (true) {
          if (state.aborted) break;

          const { done, value } = await reader.read();
          if (done) break;

          state.buffer += value;

          // Scan for PII
          if (redactPII) {
            const piiMatches = isPIIMatch(state.buffer);
            if (piiMatches.length > state.piiMatches.length) {
              const newPII = piiMatches.slice(state.piiMatches.length);
              state.piiMatches.push(...newPII);
              if (onPIIDetected) onPIIDetected(newPII);

              // Redact PII
              const sorted = [...newPII].sort((a, b) => b.start - a.start);
              for (const m of sorted) {
                const placeholder = piiPlaceholderTemplate.replace("{type}", m.type.toUpperCase());
                state.buffer = state.buffer.slice(0, m.start) + placeholder + state.buffer.slice(m.end);
              }
            }
          }

          // Scan for toxicity
          if (detectToxicity) {
            const toxicityMatches = scanToxicity(state.buffer);
            if (toxicityMatches.length > state.toxicityMatches.length) {
              const newToxicity = toxicityMatches.slice(state.toxicityMatches.length);
              state.toxicityMatches.push(...newToxicity);
              if (onToxicityDetected) onToxicityDetected(newToxicity);

              if (abortOnToxicity && newToxicity.length > 0) {
                const maxSeverity = newToxicity.reduce(
                  (max, m) => (SEVERITY_ORDER[m.severity] > max ? SEVERITY_ORDER[m.severity] : max),
                  0,
                );
                if (maxSeverity >= thresholdLevel) {
                  state.aborted = true;
                  controller.error(new Error(`Toxicity detected: ${newToxicity[0]?.category}`));
                  return;
                }
              }
            }
          }

          controller.enqueue(state.buffer);
        }

        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
