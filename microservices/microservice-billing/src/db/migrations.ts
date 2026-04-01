import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS billing`;
  await sql`CREATE TABLE IF NOT EXISTS billing._migrations (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await run(sql, "001_plans", m001);
  await run(sql, "002_subscriptions", m002);
  await run(sql, "003_invoices", m003);
  await run(sql, "004_usage_records", m004);
}

async function run(sql: Sql, name: string, fn: (sql: Sql) => Promise<void>) {
  const [e] =
    await sql`SELECT id FROM billing._migrations WHERE name = ${name}`;
  if (e) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO billing._migrations (name) VALUES (${name})`;
  });
}

async function m001(sql: Sql) {
  await sql`
    CREATE TABLE billing.plans (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      amount_cents    INTEGER NOT NULL CHECK (amount_cents >= 0),
      currency        TEXT NOT NULL DEFAULT 'usd',
      interval        TEXT NOT NULL DEFAULT 'month' CHECK (interval IN ('month','year','one_time')),
      stripe_price_id TEXT,
      active          BOOLEAN NOT NULL DEFAULT true,
      metadata        JSONB NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON billing.plans (active)`;
  await sql`CREATE INDEX ON billing.plans (stripe_price_id)`;
}

async function m002(sql: Sql) {
  await sql`
    CREATE TABLE billing.subscriptions (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id            UUID NOT NULL,
      user_id                 UUID NOT NULL,
      plan_id                 UUID NOT NULL REFERENCES billing.plans(id),
      stripe_subscription_id  TEXT UNIQUE,
      stripe_customer_id      TEXT,
      status                  TEXT NOT NULL DEFAULT 'incomplete' CHECK (status IN ('active','past_due','canceled','trialing','incomplete')),
      current_period_start    TIMESTAMPTZ,
      current_period_end      TIMESTAMPTZ,
      cancel_at_period_end    BOOLEAN NOT NULL DEFAULT false,
      canceled_at             TIMESTAMPTZ,
      metadata                JSONB NOT NULL DEFAULT '{}',
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON billing.subscriptions (workspace_id)`;
  await sql`CREATE INDEX ON billing.subscriptions (user_id)`;
  await sql`CREATE INDEX ON billing.subscriptions (stripe_subscription_id)`;
  await sql`CREATE INDEX ON billing.subscriptions (stripe_customer_id)`;
  await sql`CREATE INDEX ON billing.subscriptions (status)`;
}

async function m003(sql: Sql) {
  await sql`
    CREATE TABLE billing.invoices (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id     UUID NOT NULL,
      subscription_id  UUID REFERENCES billing.subscriptions(id),
      stripe_invoice_id TEXT UNIQUE,
      amount_cents     INTEGER NOT NULL CHECK (amount_cents >= 0),
      currency         TEXT NOT NULL DEFAULT 'usd',
      status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','paid','uncollectible','void')),
      invoice_pdf_url  TEXT,
      paid_at          TIMESTAMPTZ,
      due_date         TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON billing.invoices (workspace_id)`;
  await sql`CREATE INDEX ON billing.invoices (subscription_id)`;
  await sql`CREATE INDEX ON billing.invoices (stripe_invoice_id)`;
  await sql`CREATE INDEX ON billing.invoices (status)`;
}

async function m004(sql: Sql) {
  await sql`
    CREATE TABLE billing.usage_records (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subscription_id UUID NOT NULL REFERENCES billing.subscriptions(id) ON DELETE CASCADE,
      metric          TEXT NOT NULL,
      quantity        NUMERIC NOT NULL,
      recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX ON billing.usage_records (subscription_id)`;
  await sql`CREATE INDEX ON billing.usage_records (recorded_at)`;
}
