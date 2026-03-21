import { getDatabase } from "./database.js";

export type TranscriptStatus = "pending" | "processing" | "completed" | "failed";
export type TranscriptProvider = "elevenlabs" | "openai" | "deepgram";
export type TranscriptSourceType = "file" | "youtube" | "vimeo" | "wistia" | "url" | "translated";

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  type?: string;
  speaker_id?: string;
  logprob?: number; // log probability from ElevenLabs; confidence = Math.exp(logprob)
}

export interface TranscriptSpeakerSegment {
  speaker_id: string;
  start: number;
  end: number;
  text: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptChapterSegment {
  title: string;
  start_time: number;
  end_time: number;
  text: string;
}

export interface TranscriptMetadata {
  model?: string;
  words?: TranscriptWord[];
  segments?: TranscriptSegment[];
  speakers?: TranscriptSpeakerSegment[];
  chapters?: TranscriptChapterSegment[];
  language_probability?: number;
  trim_start?: number;
  trim_end?: number;
  diarized?: boolean;
  summary?: string;
  highlights?: Array<{ quote: string; speaker?: string; context: string }>;
  meeting_notes?: string;
  cost_usd?: number;
}

export interface Transcript {
  id: string;
  title: string | null;
  source_url: string | null;
  source_type: TranscriptSourceType;
  provider: TranscriptProvider;
  language: string;
  status: TranscriptStatus;
  transcript_text: string | null;
  error_message: string | null;
  metadata: TranscriptMetadata;
  created_at: string;
  updated_at: string;
  duration_seconds: number | null;
  word_count: number | null;
  source_transcript_id: string | null;
}

export interface CreateTranscriptInput {
  source_url: string;
  source_type: TranscriptSourceType;
  provider?: TranscriptProvider;
  language?: string;
  title?: string;
  source_transcript_id?: string;
}

export interface UpdateTranscriptInput {
  title?: string;
  status?: TranscriptStatus;
  transcript_text?: string;
  error_message?: string | null;
  metadata?: TranscriptMetadata;
  duration_seconds?: number;
  word_count?: number;
}

export interface ListTranscriptsOptions {
  status?: TranscriptStatus;
  provider?: TranscriptProvider;
  source_type?: TranscriptSourceType;
  limit?: number;
  offset?: number;
}

interface TranscriptRow {
  id: string;
  title: string | null;
  source_url: string | null;
  source_type: string;
  provider: string;
  language: string;
  status: string;
  transcript_text: string | null;
  error_message: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
  duration_seconds: number | null;
  word_count: number | null;
  source_transcript_id: string | null;
}

function rowToTranscript(row: TranscriptRow): Transcript {
  return {
    ...row,
    source_type: row.source_type as TranscriptSourceType,
    provider: row.provider as TranscriptProvider,
    status: row.status as TranscriptStatus,
    metadata: JSON.parse(row.metadata || "{}"),
    source_transcript_id: row.source_transcript_id ?? null,
  };
}

function now(): string {
  return new Date().toISOString();
}

export function createTranscript(input: CreateTranscriptInput): Transcript {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const ts = now();

  db.prepare(`
    INSERT INTO transcripts (id, title, source_url, source_type, provider, language, status, metadata, created_at, updated_at, source_transcript_id)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', '{}', ?, ?, ?)
  `).run(
    id,
    input.title ?? null,
    input.source_url,
    input.source_type,
    input.provider ?? "elevenlabs",
    input.language ?? "en",
    ts,
    ts,
    input.source_transcript_id ?? null
  );

  return getTranscript(id)!;
}

export function getTranscript(id: string): Transcript | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM transcripts WHERE id = ?").get(id) as TranscriptRow | null;
  return row ? rowToTranscript(row) : null;
}

export function updateTranscript(id: string, input: UpdateTranscriptInput): Transcript | null {
  const db = getDatabase();
  const existing = getTranscript(id);
  if (!existing) return null;

  const fields: string[] = ["updated_at = ?"];
  const values: unknown[] = [now()];

  if (input.title !== undefined) { fields.push("title = ?"); values.push(input.title); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.transcript_text !== undefined) { fields.push("transcript_text = ?"); values.push(input.transcript_text); }
  if (input.error_message !== undefined) { fields.push("error_message = ?"); values.push(input.error_message); }
  if (input.metadata !== undefined) { fields.push("metadata = ?"); values.push(JSON.stringify(input.metadata)); }
  if (input.duration_seconds !== undefined) { fields.push("duration_seconds = ?"); values.push(input.duration_seconds); }
  if (input.word_count !== undefined) { fields.push("word_count = ?"); values.push(input.word_count); }

  values.push(id);
  db.prepare(`UPDATE transcripts SET ${fields.join(", ")} WHERE id = ?`).run(...values);

  return getTranscript(id);
}

export function deleteTranscript(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM transcripts WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listTranscripts(options: ListTranscriptsOptions = {}): Transcript[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (options.status) { conditions.push("status = ?"); values.push(options.status); }
  if (options.provider) { conditions.push("provider = ?"); values.push(options.provider); }
  if (options.source_type) { conditions.push("source_type = ?"); values.push(options.source_type); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const rows = db
    .prepare(`SELECT * FROM transcripts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...values, limit, offset) as TranscriptRow[];

  return rows.map(rowToTranscript);
}

export function searchTranscripts(query: string): Transcript[] {
  const db = getDatabase();
  const q = `%${query}%`;
  const rows = db
    .prepare(`
      SELECT * FROM transcripts
      WHERE transcript_text LIKE ?
         OR title LIKE ?
         OR source_url LIKE ?
      ORDER BY created_at DESC
      LIMIT 50
    `)
    .all(q, q, q) as TranscriptRow[];
  return rows.map(rowToTranscript);
}

/**
 * Rename speakers in a transcript. Replaces labels in transcript_text,
 * metadata.speakers[].speaker_id, and metadata.words[].speaker_id.
 */
export function renameSpeakers(
  id: string,
  mapping: Record<string, string> // e.g. {"Speaker 1": "Andrej Karpathy", "Speaker 2": "Sarah Guo"}
): Transcript | null {
  const t = getTranscript(id);
  if (!t) return null;

  // Replace in transcript_text
  let text = t.transcript_text ?? "";
  for (const [from, to] of Object.entries(mapping)) {
    text = text.replaceAll(`${from}:`, `${to}:`);
  }

  // Replace in metadata.speakers
  const speakers = t.metadata.speakers?.map((s) => ({
    ...s,
    speaker_id: mapping[s.speaker_id] ?? mapping[s.speaker_id.replace(/speaker_(\d+)/, (_, n) => `Speaker ${parseInt(n) + 1}`)] ?? s.speaker_id,
  }));

  // Replace in metadata.words
  const words = t.metadata.words?.map((w) => {
    if (!w.speaker_id) return w;
    const label = w.speaker_id.replace(/speaker_(\d+)/, (_, n) => `Speaker ${parseInt(n) + 1}`);
    const newId = mapping[label] ?? mapping[w.speaker_id] ?? w.speaker_id;
    return { ...w, speaker_id: newId };
  });

  return updateTranscript(id, {
    transcript_text: text,
    metadata: { ...t.metadata, speakers, words },
  });
}

/**
 * Find a completed transcript by source URL (for duplicate detection).
 */
export function findBySourceUrl(sourceUrl: string): Transcript | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM transcripts WHERE source_url = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1")
    .get(sourceUrl) as TranscriptRow | null;
  return row ? rowToTranscript(row) : null;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export function addTags(transcriptId: string, tags: string[]): string[] {
  const db = getDatabase();
  const stmt = db.prepare("INSERT OR IGNORE INTO transcript_tags (transcript_id, tag) VALUES (?, ?)");
  for (const tag of tags) {
    stmt.run(transcriptId, tag.toLowerCase().trim());
  }
  return getTags(transcriptId);
}

export function removeTags(transcriptId: string, tags: string[]): string[] {
  const db = getDatabase();
  const stmt = db.prepare("DELETE FROM transcript_tags WHERE transcript_id = ? AND tag = ?");
  for (const tag of tags) {
    stmt.run(transcriptId, tag.toLowerCase().trim());
  }
  return getTags(transcriptId);
}

export function getTags(transcriptId: string): string[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT tag FROM transcript_tags WHERE transcript_id = ? ORDER BY tag")
    .all(transcriptId) as { tag: string }[];
  return rows.map((r) => r.tag);
}

export function listAllTags(): Array<{ tag: string; count: number }> {
  const db = getDatabase();
  return db
    .prepare("SELECT tag, COUNT(*) as count FROM transcript_tags GROUP BY tag ORDER BY count DESC")
    .all() as Array<{ tag: string; count: number }>;
}

export function listTranscriptsByTag(tag: string, limit = 50): Transcript[] {
  const db = getDatabase();
  const rows = db
    .prepare(`
      SELECT t.* FROM transcripts t
      JOIN transcript_tags tt ON t.id = tt.transcript_id
      WHERE tt.tag = ?
      ORDER BY t.created_at DESC LIMIT ?
    `)
    .all(tag.toLowerCase().trim(), limit) as TranscriptRow[];
  return rows.map(rowToTranscript);
}

export interface SearchMatch {
  transcript_id: string;
  title: string | null;
  timestamp: string | null; // [MM:SS] if word timestamps available
  excerpt: string;          // matching text with surrounding context
}

/**
 * Search transcripts with surrounding context and timestamps.
 * Returns excerpts with `contextSentences` sentences before/after each match.
 */
export function searchWithContext(query: string, contextSentences = 2): SearchMatch[] {
  const transcripts = searchTranscripts(query);
  const matches: SearchMatch[] = [];

  for (const t of transcripts) {
    if (!t.transcript_text) continue;

    // Split into sentences
    const sentences = t.transcript_text.split(/(?<=[.!?])\s+|(?<=\n)\s*/g).filter(Boolean);
    const q = query.toLowerCase();

    for (let i = 0; i < sentences.length; i++) {
      if (!sentences[i].toLowerCase().includes(q)) continue;

      // Gather context window
      const start = Math.max(0, i - contextSentences);
      const end = Math.min(sentences.length, i + contextSentences + 1);
      const excerpt = sentences.slice(start, end).join(" ");

      // Find timestamp from word data
      let timestamp: string | null = null;
      if (t.metadata?.words) {
        const matchWords = query.toLowerCase().split(/\s+/);
        const firstWord = matchWords[0];
        const wordEntry = t.metadata.words.find((w) => w.text.toLowerCase().includes(firstWord));
        if (wordEntry) {
          const m = Math.floor(wordEntry.start / 60);
          const s = Math.floor(wordEntry.start % 60);
          timestamp = `[${m}:${String(s).padStart(2, "0")}]`;
        }
      }

      matches.push({
        transcript_id: t.id,
        title: t.title,
        timestamp,
        excerpt: excerpt.length > 300 ? excerpt.slice(0, 300) + "…" : excerpt,
      });

      break; // one match per transcript
    }
  }

  return matches;
}

export function countTranscripts(): { total: number; by_status: Record<string, number>; by_provider: Record<string, number> } {
  const db = getDatabase();
  const total = (db.prepare("SELECT COUNT(*) as n FROM transcripts").get() as { n: number }).n;

  const byStatus = db
    .prepare("SELECT status, COUNT(*) as n FROM transcripts GROUP BY status")
    .all() as { status: string; n: number }[];

  const byProvider = db
    .prepare("SELECT provider, COUNT(*) as n FROM transcripts GROUP BY provider")
    .all() as { provider: string; n: number }[];

  return {
    total,
    by_status: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    by_provider: Object.fromEntries(byProvider.map((r) => [r.provider, r.n])),
  };
}
