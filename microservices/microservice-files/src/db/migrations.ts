/**
 * PostgreSQL migrations for microservice-files.
 * All tables live in the `files` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS files`;

  await sql`
    CREATE TABLE IF NOT EXISTS files._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_folders", migration001);
  await runMigration(sql, "002_files", migration002);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>
): Promise<void> {
  const [existing] = await sql`SELECT id FROM files._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx) => {
    await fn(tx);
    await tx`INSERT INTO files._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE files.folders (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID,
      name         TEXT NOT NULL,
      parent_id    UUID REFERENCES files.folders(id) ON DELETE CASCADE,
      path         TEXT NOT NULL,
      created_by   UUID,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON files.folders (workspace_id)`;
  await sql`CREATE INDEX ON files.folders (parent_id)`;
}

async function migration002(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE files.files (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id  UUID,
      folder_id     UUID REFERENCES files.folders(id) ON DELETE SET NULL,
      name          TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type     TEXT NOT NULL,
      size_bytes    BIGINT NOT NULL,
      storage       TEXT NOT NULL CHECK (storage IN ('s3', 'local')),
      storage_key   TEXT NOT NULL,
      url           TEXT,
      access        TEXT NOT NULL DEFAULT 'private' CHECK (access IN ('public', 'private', 'signed')),
      metadata      JSONB NOT NULL DEFAULT '{}',
      uploaded_by   UUID,
      deleted_at    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON files.files (workspace_id)`;
  await sql`CREATE INDEX ON files.files (folder_id)`;
  await sql`CREATE INDEX ON files.files (storage_key)`;
  await sql`CREATE INDEX ON files.files (deleted_at)`;
}
