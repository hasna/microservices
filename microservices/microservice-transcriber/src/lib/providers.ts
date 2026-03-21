/**
 * Transcription providers — ElevenLabs (default) and OpenAI Whisper.
 */

import { readFileSync, unlinkSync, existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { TranscriptChapterSegment, TranscriptMetadata, TranscriptProvider, TranscriptSpeakerSegment, TranscriptWord } from "../db/transcripts.js";
import type { VideoChapter } from "./downloader.js";
import { getAudioDuration, splitAudioIntoChunks } from "./downloader.js";

export interface TranscriptionResult {
  text: string;
  language: string;
  duration_seconds: number | null;
  metadata: TranscriptMetadata;
}

export interface TranscribeOptions {
  provider?: TranscriptProvider;
  language?: string;
  diarize?: boolean;
  vocab?: string[]; // custom vocabulary hints
  chunkDurationSec?: number; // override auto-chunk size (default: 600 = 10 min)
}

const AUTO_CHUNK_THRESHOLD_SEC = 600; // 10 minutes

/**
 * Transcribe an audio file using the specified provider.
 * Auto-chunks files longer than 10 minutes — splits into segments,
 * transcribes each, then combines results with correct timestamp offsets.
 */
export async function transcribeFile(
  filePath: string,
  options: TranscribeOptions = {}
): Promise<TranscriptionResult> {
  const provider = options.provider ?? "elevenlabs";
  const chunkDuration = options.chunkDurationSec ?? AUTO_CHUNK_THRESHOLD_SEC;

  // Check duration — auto-chunk if long
  let duration: number;
  try {
    duration = await getAudioDuration(filePath);
  } catch {
    duration = 0; // can't probe — just send it as-is
  }

  if (duration > chunkDuration) {
    return transcribeChunked(filePath, duration, chunkDuration, options);
  }

  return transcribeSingle(filePath, options);
}

async function transcribeSingle(
  filePath: string,
  options: TranscribeOptions
): Promise<TranscriptionResult> {
  const provider = options.provider ?? "elevenlabs";

  if (provider === "elevenlabs") {
    return transcribeWithElevenLabs(filePath, options.language, options.diarize, options.vocab);
  } else if (provider === "openai") {
    return transcribeWithOpenAI(filePath, options.language, options.vocab);
  } else if (provider === "deepgram") {
    return transcribeWithDeepGram(filePath, options.language, options.diarize, options.vocab);
  }

  throw new Error(`Unknown provider: ${provider}`);
}

/**
 * Chunk-based transcription: splits audio, transcribes each chunk,
 * combines text and word arrays with correct timestamp offsets.
 */
async function transcribeChunked(
  filePath: string,
  totalDuration: number,
  chunkDuration: number,
  options: TranscribeOptions
): Promise<TranscriptionResult> {
  const chunks = await splitAudioIntoChunks(filePath, chunkDuration);

  const allTexts: string[] = [];
  const allWords: TranscriptWord[] = [];
  let language = "en";
  let model: string | undefined;
  let diarized = false;
  const allSpeakers: TranscriptSpeakerSegment[] = [];

  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const result = await transcribeSingle(chunk.path, options);

      allTexts.push(result.text);
      language = result.language;
      model = result.metadata.model;
      if (result.metadata.diarized) diarized = true;

      // Offset word timestamps by chunk start position
      if (result.metadata.words) {
        for (const w of result.metadata.words) {
          allWords.push({
            ...w,
            start: w.start + chunk.startOffset,
            end: w.end + chunk.startOffset,
          });
        }
      }

      // Offset speaker segments
      if (result.metadata.speakers) {
        for (const s of result.metadata.speakers) {
          allSpeakers.push({
            ...s,
            start: s.start + chunk.startOffset,
            end: s.end + chunk.startOffset,
          });
        }
      }
    }
  } finally {
    // Clean up chunk temp files (don't delete original)
    for (const chunk of chunks) {
      if (chunk.path !== filePath) {
        try { if (existsSync(chunk.path)) unlinkSync(chunk.path); } catch {}
      }
    }
  }

  const combinedText = allTexts.join("\n\n");

  return {
    text: combinedText,
    language,
    duration_seconds: totalDuration,
    metadata: {
      model,
      words: allWords.length > 0 ? allWords : undefined,
      speakers: allSpeakers.length > 0 ? allSpeakers : undefined,
      ...(diarized ? { diarized: true } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// ElevenLabs
// ---------------------------------------------------------------------------

async function transcribeWithElevenLabs(
  filePath: string,
  language?: string,
  diarize?: boolean,
  vocab?: string[]
): Promise<TranscriptionResult> {
  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");

  const fileName = basename(filePath);
  const fileSize = statSync(filePath).size;
  if (fileSize === 0) throw new Error(`Audio file is empty: ${filePath}`);

  // Use Bun.file() for proper streaming file upload (handles large files correctly)
  const audioFile = Bun.file(filePath);

  const form = new FormData();
  form.append("file", audioFile, fileName);
  form.append("model_id", "scribe_v1");
  form.append("timestamps_granularity", "word");
  if (language) form.append("language_code", language);
  if (diarize) form.append("diarize", "true");
  if (vocab && vocab.length > 0) {
    // ElevenLabs accepts custom_spelling as JSON array of {from, to} for custom vocab
    form.append("custom_spelling", JSON.stringify(vocab.map((v) => ({ from: v.toLowerCase(), to: v }))));
  }

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    text: string;
    language_code: string;
    language_probability: number;
    words?: Array<{ text: string; type: string; start: number; end: number; speaker_id?: string; logprob?: number }>;
  };

  const words = (data.words ?? [])
    .filter((w) => w.type === "word")
    .map((w) => ({
      text: w.text,
      start: w.start,
      end: w.end,
      type: w.type,
      speaker_id: w.speaker_id,
      ...(w.logprob !== undefined ? { logprob: w.logprob } : {}),
    }));

  const duration = words.length > 0 ? words[words.length - 1].end : null;

  // Build speaker segments and formatted text when diarized
  let text = data.text;
  let speakers: TranscriptSpeakerSegment[] | undefined;

  if (diarize && words.some((w) => w.speaker_id)) {
    speakers = buildSpeakerSegments(words);
    text = formatDiarizedText(speakers);
  }

  return {
    text,
    language: data.language_code ?? language ?? "en",
    duration_seconds: duration,
    metadata: {
      model: "scribe_v1",
      words,
      speakers,
      language_probability: data.language_probability,
      ...(diarize ? { diarized: true } : {}),
    },
  };
}

function buildSpeakerSegments(
  words: Array<{ text: string; start: number; end: number; speaker_id?: string }>
): TranscriptSpeakerSegment[] {
  const segments: TranscriptSpeakerSegment[] = [];
  let current: TranscriptSpeakerSegment | null = null;

  for (const word of words) {
    const speakerId = word.speaker_id ?? "speaker_unknown";
    if (!current || current.speaker_id !== speakerId) {
      if (current) segments.push(current);
      current = { speaker_id: speakerId, start: word.start, end: word.end, text: word.text };
    } else {
      current.end = word.end;
      current.text += " " + word.text;
    }
  }
  if (current) segments.push(current);
  return segments;
}

function formatDiarizedText(segments: TranscriptSpeakerSegment[]): string {
  return segments
    .map((s) => {
      // Convert "speaker_0" → "Speaker 1" (1-indexed for readability)
      const label = s.speaker_id.replace(/speaker_(\d+)/, (_, n) => `Speaker ${parseInt(n) + 1}`);
      return `${label}: ${s.text}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// OpenAI Whisper
// ---------------------------------------------------------------------------

async function transcribeWithOpenAI(
  filePath: string,
  language?: string,
  vocab?: string[]
): Promise<TranscriptionResult> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const fileName = basename(filePath);
  const audioFile = Bun.file(filePath);

  const form = new FormData();
  form.append("file", audioFile, fileName);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  if (language) form.append("language", language);
  if (vocab && vocab.length > 0) {
    // OpenAI Whisper uses prompt field for vocabulary hints
    form.append("prompt", vocab.join(", "));
  }

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    text: string;
    language: string;
    duration: number;
    words?: Array<{ word: string; start: number; end: number }>;
    segments?: Array<{ start: number; end: number; text: string }>;
  };

  const words = (data.words ?? []).map((w) => ({
    text: w.word,
    start: w.start,
    end: w.end,
  }));

  const segments = (data.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text,
  }));

  return {
    text: data.text,
    language: data.language ?? language ?? "en",
    duration_seconds: data.duration ?? null,
    metadata: {
      model: "whisper-1",
      words,
      segments,
    },
  };
}

// ---------------------------------------------------------------------------
// Provider availability check
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cost calculation
// ---------------------------------------------------------------------------

// Rates per minute (approximate, as of 2025)
const COST_PER_MINUTE: Record<string, number> = {
  elevenlabs: 0.40 / 60,  // ~$0.40/hr = $0.00667/min
  openai: 0.006,           // $0.006/min for Whisper
};

/**
 * Estimate transcription cost in USD based on provider and duration.
 */
export function estimateCost(provider: string, durationSeconds: number): number {
  const rate = COST_PER_MINUTE[provider] ?? 0;
  return Math.round(rate * (durationSeconds / 60) * 10000) / 10000; // 4 decimal places
}

export function checkProviders(): { elevenlabs: boolean; openai: boolean; deepgram: boolean } {
  return {
    elevenlabs: !!process.env["ELEVENLABS_API_KEY"],
    openai: !!process.env["OPENAI_API_KEY"],
    deepgram: !!process.env["DEEPGRAM_API_KEY"],
  };
}

// ---------------------------------------------------------------------------
// DeepGram
// ---------------------------------------------------------------------------

async function transcribeWithDeepGram(
  filePath: string,
  language?: string,
  diarize?: boolean,
  vocab?: string[]
): Promise<TranscriptionResult> {
  const apiKey = process.env["DEEPGRAM_API_KEY"];
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not set");

  const audioData = await Bun.file(filePath).arrayBuffer();

  const params = new URLSearchParams({
    model: "nova-3",
    smart_format: "true",
    punctuate: "true",
    utterances: "true",
  });
  if (language) params.set("language", language);
  if (diarize) params.set("diarize", "true");
  if (vocab && vocab.length > 0) params.set("keywords", vocab.join(":5,") + ":5");

  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "audio/mpeg",
    },
    body: audioData,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepGram API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    results: {
      channels: Array<{
        alternatives: Array<{
          transcript: string;
          words: Array<{ word: string; start: number; end: number; speaker?: number; confidence: number }>;
        }>;
      }>;
      utterances?: Array<{ start: number; end: number; transcript: string; speaker: number }>;
    };
    metadata: { duration: number; language?: string };
  };

  const alt = data.results.channels[0]?.alternatives[0];
  if (!alt) throw new Error("DeepGram returned no results");

  const words = alt.words.map((w) => ({
    text: w.word,
    start: w.start,
    end: w.end,
    ...(w.speaker !== undefined ? { speaker_id: `speaker_${w.speaker}` } : {}),
    logprob: Math.log(w.confidence), // convert confidence to logprob
  }));

  let text = alt.transcript;
  let speakers: TranscriptSpeakerSegment[] | undefined;

  if (diarize && data.results.utterances) {
    speakers = data.results.utterances.map((u) => ({
      speaker_id: `speaker_${u.speaker}`,
      start: u.start,
      end: u.end,
      text: u.transcript,
    }));
    text = speakers.map((s) => {
      const label = s.speaker_id.replace(/speaker_(\d+)/, (_, n) => `Speaker ${parseInt(n) + 1}`);
      return `${label}: ${s.text}`;
    }).join("\n");
  }

  return {
    text,
    language: data.metadata.language ?? language ?? "en",
    duration_seconds: data.metadata.duration ?? null,
    metadata: {
      model: "nova-3",
      words,
      speakers,
      ...(diarize ? { diarized: true } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Markdown export helper
// ---------------------------------------------------------------------------

import type { Transcript } from "../db/transcripts.js";

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Export a transcript as formatted Markdown.
 * Chapters become ## headings, speaker labels are **bolded**, timestamps inline.
 */
export function toMarkdown(t: Transcript): string {
  const lines: string[] = [];

  // Title
  lines.push(`# ${t.title ?? "Transcript"}`);
  lines.push("");

  // Metadata
  if (t.source_url) lines.push(`> Source: ${t.source_url}`);
  if (t.duration_seconds) lines.push(`> Duration: ${formatTimestamp(t.duration_seconds)}`);
  if (t.provider) lines.push(`> Provider: ${t.provider}`);
  lines.push("");

  // Summary
  if (t.metadata?.summary) {
    lines.push("## Summary", "", t.metadata.summary, "");
  }

  // Chapters with text
  if (t.metadata?.chapters && t.metadata.chapters.length > 0) {
    for (const ch of t.metadata.chapters) {
      lines.push(`## ${ch.title}`, "");
      lines.push(`_[${formatTimestamp(ch.start_time)}]_`, "");
      // Format text with speaker labels bolded
      const formatted = ch.text.replace(/(Speaker \d+|[A-Z][a-z]+ [A-Z][a-z]+):/g, "\n\n**$1:**");
      lines.push(formatted.trim(), "");
    }
  } else if (t.metadata?.speakers && t.metadata.speakers.length > 0) {
    // Diarized without chapters — use speaker segments
    for (const seg of t.metadata.speakers) {
      const label = seg.speaker_id.replace(/speaker_(\d+)/, (_, n) => `Speaker ${parseInt(n) + 1}`);
      const ts = formatTimestamp(seg.start);
      lines.push(`**${label}** _[${ts}]_: ${seg.text}`, "");
    }
  } else if (t.transcript_text) {
    // Plain text — bold any speaker labels
    const formatted = t.transcript_text.replace(/(Speaker \d+|[A-Z][a-z]+ [A-Z][a-z]+):/g, "\n\n**$1:**");
    lines.push(formatted.trim());
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// SRT export helper
// ---------------------------------------------------------------------------

export function toSrt(words: Array<{ text: string; start: number; end: number }>): string {
  if (words.length === 0) return "";

  const lines: string[] = [];
  const chunkSize = 10; // words per subtitle block
  let idx = 1;

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    const start = formatSrtTime(chunk[0].start);
    const end = formatSrtTime(chunk[chunk.length - 1].end);
    const text = chunk.map((w) => w.text).join(" ");
    lines.push(`${idx}\n${start} --> ${end}\n${text}\n`);
    idx++;
  }

  return lines.join("\n");
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Chapter segmentation helper
// ---------------------------------------------------------------------------

/**
 * Map word-level timestamps to video chapters, producing chapter-labelled segments.
 * Words that don't fall cleanly within any chapter are attributed to the nearest chapter.
 */
export function segmentByChapters(
  words: Array<{ text: string; start: number; end: number }>,
  chapters: VideoChapter[]
): TranscriptChapterSegment[] {
  if (chapters.length === 0 || words.length === 0) return [];

  const segments: TranscriptChapterSegment[] = chapters.map((ch) => ({
    title: ch.title,
    start_time: ch.start_time,
    end_time: ch.end_time,
    text: "",
  }));

  for (const word of words) {
    // Find chapter that contains the word's midpoint
    const mid = (word.start + word.end) / 2;
    let idx = segments.findIndex((s) => mid >= s.start_time && mid < s.end_time);
    // Fall back to last chapter if midpoint is beyond last chapter end
    if (idx === -1) idx = segments.length - 1;
    segments[idx].text = segments[idx].text ? segments[idx].text + " " + word.text : word.text;
  }

  return segments.filter((s) => s.text.length > 0);
}

// ---------------------------------------------------------------------------
// VTT (WebVTT) export helper
// ---------------------------------------------------------------------------

export function toVtt(words: Array<{ text: string; start: number; end: number }>): string {
  if (words.length === 0) return "WEBVTT\n";

  const lines: string[] = ["WEBVTT", ""];
  const chunkSize = 10;

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    const start = formatVttTime(chunk[0].start);
    const end = formatVttTime(chunk[chunk.length - 1].end);
    const text = chunk.map((w) => w.text).join(" ");
    lines.push(`${start} --> ${end}`, text, "");
  }

  return lines.join("\n");
}

function formatVttTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  // VTT omits hours if zero, uses . not ,
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// ASS (Advanced SubStation Alpha) export helper
// ---------------------------------------------------------------------------

export interface AssStyle {
  fontName?: string;    // default: "Arial"
  fontSize?: number;    // default: 20
  color?: string;       // hex RGB e.g. "FFFFFF" or "#FFFFFF" (default: white)
  outline?: number;     // default: 2
  shadow?: number;      // default: 1
}

/**
 * Convert #RRGGBB or RRGGBB hex to ASS &HAABBGGRR color (alpha=00=opaque).
 */
function hexToAssColor(hex: string): string {
  const clean = hex.replace("#", "").padStart(6, "0");
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  // ASS uses centiseconds (2 digits)
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Confidence filtering helper
// ---------------------------------------------------------------------------

/**
 * Rebuild transcript text with low-confidence words wrapped in [?..?] markers.
 * Only applies to ElevenLabs transcripts that have logprob on words.
 *
 * @param words - word array with optional logprob
 * @param threshold - confidence threshold 0.0–1.0 (default 0.7). Words below this are flagged.
 */
export function formatWithConfidence(
  words: Array<{ text: string; logprob?: number }>,
  threshold = 0.7
): string {
  return words
    .map((w) => {
      if (w.logprob === undefined) return w.text;
      const confidence = Math.exp(w.logprob);
      return confidence < threshold ? `[?${w.text}?]` : w.text;
    })
    .join(" ");
}

export function toAss(
  words: Array<{ text: string; start: number; end: number }>,
  style: AssStyle = {}
): string {
  if (words.length === 0) return "";

  const fontName = style.fontName ?? "Arial";
  const fontSize = style.fontSize ?? 20;
  const primaryColor = hexToAssColor(style.color ?? "FFFFFF");
  const outline = style.outline ?? 2;
  const shadow = style.shadow ?? 1;

  const scriptInfo = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 384",
    "PlayResY: 288",
    "ScaledBorderAndShadow: yes",
    "",
  ].join("\n");

  const stylesSection = [
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},${fontSize},${primaryColor},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,${outline},${shadow},2,10,10,10,1`,
    "",
  ].join("\n");

  const eventsHeader = [
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const chunkSize = 10;
  const dialogues: string[] = [];

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    const start = formatAssTime(chunk[0].start);
    const end = formatAssTime(chunk[chunk.length - 1].end);
    const text = chunk.map((w) => w.text).join(" ");
    dialogues.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
  }

  return [scriptInfo, stylesSection, eventsHeader, ...dialogues].join("\n");
}
