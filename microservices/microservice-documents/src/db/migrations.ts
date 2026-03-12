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
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        file_path TEXT,
        file_type TEXT,
        file_size INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'archived')),
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS document_versions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        file_path TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS document_tags (
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (document_id, tag)
      );

      CREATE INDEX IF NOT EXISTS idx_documents_title ON documents(title);
      CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
      CREATE INDEX IF NOT EXISTS idx_documents_file_type ON documents(file_type);
      CREATE INDEX IF NOT EXISTS idx_document_versions_document ON document_versions(document_id);
      CREATE INDEX IF NOT EXISTS idx_document_tags_tag ON document_tags(tag);
    `,
  },
];
