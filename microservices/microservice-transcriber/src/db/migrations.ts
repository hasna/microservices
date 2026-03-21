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
  {
    id: 5,
    name: "add_transcript_comments",
    sql: `
      CREATE TABLE IF NOT EXISTS transcript_comments (
        id TEXT PRIMARY KEY,
        transcript_id TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'youtube',
        author TEXT,
        author_handle TEXT,
        comment_text TEXT NOT NULL,
        likes INTEGER DEFAULT 0,
        reply_count INTEGER DEFAULT 0,
        is_reply INTEGER DEFAULT 0,
        parent_comment_id TEXT,
        published_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_comments_transcript ON transcript_comments(transcript_id);
      CREATE INDEX IF NOT EXISTS idx_comments_likes ON transcript_comments(likes DESC);
    `,
  },
  {
    id: 6,
    name: "add_proofread_issues",
    sql: `
      CREATE TABLE proofread_issues (
        id TEXT PRIMARY KEY,
        transcript_id TEXT NOT NULL,
        issue_type TEXT NOT NULL CHECK(issue_type IN ('spelling','grammar','punctuation','clarity')),
        position_start INTEGER,
        position_end INTEGER,
        original_text TEXT NOT NULL,
        suggestion TEXT,
        confidence REAL,
        explanation TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','applied','dismissed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_proofread_transcript ON proofread_issues(transcript_id);
      CREATE INDEX idx_proofread_type ON proofread_issues(issue_type);
      CREATE INDEX idx_proofread_status ON proofread_issues(status);
    `,
  },
];
