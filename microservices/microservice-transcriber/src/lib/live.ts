/**
 * Live/streaming transcription — record from microphone via ffmpeg,
 * chunk into segments, transcribe each as they complete.
 */

import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TranscribeOptions } from "./providers.js";
import { transcribeFile } from "./providers.js";

export interface LiveTranscribeOptions extends TranscribeOptions {
  chunkDurationSec?: number; // seconds per chunk (default: 30)
  onChunk?: (text: string, chunkIndex: number) => void;
  onError?: (error: Error, chunkIndex: number) => void;
}

/**
 * Record from default audio input and transcribe in real-time.
 * Returns a controller to stop recording.
 *
 * Uses ffmpeg with avfoundation (macOS) or alsa/pulse (Linux).
 * Each chunk is saved, transcribed, then deleted.
 */
export function startLiveTranscription(options: LiveTranscribeOptions = {}): {
  stop: () => Promise<{ fullText: string; chunks: string[] }>;
} {
  const chunkDuration = options.chunkDurationSec ?? 30;
  const sessionId = crypto.randomUUID().slice(0, 8);
  const chunks: string[] = [];
  let chunkIndex = 0;
  let stopped = false;
  let currentProc: ReturnType<typeof Bun.spawn> | null = null;
  let resolveStop: ((value: { fullText: string; chunks: string[] }) => void) | null = null;

  const processChunk = async (chunkPath: string, idx: number) => {
    if (!existsSync(chunkPath)) return;
    try {
      const result = await transcribeFile(chunkPath, {
        provider: options.provider,
        language: options.language,
        diarize: options.diarize,
      });
      chunks.push(result.text);
      options.onChunk?.(result.text, idx);
    } catch (err) {
      options.onError?.(err instanceof Error ? err : new Error(String(err)), idx);
    } finally {
      try { unlinkSync(chunkPath); } catch {}
    }
  };

  const recordLoop = async () => {
    while (!stopped) {
      const chunkPath = join(tmpdir(), `live-${sessionId}-${chunkIndex}.wav`);
      const idx = chunkIndex++;

      // Detect platform for audio input
      const isLinux = process.platform === "linux";
      const inputArgs = isLinux
        ? ["-f", "pulse", "-i", "default"]
        : ["-f", "avfoundation", "-i", ":0"]; // macOS default mic

      currentProc = Bun.spawn(
        ["ffmpeg", "-y", ...inputArgs, "-t", String(chunkDuration), "-ac", "1", "-ar", "16000", chunkPath],
        { stdout: "pipe", stderr: "pipe" }
      );

      await currentProc.exited;
      currentProc = null;

      if (stopped && !existsSync(chunkPath)) break;

      // Transcribe the chunk (don't await — let it process while next chunk records)
      processChunk(chunkPath, idx);
    }

    // Wait for any pending transcriptions to settle
    await new Promise((r) => setTimeout(r, 500));
    resolveStop?.({ fullText: chunks.join(" "), chunks });
  };

  // Start recording in background
  recordLoop();

  return {
    stop: () => {
      stopped = true;
      // Kill current ffmpeg recording
      try { currentProc?.kill(); } catch {}
      return new Promise((resolve) => { resolveStop = resolve; });
    },
  };
}
