/**
 * Enhanced streaming utilities for microservice-llm.
 *
 * - SSE framing and parsing helpers
 * - Stream aggregation (merge multiple streams)
 * - Streaming session metadata (time-to-first-token, tokens/sec, etc.)
 */

import type { StreamChunk } from "./providers.js";

// ---------------------------------------------------------------------------
// SSE framing
// ---------------------------------------------------------------------------

export interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

/**
 * Parse a raw SSE line (e.g. "data: {...}") into an SSEEvent.
 * Handles blank lines (event terminators), comment lines (starting with :),
 * and CRLF/LF line endings.
 */
export function parseSSELine(line: string): SSEEvent | null {
  if (line === "" || line.startsWith(":")) return null;
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return { data: line };
  const field = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1).replace(/^ /, "");
  if (field === "event") return { event: value };
  if (field === "id") return { id: value };
  if (field === "retry") return { retry: parseInt(value, 10) };
  if (field === "data") return { data: value };
  return null;
}

/**
 * Parse a raw SSE body (multiple lines) into structured events.
 */
export function parseSSEBody(raw: string): SSEEvent[] {
  const lines = raw.split(/\r?\n/);
  const events: SSEEvent[] = [];
  let current: SSEEvent = { data: "" };

  for (const line of lines) {
    const parsed = parseSSELine(line);
    if (parsed === null) {
      if (current.data || current.event || current.id) {
        events.push(current);
      }
      current = { data: "" };
      continue;
    }
    if (parsed.event !== undefined) current.event = parsed.event;
    if (parsed.id !== undefined) current.id = parsed.id;
    if (parsed.data !== undefined) {
      if (current.data) current.data += "\n";
      current.data += parsed.data;
    }
  }
  if (current.data || current.event || current.id) events.push(current);
  return events;
}

/**
 * Encode a value as an SSE data frame. Uses "data:" prefix and "\n\n" terminator.
 */
export function sseEncode(
  data: unknown,
  event?: string,
  id?: string,
): string {
  let frame = "";
  if (id) frame += `id: ${id}\n`;
  if (event) frame += `event: ${event}\n`;
  const body = typeof data === "string" ? data : JSON.stringify(data);
  for (const line of body.split("\n")) {
    frame += `data: ${line}\n`;
  }
  frame += "\n";
  return frame;
}

/**
 * Wrap a ReadableStream of raw text into SSE events.
 */
export function rawStreamToSSEEvents(
  stream: ReadableStream<string>,
): ReadableStream<SSEEvent> {
  const reader = stream.getReader();
  let buffer = "";

  return new ReadableStream<SSEEvent>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        // Flush any remaining buffer
        if (buffer) {
          const events = parseSSEBody(buffer);
          for (const evt of events) controller.enqueue(evt);
        }
        controller.terminate();
        return;
      }
      buffer += value;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const parsed = parseSSELine(line);
        if (parsed) controller.enqueue(parsed);
      }
    },
    cancel() {
      reader.releaseLock();
    },
  });
}

// ---------------------------------------------------------------------------
// Stream aggregation
// ---------------------------------------------------------------------------

export interface AggregatedChunk {
  content: string;
  done: boolean;
  chunks: StreamChunk[];
  providers: string[];
  models: string[];
  totalTokens: number;
}

/**
 * Aggregate multiple async generators into a single stream.
 * Yields aggregated chunks as each input stream progresses.
 */
export async function* aggregateStreams(
  ...streams: AsyncGenerator<StreamChunk>[]
): AsyncGenerator<AggregatedChunk> {
  const readers = streams.map((s) => s[Symbol.asyncIterator]());
  const results: (IteratorResult<StreamChunk> | null)[] = readers.map(() => null);
  let allDone = false;

  while (!allDone) {
    allDone = true;
    const aggregated: AggregatedChunk = {
      content: "",
      done: false,
      chunks: [],
      providers: [],
      models: [],
      totalTokens: 0,
    };

    for (let i = 0; i < readers.length; i++) {
      if (results[i] === null || (!results[i]!.done && results[i]!.value.done)) {
        // Fetch next from this stream
        try {
          results[i] = await readers[i].next();
        } catch {
          results[i] = { done: true, value: { delta: "", done: true } };
        }
      }

      const result = results[i]!;
      if (!result.done) {
        allDone = false;
        aggregated.chunks.push(result.value);
        aggregated.content += result.value.delta;
        if (result.value.usage) {
          aggregated.totalTokens += result.value.usage.total_tokens;
        }
      }
    }

    if (aggregated.chunks.length > 0) {
      yield aggregated;
    }

    if (allDone) {
      yield { ...aggregated, done: true };
    }
  }
}

// ---------------------------------------------------------------------------
// Streaming session metadata
// ---------------------------------------------------------------------------

export interface StreamingMetrics {
  /** Milliseconds from stream start to first non-empty delta */
  timeToFirstTokenMs: number;
  /** Milliseconds from stream start to completion */
  totalLatencyMs: number;
  /** Total tokens emitted (prompt + completion) */
  totalTokens: number;
  /** Tokens per second (completion only) */
  tokensPerSecond: number;
  /** Number of chunks received */
  chunkCount: number;
  /** Whether the stream completed normally */
  completed: boolean;
  /** Error message if the stream errored */
  error?: string;
}

export interface StreamingSessionOptions {
  workspaceId: string;
  model: string;
  provider: string;
}

/**
 * Wrap an async generator to collect streaming metrics automatically.
 * Returns both the decorated generator (yielding StreamChunk as normal)
 * and a promise for the final metrics.
 */
export function withStreamingMetrics(
  stream: AsyncGenerator<StreamChunk>,
  opts: StreamingSessionOptions,
): {
  stream: AsyncGenerator<StreamChunk>;
  metrics: Promise<StreamingMetrics>;
} {
  let resolveMetrics: (m: StreamingMetrics) => void;
  let rejectMetrics: (e: Error) => void;

  const metricsP = new Promise<StreamingMetrics>((resolve, reject) => {
    resolveMetrics = resolve;
    rejectMetrics = reject;
  });

  const startTime = Date.now();
  let firstTokenTime: number | null = null;
  let totalCompletionTokens = 0;
  let chunkCount = 0;
  let lastChunkTime = startTime;
  let lastError: string | undefined;

  async function* decorated(): AsyncGenerator<StreamChunk> {
    try {
      for await (const chunk of stream) {
        if (firstTokenTime === null && chunk.delta) {
          firstTokenTime = Date.now() - startTime;
        }
        if (chunk.usage) {
          totalCompletionTokens += chunk.usage.completion_tokens;
        }
        chunkCount++;
        lastChunkTime = Date.now();
        yield chunk;
      }

      const totalLatencyMs = Date.now() - startTime;
      const completionTimeMs = lastChunkTime - startTime;
      const tps =
        completionTimeMs > 0
          ? (totalCompletionTokens / completionTimeMs) * 1000
          : 0;

      resolveMetrics({
        timeToFirstTokenMs: firstTokenTime ?? totalLatencyMs,
        totalLatencyMs,
        totalTokens: totalCompletionTokens,
        tokensPerSecond: Math.round(tps * 100) / 100,
        chunkCount,
        completed: true,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const totalLatencyMs = Date.now() - startTime;
      resolveMetrics({
        timeToFirstTokenMs: firstTokenTime ?? totalLatencyMs,
        totalLatencyMs,
        totalTokens: totalCompletionTokens,
        tokensPerSecond: 0,
        chunkCount,
        completed: false,
        error: lastError,
      });
    }
  }

  return { stream: decorated(), metrics: metricsP };
}

// ---------------------------------------------------------------------------
// Stream transform helpers
// ---------------------------------------------------------------------------

/**
 * Transform a StreamChunk generator into a text-only generator.
 */
export async function* streamToText(
  stream: AsyncGenerator<StreamChunk>,
): AsyncGenerator<string> {
  for await (const chunk of stream) {
    if (chunk.delta) yield chunk.delta;
  }
}

/**
 * Collect all text from a StreamChunk generator.
 */
export async function collectStreamText(
  stream: AsyncGenerator<StreamChunk>,
): Promise<string> {
  let text = "";
  for await (const chunk of stream) {
    text += chunk.delta;
  }
  return text;
}
