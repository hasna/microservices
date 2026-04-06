/**
 * PostgreSQL migrations for microservice-guardrails.
 * All tables live in the `guardrails` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS guardrails`;

  await sql`
    CREATE TABLE IF NOT EXISTS guardrails._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_policies", migration001);
  await runMigration(sql, "002_violations", migration002);
  await runMigration(sql, "003_allowlists", migration003);
  await runMigration(sql, "004_guard_rules", migration004);
  await runMigration(sql, "005_fingerprints_audit", migration005);
  await runMigration(sql, "006_client_rate_limits_adaptive", migration006);
  await runMigration(sql, "007_denylist_replay_classifier", migration007);
  await runMigration(sql, "008_rule_versioning_composition", migration008);
  await runMigration(sql, "009_workspace_quotas", migration009);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>,
): Promise<void> {
  const [existing] =
    await sql`SELECT id FROM guardrails._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO guardrails._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE guardrails.policies (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      name         TEXT NOT NULL,
      rules        JSONB NOT NULL DEFAULT '[]',
      active       BOOLEAN DEFAULT true,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, name)
    )
  `;
}

async function migration002(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE guardrails.violations (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID,
      type            TEXT NOT NULL,
      direction       TEXT NOT NULL CHECK (direction IN ('input', 'output')),
      content_snippet TEXT,
      details         JSONB DEFAULT '{}',
      severity        TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON guardrails.violations (workspace_id, created_at)`;
  await sql`CREATE INDEX ON guardrails.violations (type)`;
  await sql`CREATE INDEX ON guardrails.violations (severity)`;
}

async function migration003(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE guardrails.allowlists (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      type         TEXT NOT NULL,
      value        TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, type, value)
    )
  `;
}

async function migration004(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE guardrails.guard_rules (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL,
      pattern     TEXT NOT NULL,
      severity    TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      action      TEXT NOT NULL DEFAULT 'warn' CHECK (action IN ('block', 'redact', 'warn', 'log')),
      enabled     BOOLEAN DEFAULT true,
      priority    INT NOT NULL DEFAULT 100,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(name)
    )
  `;

  await sql`CREATE INDEX ON guardrails.guard_rules (enabled, priority)`;
  await sql`CREATE INDEX ON guardrails.guard_rules (severity)`;
}

async function migration005(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE guardrails.content_fingerprints (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      fingerprint TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      content_preview TEXT,
      simhash     TEXT,
      avg_hash    TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON guardrails.content_fingerprints (workspace_id)`;
  await sql`CREATE INDEX ON guardrails.content_fingerprints (simhash)`;
  await sql`CREATE INDEX ON guardrails.content_fingerprints (content_hash)`;

  await sql`
    CREATE TABLE guardrails.audit_log (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID,
      request_id      TEXT,
      check_type      TEXT NOT NULL,
      result          TEXT NOT NULL CHECK (result IN ('pass', 'warn', 'block')),
      input_text      TEXT,
      output_text     TEXT,
      violations      JSONB DEFAULT '[]',
      fingerprint_id  UUID,
      ip_address      TEXT,
      user_agent      TEXT,
      latency_ms      INTEGER,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON guardrails.audit_log (workspace_id, created_at)`;
  await sql`CREATE INDEX ON guardrails.audit_log (result)`;
  await sql`CREATE INDEX ON guardrails.audit_log (fingerprint_id)`;
  await sql`CREATE INDEX ON guardrails.audit_log (request_id)`;
  await sql`CREATE INDEX ON guardrails.audit_log (ip_address)`;
}

async function migration006(sql: Sql): Promise<void> {
  // Per-client sliding-window rate limiting
  await sql`
    CREATE TABLE IF NOT EXISTS guardrails.client_rate_limits (
      id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id           UUID NOT NULL,
      client_id              TEXT NOT NULL,
      max_requests           INT NOT NULL DEFAULT 100,
      window_seconds         INT NOT NULL DEFAULT 60,
      block_duration_seconds INT NOT NULL DEFAULT 300,
      enabled                BOOLEAN NOT NULL DEFAULT true,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, client_id)
    )
  `;
  await sql`CREATE INDEX ON guardrails.client_rate_limits (workspace_id, enabled)`;

  // Per-client sliding window request log
  await sql`
    CREATE TABLE IF NOT EXISTS guardrails.client_rate_log (
      id          BIGSERIAL PRIMARY KEY,
      workspace_id UUID NOT NULL,
      client_id   TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON guardrails.client_rate_log (workspace_id, client_id, recorded_at)`;
  await sql`CREATE INDEX ON guardrails.client_rate_log (workspace_id, client_id) WHERE recorded_at > NOW() - INTERVAL '1 hour'`;

  // Per-client blocks when rate limit exceeded
  await sql`
    CREATE TABLE IF NOT EXISTS guardrails.client_rate_blocks (
      workspace_id  UUID NOT NULL,
      client_id     TEXT NOT NULL,
      blocked_until TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (workspace_id, client_id)
    )
  `;

  // Adaptive guard state per workspace
  await sql`
    CREATE TABLE IF NOT EXISTS guardrails.adaptive_states (
      workspace_id          UUID PRIMARY KEY,
      level                TEXT NOT NULL DEFAULT 'normal' CHECK (level IN ('relaxed','normal','strict','paranoid')),
      reason                TEXT,
      score_at_adjustment   NUMERIC(10,2),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function migration007(sql: Sql): Promise<void> {
  // IP/network denylist
  await sql`
    CREATE TABLE IF NOT EXISTS guardrails.denylist (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID, -- null = global deny across all workspaces
      ip_pattern   TEXT NOT NULL,
      reason       TEXT NOT NULL,
      blocked_by   TEXT NOT NULL,
      expires_at   TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON guardrails.denylist (workspace_id)`;
  await sql`CREATE INDEX ON guardrails.denylist (ip_pattern) WHERE workspace_id IS NULL`;
}

async function migration008(sql: Sql): Promise<void> {
  // Rule version history — immutable append-only log of rule changes
  await sql`
    CREATE TABLE IF NOT EXISTS guardrails.rule_versions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id         UUID NOT NULL REFERENCES guardrails.guard_rules(id) ON DELETE CASCADE,
      version_number  INT NOT NULL,
      name            TEXT NOT NULL,
      pattern         TEXT NOT NULL,
      severity        TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
      action          TEXT NOT NULL CHECK (action IN ('block','redact','warn','log')),
      priority        INT NOT NULL DEFAULT 100,
      enabled         BOOLEAN NOT NULL DEFAULT true,
      changed_by      TEXT,
      change_reason   TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(rule_id, version_number)
    )
  `;
  await sql`CREATE INDEX ON guardrails.rule_versions (rule_id, version_number DESC)`;

  // Rule groups — AND/OR/NOT composition of rules
  await sql`
    CREATE TABLE IF NOT EXISTS guardrails.rule_groups (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL UNIQUE,
      operator    TEXT NOT NULL CHECK (operator IN ('AND','OR','NOT')),
      rule_ids    JSONB NOT NULL DEFAULT '[]',
      negate      BOOLEAN NOT NULL DEFAULT false,
      enabled     BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON guardrails.rule_groups (enabled)`;
}

async function migration009(sql: Sql): Promise<void> {
  // Workspace quotas — per-workspace aggregate limits (daily/monthly)
  await sql`
    CREATE TABLE IF NOT EXISTS guardrails.workspace_quotas (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id     UUID NOT NULL,
      period           TEXT NOT NULL CHECK (period IN ('daily', 'monthly')),
      max_requests     BIGINT NOT NULL DEFAULT 100000,
      max_tokens       BIGINT NOT NULL DEFAULT 10000000,
      max_bytes        BIGINT NOT NULL DEFAULT 10737418240,
      enabled          BOOLEAN NOT NULL DEFAULT true,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, period)
    )
  `;
  await sql`CREATE INDEX ON guardrails.workspace_quotas (workspace_id)`;

  // Workspace quota usage tracking
  await sql`
    CREATE TABLE IF NOT EXISTS guardrails.workspace_quota_usage (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID NOT NULL,
      period          TEXT NOT NULL CHECK (period IN ('daily', 'monthly')),
      period_start    TIMESTAMPTZ NOT NULL,
      period_end      TIMESTAMPTZ NOT NULL,
      requests_used   BIGINT NOT NULL DEFAULT 0,
      tokens_used     BIGINT NOT NULL DEFAULT 0,
      bytes_used      BIGINT NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, period, period_start)
    )
  `;
  await sql`CREATE INDEX ON guardrails.workspace_quota_usage (workspace_id, period, period_start DESC)`;
}
