/**
 * PostgreSQL migrations for microservice-auth.
 * All tables live in the `auth` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS auth`;

  await sql`
    CREATE TABLE IF NOT EXISTS auth._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_users_sessions", migration001);
  await runMigration(sql, "002_tokens_api_keys", migration002);
  await runMigration(sql, "003_oauth_accounts", migration003);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>
): Promise<void> {
  const [existing] = await sql`SELECT id FROM auth._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx) => {
    await fn(tx);
    await tx`INSERT INTO auth._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE auth.users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT NOT NULL UNIQUE,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      password_hash TEXT,
      name          TEXT,
      avatar_url    TEXT,
      metadata      JSONB NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON auth.users (email)`;

  await sql`
    CREATE TABLE auth.sessions (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      token      TEXT NOT NULL UNIQUE,
      ip         TEXT,
      user_agent TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON auth.sessions (token)`;
  await sql`CREATE INDEX ON auth.sessions (user_id)`;
  await sql`CREATE INDEX ON auth.sessions (expires_at)`;
}

async function migration002(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE auth.tokens (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL CHECK (type IN ('magic_link', 'email_verify', 'password_reset', 'totp_setup')),
      token      TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON auth.tokens (token)`;
  await sql`CREATE INDEX ON auth.tokens (user_id, type)`;

  await sql`
    CREATE TABLE auth.api_keys (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      key_hash    TEXT NOT NULL UNIQUE,
      key_prefix  TEXT NOT NULL,
      scopes      TEXT[] NOT NULL DEFAULT '{}',
      expires_at  TIMESTAMPTZ,
      last_used_at TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON auth.api_keys (key_hash)`;
  await sql`CREATE INDEX ON auth.api_keys (user_id)`;

  await sql`
    CREATE TABLE auth.totp_secrets (
      user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      secret     TEXT NOT NULL,
      verified   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function migration003(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE auth.oauth_accounts (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      provider    TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      access_token  TEXT,
      refresh_token TEXT,
      expires_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider, provider_id)
    )
  `;

  await sql`CREATE INDEX ON auth.oauth_accounts (user_id)`;
}
