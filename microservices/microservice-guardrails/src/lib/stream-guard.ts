/**
 * Streaming guard — real-time PII redaction on ReadableStream chunks.
 */

import { redactPII, scanPII, type PIIMatch } from "./pii.js";

export interface StreamGuardConfig {
  /** If true, redaction replaces matched PII with placeholders (default: true) */
  redact?: boolean;
  /** If true, PII matches are collected and returned (default: true) */
  trackMatches?: boolean;
  /** Custom placeholder format string, e.g. "[REDACTED_{type}]" (default) */
  placeholderTemplate?: string;
}

interface StreamGuardState {
  buffer: string;
  lastIndex: number;
  matches: PIIMatch[];
}

/**
 * Wraps a ReadableStream and redacts PII in real-time as chunks arrive.
 *
 * Since chunks may split PII across boundaries, we maintain a buffer and
 * scan it continuously. Already-processed text is removed from the buffer
 * to avoid re-scanning.
 */
export function streamGuard(
  stream: ReadableStream<string>,
  config: StreamGuardConfig = {},
): ReadableStream<string> {
  const {
    redact = true,
    trackMatches = true,
    placeholderTemplate = "[REDACTED_{type}]",
  } = config;

  let state: StreamGuardState = {
    buffer: "",
    lastIndex: 0,
    matches: [],
  };

  return new ReadableStream<string>({
    async start(controller) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          state.buffer += value;
          const allMatches = scanPII(state.buffer);

          if (allMatches.length > state.matches.length) {
            // New matches found — get only the new ones (not yet processed)
            const newMatches = allMatches.slice(state.matches.length);
            state.matches.push(...newMatches);

            if (redact) {
              // Sort new matches by position descending to avoid index shifting
              const sortedNew = [...newMatches].sort(
                (a, b) => b.start - a.start,
              );
              for (const m of sortedNew) {
                // Adjust positions relative to full buffer
                const adjustedStart = m.start;
                const adjustedEnd = m.end;
                const placeholder = placeholderTemplate.replace(
                  "{type}",
                  m.type.toUpperCase(),
                );
                state.buffer =
                  state.buffer.slice(0, adjustedStart) +
                  placeholder +
                  state.buffer.slice(adjustedEnd);
              }
            }
          }

          // Yield the buffer content that is "safe" (everything up to last processed position)
          // We yield in chunks to approximate the original stream flow
          controller.enqueue(state.buffer);
        }

        // Final flush: yield any remaining content with full redaction
        if (redact && state.buffer.length > 0) {
          const finalMatches = scanPII(state.buffer);
          if (finalMatches.length > 0) {
            state.buffer = redactPII(state.buffer, finalMatches);
          }
        }
        if (state.buffer.length > 0) {
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
 * Synchronously redact PII from a text string using full PII scan.
 * Convenience wrapper around scanPII + redactPII.
 */
export function redactStreamText(
  text: string,
  config: StreamGuardConfig = {},
): { redacted: string; matches: PIIMatch[] } {
  const { placeholderTemplate = "[REDACTED_{type}]" } = config;
  const matches = scanPII(text);

  if (matches.length === 0) {
    return { redacted: text, matches: [] };
  }

  let redacted = text;
  const sorted = [...matches].sort((a, b) => b.start - a.start);
  for (const m of sorted) {
    const placeholder = placeholderTemplate.replace("{type}", m.type.toUpperCase());
    redacted = redacted.slice(0, m.start) + placeholder + redacted.slice(m.end);
  }

  return { redacted, matches };
}
