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
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT CHECK(type IN ('image','video','document','audio','template','logo','font','other')),
        file_path TEXT,
        file_size INTEGER,
        mime_type TEXT,
        dimensions TEXT,
        tags TEXT DEFAULT '[]',
        category TEXT,
        metadata TEXT DEFAULT '{}',
        uploaded_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS collection_assets (
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (collection_id, asset_id)
      );

      CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name);
      CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
      CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category);
      CREATE INDEX IF NOT EXISTS idx_assets_uploaded_by ON assets(uploaded_by);
      CREATE INDEX IF NOT EXISTS idx_collections_name ON collections(name);
      CREATE INDEX IF NOT EXISTS idx_collection_assets_asset ON collection_assets(asset_id);
    `,
  },
];
