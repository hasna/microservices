import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS webhooks`;
  await sql`CREATE TABLE IF NOT EXISTS webhooks._migrations (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await run(sql, "001_endpoints_deliveries", m001);
  await run(sql, "002_delivery_attempts", m002);
}

async function run(sql: Sql, name: string, fn: (sql: Sql) => Promise<void>) {
  const [e] =
    await sql`SELECT id FROM webhooks._migrations WHERE name = ${name}`;
  if (e) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO webhooks._migrations (name) VALUES (${name})`;
  });
}

async function m001(sql: Sql) {
  await sql`
    CREATE TABLE webhooks.endpoints (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id   UUID NOT NULL,
      url            TEXT NOT NULL,
      secret         TEXT,
      events         TEXT[] NOT NULL DEFAULT '{}',
      active         BOOLEAN NOT NULL DEFAULT true,
      failure_count  INT NOT NULL DEFAULT 0,
      last_failure_at TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON webhooks.endpoints (workspace_id)`;
  await sql`CREATE INDEX ON webhooks.endpoints (workspace_id, active)`;

  await sql`
    CREATE TABLE webhooks.deliveries (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      endpoint_id     UUID NOT NULL REFERENCES webhooks.endpoints(id) ON DELETE CASCADE,
      event           TEXT NOT NULL,
      payload         JSONB NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
      attempts        INT NOT NULL DEFAULT 0,
      max_attempts    INT NOT NULL DEFAULT 5,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      delivered_at    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON webhooks.deliveries (endpoint_id)`;
  await sql`CREATE INDEX ON webhooks.deliveries (status, next_attempt_at) WHERE status = 'pending'`;
  await sql`CREATE INDEX ON webhooks.deliveries (event)`;
}

async function m002(sql: Sql) {
  await sql`
    CREATE TABLE webhooks.delivery_attempts (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      delivery_id  UUID NOT NULL REFERENCES webhooks.deliveries(id) ON DELETE CASCADE,
      status_code  INT,
      response_body TEXT,
      error        TEXT,
      attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON webhooks.delivery_attempts (delivery_id)`;
}
