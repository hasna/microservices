import { getDatabase } from "./database.js";

export interface Annotation {
  id: string;
  transcript_id: string;
  timestamp_sec: number;
  note: string;
  created_at: string;
}

export function createAnnotation(transcriptId: string, timestampSec: number, note: string): Annotation {
  const db = getDatabase();
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO annotations (id, transcript_id, timestamp_sec, note) VALUES (?, ?, ?, ?)").run(id, transcriptId, timestampSec, note);
  return getAnnotation(id)!;
}

export function getAnnotation(id: string): Annotation | null {
  const db = getDatabase();
  return db.prepare("SELECT * FROM annotations WHERE id = ?").get(id) as Annotation | null;
}

export function listAnnotations(transcriptId: string): Annotation[] {
  const db = getDatabase();
  return db.prepare("SELECT * FROM annotations WHERE transcript_id = ? ORDER BY timestamp_sec ASC").all(transcriptId) as Annotation[];
}

export function deleteAnnotation(id: string): boolean {
  const db = getDatabase();
  return db.prepare("DELETE FROM annotations WHERE id = ?").run(id).changes > 0;
}

export function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
