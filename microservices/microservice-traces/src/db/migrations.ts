/**
 * PostgreSQL migrations for microservice-traces.
 * All tables live in the `traces` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS traces`;

  await sql`
    CREATE TABLE IF NOT EXISTS traces._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_traces", migration001);
  await runMigration(sql, "002_spans", migration002);
  await runMigration(sql, "003_analytics_export", migration003);
  await runMigration(sql, "004_span_tags_annotations", migration004);
  await runMigration(sql, "005_sampling_correlation_retention", migration005);
  await runMigration(sql, "006_sampling_analytics", migration006);
  await runMigration(sql, "007_prometheus_datadog_anomaly_export", migration007);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>,
): Promise<void> {
  const [existing] =
    await sql`SELECT id FROM traces._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO traces._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE traces.traces (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id     UUID NOT NULL,
      name             TEXT NOT NULL,
      status           TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'error')),
      input            JSONB,
      output           JSONB,
      error            TEXT,
      total_tokens     INT DEFAULT 0,
      total_cost_usd   NUMERIC(10,6) DEFAULT 0,
      total_duration_ms INT,
      span_count       INT DEFAULT 0,
      metadata         JSONB DEFAULT '{}',
      started_at       TIMESTAMPTZ DEFAULT NOW(),
      ended_at         TIMESTAMPTZ
    )
  `;

  await sql`CREATE INDEX ON traces.traces (workspace_id, started_at DESC)`;
  await sql`CREATE INDEX ON traces.traces (status)`;
}

async function migration002(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE traces.spans (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trace_id        UUID NOT NULL REFERENCES traces.traces(id) ON DELETE CASCADE,
      parent_span_id  UUID REFERENCES traces.spans(id),
      name            TEXT NOT NULL,
      type            TEXT NOT NULL CHECK (type IN ('llm', 'tool', 'retrieval', 'guardrail', 'embedding', 'custom')),
      status          TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'error')),
      input           JSONB,
      output          JSONB,
      error           TEXT,
      model           TEXT,
      tokens_in       INT,
      tokens_out      INT,
      cost_usd        NUMERIC(10,6),
      duration_ms     INT,
      metadata        JSONB DEFAULT '{}',
      started_at      TIMESTAMPTZ DEFAULT NOW(),
      ended_at        TIMESTAMPTZ
    )
  `;

  await sql`CREATE INDEX ON traces.spans (trace_id, started_at)`;
  await sql`CREATE INDEX ON traces.spans (parent_span_id)`;
  await sql`CREATE INDEX ON traces.spans (type)`;
  await sql`CREATE INDEX ON traces.spans (status)`;
}

async function migration003(sql: Sql): Promise<void> {
  // Analytics: per-span-type aggregate stats (materialized-like rolling window)
  await sql`
    CREATE TABLE IF NOT EXISTS traces.span_analytics (
      id                SERIAL PRIMARY KEY,
      workspace_id      UUID NOT NULL,
      trace_id          UUID NOT NULL,
      span_type         TEXT NOT NULL,
      total_count       INT NOT NULL DEFAULT 0,
      error_count       INT NOT NULL DEFAULT 0,
      total_tokens_in   INT NOT NULL DEFAULT 0,
      total_tokens_out  INT NOT NULL DEFAULT 0,
      total_cost_usd    NUMERIC(12,6) NOT NULL DEFAULT 0,
      total_duration_ms BIGINT NOT NULL DEFAULT 0,
      avg_duration_ms   NUMERIC(10,2),
      period_start      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      period_end        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, trace_id, span_type, period_start)
    )
  `;
  await sql`CREATE INDEX ON traces.span_analytics (workspace_id, period_start)`;

  // Trace annotations / tags for filtering
  await sql`ALTER TABLE traces.traces ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE traces.traces ADD COLUMN IF NOT EXISTS user_id UUID`;
  await sql`ALTER TABLE traces.spans ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'`;
}

async function migration004(sql: Sql): Promise<void> {
  // Custom key-value tags for individual spans
  await sql`
    CREATE TABLE IF NOT EXISTS traces.span_tags (
      id          SERIAL PRIMARY KEY,
      span_id     UUID NOT NULL REFERENCES traces.spans(id) ON DELETE CASCADE,
      key         TEXT NOT NULL,
      value       TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (span_id, key)
    )
  `;
  await sql`CREATE INDEX ON traces.span_tags (span_id)`;

  // Annotations / events on individual spans
  await sql`
    CREATE TABLE IF NOT EXISTS traces.span_annotations (
      id          SERIAL PRIMARY KEY,
      span_id     UUID NOT NULL REFERENCES traces.spans(id) ON DELETE CASCADE,
      text        TEXT NOT NULL,
      timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON traces.span_annotations (span_id)`;
}

async function migration005(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS traces.trace_sampling_policies (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID,
      name         TEXT NOT NULL,
      type         TEXT NOT NULL CHECK (type IN ('head_rate', 'head_probabilistic', 'tail_error_only', 'tail_slow_trace', 'tail_high_cost')),
      rate         NUMERIC(5,4) NOT NULL DEFAULT 1.0,
      span_types   TEXT[],
      threshold_ms INT,
      threshold_usd NUMERIC(12,6),
      enabled      BOOLEAN DEFAULT true,
      priority     INT NOT NULL DEFAULT 100,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(name)
    )
  `;
  await sql`CREATE INDEX ON traces.trace_sampling_policies (workspace_id)`;
  await sql`CREATE INDEX ON traces.trace_sampling_policies (enabled, priority)`;

  await sql`
    CREATE TABLE IF NOT EXISTS traces.trace_correlations (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trace_id             UUID NOT NULL REFERENCES traces.traces(id) ON DELETE CASCADE,
      session_id           TEXT,
      user_id              UUID,
      external_request_id  TEXT,
      external_trace_id    TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(trace_id)
    )
  `;
  await sql`CREATE INDEX ON traces.trace_correlations (session_id)`;
  await sql`CREATE INDEX ON traces.trace_correlations (user_id)`;
  await sql`CREATE INDEX ON traces.trace_correlations (external_request_id)`;
  await sql`CREATE INDEX ON traces.trace_correlations (external_trace_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS traces.trace_retention_policies (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID,
      name         TEXT NOT NULL,
      type         TEXT NOT NULL CHECK (type IN ('ttl_days', 'max_count')),
      days         INT,
      max_count    INT,
      enabled      BOOLEAN DEFAULT true,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(name)
    )
  `;
  await sql`CREATE INDEX ON traces.trace_retention_policies (workspace_id)`;
}

async function migration006(sql: Sql): Promise<void> {
  // Sampling decisions audit log
  await sql`
    CREATE TABLE IF NOT EXISTS traces.sampling_decisions (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trace_id     UUID REFERENCES traces.traces(id) ON DELETE SET NULL,
      workspace_id  UUID NOT NULL,
      policy_id    UUID,
      policy_name   TEXT,
      policy_type   TEXT NOT NULL,
      decision      TEXT NOT NULL CHECK (decision IN ('sampled', 'dropped')),
      reason        TEXT NOT NULL,
      evaluated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON traces.sampling_decisions (workspace_id, evaluated_at)`;
  await sql`CREATE INDEX ON traces.sampling_decisions (trace_id)`;
  await sql`CREATE INDEX ON traces.sampling_decisions (decision)`;

  // Trace evaluations table — stores tail-based evaluation results
  await sql`
    CREATE TABLE IF NOT EXISTS traces.trace_evaluations (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trace_id         UUID NOT NULL REFERENCES traces.traces(id) ON DELETE CASCADE,
      policy_id        UUID,
      policy_name      TEXT,
      evaluation_type  TEXT NOT NULL CHECK (evaluation_type IN ('head', 'tail')),
      decision         TEXT NOT NULL CHECK (decision IN ('sampled', 'dropped')),
      reason           TEXT NOT NULL,
      trace_duration_ms INT,
      trace_cost_usd   NUMERIC(12,6),
      evaluated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON traces.trace_evaluations (trace_id)`;
  await sql`CREATE INDEX ON traces.trace_evaluations (evaluated_at)`;

  // Span flame graph snapshots — stores serialized flame graph for large traces
  await sql`
    CREATE TABLE IF NOT EXISTS traces.flame_graph_snapshots (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trace_id        UUID NOT NULL REFERENCES traces.traces(id) ON DELETE CASCADE,
      total_duration_ms INT NOT NULL,
      snapshot        JSONB NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(trace_id)
    )
  `;
  await sql`CREATE INDEX ON traces.flame_graph_snapshots (trace_id)`;
}

async function migration007(sql: Sql): Promise<void> {
  // Anomaly detection columns on spans
  await sql`
    ALTER TABLE traces.spans ADD COLUMN IF NOT EXISTS is_anomalous BOOLEAN NOT NULL DEFAULT false
  `;
  await sql`
    ALTER TABLE traces.spans ADD COLUMN IF NOT EXISTS anomaly_score NUMERIC(8,4)
  `;
  await sql`
    ALTER TABLE traces.spans ADD COLUMN IF NOT EXISTS anomaly_type TEXT
  `;

  // Per-span-type baselines for anomaly detection (rolling statistics)
  await sql`
    CREATE TABLE IF NOT EXISTS traces.span_anomaly_baselines (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id        UUID NOT NULL,
      span_type           TEXT NOT NULL,
      p50_duration_ms     NUMERIC(12,2) NOT NULL DEFAULT 0,
      p90_duration_ms     NUMERIC(12,2) NOT NULL DEFAULT 0,
      p99_duration_ms     NUMERIC(12,2) NOT NULL DEFAULT 0,
      avg_error_rate       NUMERIC(5,4) NOT NULL DEFAULT 0,
      avg_cost_per_call    NUMERIC(12,6) NOT NULL DEFAULT 0,
      sample_count        INT NOT NULL DEFAULT 0,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, span_type)
    )
  `;
  await sql`CREATE INDEX ON traces.span_anomaly_baselines (workspace_id)`;

  // Prometheus metrics snapshots (for /metrics endpoint)
  await sql`
    CREATE TABLE IF NOT EXISTS traces.prometheus_snapshots (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID NOT NULL,
      metric_name     TEXT NOT NULL,
      metric_labels   JSONB NOT NULL DEFAULT '{}',
      metric_value    NUMERIC(24,6) NOT NULL,
      metric_type     TEXT NOT NULL CHECK (metric_type IN ('counter', 'gauge', 'histogram', 'summary')),
      buckets         JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON traces.prometheus_snapshots (workspace_id, created_at)`;
  await sql`CREATE INDEX ON traces.prometheus_snapshots (workspace_id, metric_name)`;
}
