export interface MigrationEntry {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: MigrationEntry[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        title TEXT,
        source_url TEXT,
        source_type TEXT NOT NULL DEFAULT 'file',
        provider TEXT NOT NULL DEFAULT 'elevenlabs',
        language TEXT DEFAULT 'en',
        status TEXT NOT NULL DEFAULT 'pending',
        transcript_text TEXT,
        error_message TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        duration_seconds REAL,
        word_count INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_transcripts_status ON transcripts(status);
      CREATE INDEX IF NOT EXISTS idx_transcripts_source_type ON transcripts(source_type);
      CREATE INDEX IF NOT EXISTS idx_transcripts_provider ON transcripts(provider);
      CREATE INDEX IF NOT EXISTS idx_transcripts_created_at ON transcripts(created_at);
    `,
  },
  {
    id: 2,
    name: "add_source_transcript_id",
    sql: `
      ALTER TABLE transcripts ADD COLUMN source_transcript_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_transcripts_source_transcript_id ON transcripts(source_transcript_id);
    `,
  },
  {
    id: 3,
    name: "add_transcript_tags",
    sql: `
      CREATE TABLE IF NOT EXISTS transcript_tags (
        transcript_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (transcript_id, tag),
        FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_transcript_tags_tag ON transcript_tags(tag);
    `,
  },
  {
    id: 4,
    name: "add_annotations",
    sql: `
      CREATE TABLE IF NOT EXISTS annotations (
        id TEXT PRIMARY KEY,
        transcript_id TEXT NOT NULL,
        timestamp_sec REAL NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_annotations_transcript ON annotations(transcript_id);
    `,
  },
];
