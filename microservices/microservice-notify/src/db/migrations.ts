import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS notify`;
  await sql`CREATE TABLE IF NOT EXISTS notify._migrations (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await run(sql, "001_notifications_preferences", m001);
  await run(sql, "002_templates_webhooks_delivery", m002);
}

async function run(sql: Sql, name: string, fn: (sql: Sql) => Promise<void>) {
  const [e] = await sql`SELECT id FROM notify._migrations WHERE name = ${name}`;
  if (e) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO notify._migrations (name) VALUES (${name})`;
  });
}

async function m001(sql: Sql) {
  await sql`
    CREATE TABLE notify.notifications (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID NOT NULL,
      workspace_id UUID,
      channel      TEXT NOT NULL CHECK (channel IN ('email','sms','in_app','webhook')),
      type         TEXT NOT NULL,
      title        TEXT,
      body         TEXT NOT NULL,
      data         JSONB NOT NULL DEFAULT '{}',
      read_at      TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON notify.notifications (user_id)`;
  await sql`CREATE INDEX ON notify.notifications (workspace_id)`;
  await sql`CREATE INDEX ON notify.notifications (created_at DESC)`;

  await sql`
    CREATE TABLE notify.preferences (
      user_id  UUID NOT NULL,
      channel  TEXT NOT NULL,
      type     TEXT NOT NULL,
      enabled  BOOLEAN NOT NULL DEFAULT true,
      PRIMARY KEY (user_id, channel, type)
    )`;
  await sql`CREATE INDEX ON notify.preferences (user_id)`;
}

async function m002(sql: Sql) {
  await sql`
    CREATE TABLE notify.templates (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL UNIQUE,
      subject    TEXT,
      body       TEXT NOT NULL,
      channel    TEXT,
      variables  TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON notify.templates (name)`;

  await sql`
    CREATE TABLE notify.webhook_endpoints (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      url          TEXT NOT NULL,
      secret       TEXT,
      events       TEXT[] NOT NULL DEFAULT '{}',
      active       BOOLEAN NOT NULL DEFAULT true,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON notify.webhook_endpoints (workspace_id)`;

  await sql`
    CREATE TABLE notify.delivery_log (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      notification_id UUID REFERENCES notify.notifications(id) ON DELETE CASCADE,
      channel         TEXT,
      status          TEXT NOT NULL CHECK (status IN ('pending','sent','failed')),
      error           TEXT,
      sent_at         TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON notify.delivery_log (notification_id)`;
}
