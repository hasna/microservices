/**
 * PostgreSQL migrations for microservice-llm.
 * All tables live in the `llm` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS llm`;

  await sql`
    CREATE TABLE IF NOT EXISTS llm._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_requests_rate_limits", migration001);
  await runMigration(sql, "002_workspace_budgets", migration002);
  await runMigration(sql, "003_fallbacks_batch_tokens_budget_alerts", migration003);
  await runMigration(sql, "004_templates_embeddings_registry", migration004);
  await runMigration(sql, "005_function_calling_cache_vision", migration005);
  await runMigration(sql, "006_model_budgets_provider_circuits", migration006);
  await runMigration(sql, "007_webhooks_health_analytics", migration007);
  await runMigration(sql, "008_streaming_fallback_chain_budget_scheduler", migration008);
  await runMigration(sql, "009_usage_forecast", migration009);
  await runMigration(sql, "010_model_latency_quality_conversations", migration010);
  await runMigration(sql, "011_prompt_versioning_model_comparison", migration011);
  await runMigration(sql, "012_observability_spans", migration012);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>,
): Promise<void> {
  const [existing] =
    await sql`SELECT id FROM llm._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO llm._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE llm.requests (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id     UUID NOT NULL,
      model            TEXT NOT NULL,
      provider         TEXT NOT NULL,
      prompt_tokens    INT NOT NULL DEFAULT 0,
      completion_tokens INT NOT NULL DEFAULT 0,
      total_tokens     INT NOT NULL DEFAULT 0,
      cost_usd         NUMERIC(10,6) NOT NULL DEFAULT 0,
      latency_ms       INT NOT NULL DEFAULT 0,
      cached           BOOLEAN NOT NULL DEFAULT FALSE,
      error            TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON llm.requests (workspace_id)`;
  await sql`CREATE INDEX ON llm.requests (created_at)`;
  await sql`CREATE INDEX ON llm.requests (provider)`;
  await sql`CREATE INDEX ON llm.requests (workspace_id, created_at)`;

  await sql`
    CREATE TABLE llm.rate_limits (
      workspace_id        UUID NOT NULL,
      provider            TEXT NOT NULL,
      requests_per_minute INT NOT NULL DEFAULT 60,
      tokens_per_minute   INT NOT NULL DEFAULT 100000,
      PRIMARY KEY (workspace_id, provider)
    )
  `;
}

async function migration002(sql: Sql): Promise<void> {
  // Per-workspace monthly budget caps
  await sql`
    CREATE TABLE llm.workspace_budgets (
      workspace_id        UUID PRIMARY KEY,
      monthly_limit_usd   NUMERIC(10,2) NOT NULL DEFAULT 100.00,
      current_month_spend  NUMERIC(10,2) NOT NULL DEFAULT 0.00,
      alert_threshold_pct  INT NOT NULL DEFAULT 80,
      alert_sent_at        TIMESTAMPTZ,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE llm.budget_alerts (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id   UUID NOT NULL REFERENCES llm.workspace_budgets(workspace_id) ON DELETE CASCADE,
      alert_type     TEXT NOT NULL CHECK (alert_type IN ('threshold', 'exceeded')),
      threshold_pct  INT NOT NULL,
      spend_usd      NUMERIC(10,2) NOT NULL,
      limit_usd      NUMERIC(10,2) NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON llm.budget_alerts (workspace_id)`;
  await sql`CREATE INDEX ON llm.budget_alerts (created_at)`;
}

async function migration003(sql: Sql): Promise<void> {
  // Track which fallback index was used in requests (0 = primary, 1+ = fallback)
  await sql`
    ALTER TABLE llm.requests
    ADD COLUMN IF NOT EXISTS provider_fallback_index INT NOT NULL DEFAULT 0
  `;

  // Store fallback chain strategy per workspace (JSON array of provider chains)
  await sql`
    ALTER TABLE llm.workspace_budgets
    ADD COLUMN IF NOT EXISTS fallback_strategy JSONB
  `;

  // Enhanced budget_alerts with threshold/spend in both cents and dollars
  await sql`
    ALTER TABLE llm.budget_alerts
    ADD COLUMN IF NOT EXISTS threshold_cents BIGINT,
    ADD COLUMN IF NOT EXISTS current_spend_cents BIGINT,
    ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ
  `;

  // Migrate existing rows: convert dollars to cents
  await sql`
    UPDATE llm.budget_alerts
    SET
      threshold_cents = (threshold_pct * 100)::BIGINT,
      current_spend_cents = (spend_usd * 100)::BIGINT,
      notified_at = created_at
    WHERE threshold_cents IS NULL
  `;
}

async function migration004(sql: Sql): Promise<void> {
  // Prompt templates with versioning
  await sql`
    CREATE TABLE llm.prompt_templates (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id     UUID NOT NULL,
      user_id          UUID,
      name             TEXT NOT NULL,
      description      TEXT,
      template         TEXT NOT NULL,
      variables        TEXT[] NOT NULL DEFAULT '{}',
      model_provider   TEXT,
      model_name       TEXT,
      version          INT NOT NULL DEFAULT 1,
      is_active        BOOLEAN NOT NULL DEFAULT true,
      metadata         JSONB NOT NULL DEFAULT '{}',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.prompt_templates (workspace_id)`;
  await sql`CREATE INDEX ON llm.prompt_templates (user_id) WHERE user_id IS NOT NULL`;

  // Embeddings cache
  await sql`
    CREATE TABLE llm.embeddings_cache (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id     UUID NOT NULL,
      text_hash        TEXT NOT NULL,
      text_snippet     TEXT NOT NULL,
      embedding        DOUBLE PRECISION[] NOT NULL,
      model            TEXT NOT NULL,
      dimensions       INT NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, text_hash)
    )
  `;
  await sql`CREATE INDEX ON llm.embeddings_cache (workspace_id)`;
  await sql`CREATE INDEX ON llm.embeddings_cache (text_hash)`;

  // Model registry
  await sql`
    CREATE TABLE llm.models (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider           TEXT NOT NULL,
      name               TEXT NOT NULL,
      display_name       TEXT NOT NULL,
      description        TEXT,
      context_window     INT NOT NULL DEFAULT 4096,
      max_output_tokens  INT,
      cost_per_1k_input  NUMERIC(10,6) NOT NULL DEFAULT 0,
      cost_per_1k_output NUMERIC(10,6) NOT NULL DEFAULT 0,
      capabilities       TEXT[] NOT NULL DEFAULT '{"chat"}',
      default_kwargs     JSONB NOT NULL DEFAULT '{}',
      is_active          BOOLEAN NOT NULL DEFAULT true,
      metadata           JSONB NOT NULL DEFAULT '{}',
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.models (provider)`;
  await sql`CREATE INDEX ON llm.models (is_active)`;

  // Providers
  await sql`
    CREATE TABLE llm.providers (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type             TEXT NOT NULL,
      name             TEXT NOT NULL,
      base_url         TEXT,
      api_key_secret   TEXT NOT NULL,
      is_active        BOOLEAN NOT NULL DEFAULT true,
      default_model_id UUID REFERENCES llm.models(id),
      metadata         JSONB NOT NULL DEFAULT '{}',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Model aliases
  await sql`
    CREATE TABLE llm.model_aliases (
      alias        TEXT NOT NULL,
      model_id     UUID NOT NULL REFERENCES llm.models(id) ON DELETE CASCADE,
      workspace_id UUID, -- null = global
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (alias, workspace_id)
    )
  `;
  await sql`CREATE INDEX ON llm.model_aliases (model_id)`;
}

async function migration005(sql: Sql): Promise<void> {
  // Workspace tool definitions for function calling
  await sql`
    CREATE TABLE llm.workspace_tools (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      name         TEXT NOT NULL,
      description  TEXT NOT NULL,
      parameters   JSONB NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, name)
    )
  `;
  await sql`CREATE INDEX ON llm.workspace_tools (workspace_id)`;

  // Semantic response cache
  await sql`
    CREATE TABLE llm.response_cache (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id     UUID NOT NULL,
      text_hash        TEXT NOT NULL,
      text_snippet     TEXT NOT NULL,
      prompt_embedding JSONB,
      response_content TEXT NOT NULL,
      model            TEXT NOT NULL,
      provider         TEXT NOT NULL,
      prompt_tokens    INT NOT NULL DEFAULT 0,
      completion_tokens INT NOT NULL DEFAULT 0,
      cost_usd         NUMERIC(10,6) NOT NULL DEFAULT 0,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, text_hash)
    )
  `;
  await sql`CREATE INDEX ON llm.response_cache (workspace_id)`;
  await sql`CREATE INDEX ON llm.response_cache (text_hash)`;
}

async function migration006(sql: Sql): Promise<void> {
  // Per-model monthly spending limits
  await sql`
    CREATE TABLE llm.model_budgets (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id     UUID NOT NULL,
      model_name       TEXT NOT NULL,
      monthly_limit_usd NUMERIC(10,2) NOT NULL DEFAULT 50.00,
      current_month_spend NUMERIC(10,2) NOT NULL DEFAULT 0.00,
      alert_threshold_pct INT NOT NULL DEFAULT 80,
      enabled          BOOLEAN NOT NULL DEFAULT true,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, model_name)
    )
  `;
  await sql`CREATE INDEX ON llm.model_budgets (workspace_id)`;

  await sql`
    CREATE TABLE llm.model_spend (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id     UUID NOT NULL,
      model_name       TEXT NOT NULL,
      spend_usd        NUMERIC(10,6) NOT NULL DEFAULT 0,
      period_start     DATE NOT NULL,
      period_end       DATE NOT NULL,
      recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.model_spend (workspace_id, model_name)`;
  await sql`CREATE INDEX ON llm.model_spend (period_start)`;

  // Provider circuit-breaker state (persisted for HA deployments)
  await sql`
    CREATE TABLE llm.provider_circuits (
      provider         TEXT PRIMARY KEY,
      state            TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed','open','half_open')),
      failure_count    INT NOT NULL DEFAULT 0,
      success_count    INT NOT NULL DEFAULT 0,
      last_failure_at  TIMESTAMPTZ,
      last_success_at  TIMESTAMPTZ,
      opened_at        TIMESTAMPTZ,
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function migration007(sql: Sql): Promise<void> {
  // Webhook endpoints for budget/circuit notifications
  await sql`
    CREATE TABLE llm.webhooks (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      url          TEXT NOT NULL,
      secret       TEXT NOT NULL,
      event_types  TEXT[] NOT NULL,
      is_active    BOOLEAN NOT NULL DEFAULT true,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.webhooks (workspace_id)`;
  await sql`CREATE INDEX ON llm.webhooks (is_active) WHERE is_active = true`;

  // Webhook delivery logs
  await sql`
    CREATE TABLE llm.webhook_logs (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      webhook_id     UUID NOT NULL REFERENCES llm.webhooks(id) ON DELETE CASCADE,
      event_type     TEXT NOT NULL,
      payload        JSONB NOT NULL,
      response_status INT,
      error          TEXT,
      delivered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.webhook_logs (webhook_id)`;
  await sql`CREATE INDEX ON llm.webhook_logs (delivered_at)`;
}

async function migration008(sql: Sql): Promise<void> {
  // Fallback chain execution logs
  await sql`
    CREATE TABLE llm.fallback_chain_executions (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id     UUID NOT NULL,
      chain            JSONB NOT NULL,
      providers_tried  INT NOT NULL DEFAULT 0,
      provider_used    TEXT NOT NULL,
      model_used       TEXT NOT NULL,
      latency_ms       INT NOT NULL DEFAULT 0,
      cost_usd         NUMERIC(10,6) NOT NULL DEFAULT 0,
      success          BOOLEAN NOT NULL DEFAULT FALSE,
      error            TEXT,
      started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.fallback_chain_executions (workspace_id)`;
  await sql`CREATE INDEX ON llm.fallback_chain_executions (started_at)`;
  await sql`CREATE INDEX ON llm.fallback_chain_executions (provider_used)`;

  // Per-provider attempt details within a chain execution
  await sql`
    CREATE TABLE llm.fallback_chain_details (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      execution_id   UUID NOT NULL REFERENCES llm.fallback_chain_executions(id) ON DELETE CASCADE,
      provider       TEXT NOT NULL,
      model          TEXT NOT NULL,
      attempt        INT NOT NULL,
      latency_ms     INT NOT NULL DEFAULT 0,
      cost_usd       NUMERIC(10,6) NOT NULL DEFAULT 0,
      success        BOOLEAN NOT NULL DEFAULT FALSE,
      error          TEXT,
      started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.fallback_chain_details (execution_id)`;

  // Budget schedules for automated monitoring
  await sql`
    CREATE TABLE llm.budget_schedules (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID NOT NULL,
      schedule_type   TEXT NOT NULL CHECK (schedule_type IN ('periodic', 'on_demand')),
      cron_expression TEXT,
      action          TEXT NOT NULL DEFAULT 'check_threshold',
      config          JSONB NOT NULL DEFAULT '{}',
      status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
      last_run_at     TIMESTAMPTZ,
      next_run_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.budget_schedules (workspace_id)`;
  await sql`CREATE INDEX ON llm.budget_schedules (status, next_run_at) WHERE schedule_type = 'periodic' AND status IN ('pending','completed','failed')`;

  // Budget check history for auditing
  await sql`
    CREATE TABLE llm.budget_check_history (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      schedule_id       UUID REFERENCES llm.budget_schedules(id) ON DELETE SET NULL,
      workspace_id       UUID NOT NULL,
      status            TEXT NOT NULL CHECK (status IN ('ok', 'threshold', 'exceeded')),
      current_spend_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
      limit_usd         NUMERIC(10,2) NOT NULL DEFAULT 0,
      alert_sent        BOOLEAN NOT NULL DEFAULT FALSE,
      checked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.budget_check_history (workspace_id)`;
  await sql`CREATE INDEX ON llm.budget_check_history (checked_at)`;
}

async function migration009(sql: Sql): Promise<void> {
  // Usage forecast snapshots — stores daily projected spend per workspace
  await sql`
    CREATE TABLE llm.usage_forecast (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id        UUID NOT NULL,
      forecast_date      DATE NOT NULL,
      current_spend       NUMERIC(10,4) NOT NULL DEFAULT 0,
      projected_spend     NUMERIC(10,4) NOT NULL DEFAULT 0,
      budget_limit       NUMERIC(10,4) NOT NULL DEFAULT 0,
      days_until_exhaustion REAL,
      daily_avg_spend    NUMERIC(10,4) NOT NULL DEFAULT 0,
      trend              TEXT NOT NULL DEFAULT 'stable' CHECK (trend IN ('stable','increasing','decreasing')),
      confidence         REAL NOT NULL DEFAULT 0.5,
      projected_overrun_pct NUMERIC(10,4) NOT NULL DEFAULT 0,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.usage_forecast (workspace_id)`;
  await sql`CREATE INDEX ON llm.usage_forecast (workspace_id, forecast_date DESC)`;

  // Budget alert dispatch log
  await sql`
    CREATE TABLE llm.budget_alert_dispatches (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id      UUID NOT NULL,
      alert_type        TEXT NOT NULL CHECK (alert_type IN ('threshold','exceeded','model_exceeded','projected_overrun')),
      model             TEXT,
      threshold_pct     REAL,
      spend_at_alert    NUMERIC(10,4) NOT NULL DEFAULT 0,
      webhook_id        UUID REFERENCES llm.webhooks(id) ON DELETE SET NULL,
      webhook_sent      BOOLEAN NOT NULL DEFAULT FALSE,
      webhook_response  TEXT,
      dispatched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.budget_alert_dispatches (workspace_id)`;
  await sql`CREATE INDEX ON llm.budget_alert_dispatches (alert_type)`;
  await sql`CREATE INDEX ON llm.budget_alert_dispatches (dispatched_at)`;
}

async function migration010(sql: Sql): Promise<void> {
  // Model latency percentiles — percentile approximations per model
  await sql`
    CREATE TABLE llm.model_latency_stats (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      model        TEXT NOT NULL,
      period_start TIMESTAMPTZ NOT NULL,
      period_end   TIMESTAMPTZ NOT NULL,
      p50_ms       REAL NOT NULL DEFAULT 0,
      p95_ms       REAL NOT NULL DEFAULT 0,
      p99_ms       REAL NOT NULL DEFAULT 0,
      max_ms       REAL NOT NULL DEFAULT 0,
      avg_ms       REAL NOT NULL DEFAULT 0,
      sample_count INT NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.model_latency_stats (workspace_id, model, period_start DESC)`;

  // Response quality scores — user or automated feedback on LLM responses
  await sql`
    CREATE TABLE llm.model_quality_scores (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id   UUID NOT NULL,
      workspace_id UUID NOT NULL,
      model        TEXT NOT NULL,
      score        REAL NOT NULL CHECK (score >= 0 AND score <= 100),
      feedback     TEXT,
      scoring_type TEXT NOT NULL DEFAULT 'user'
        CHECK (scoring_type IN ('user', 'automated', 'task_completion')),
      metadata     JSONB NOT NULL DEFAULT '{}',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.model_quality_scores (request_id)`;
  await sql`CREATE INDEX ON llm.model_quality_scores (workspace_id, created_at DESC)`;
  await sql`CREATE INDEX ON llm.model_quality_scores (model, created_at DESC)`;

  // Multi-turn conversation tracking
  await sql`
    CREATE TABLE llm.conversations (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      user_id      UUID,
      title        TEXT,
      message_count INT NOT NULL DEFAULT 0,
      total_tokens INT NOT NULL DEFAULT 0,
      total_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
      model        TEXT,
      status       TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.conversations (workspace_id, status)`;
  await sql`CREATE INDEX ON llm.conversations (user_id)`;

  // Conversation messages for cost attribution
  await sql`
    CREATE TABLE llm.conversation_messages (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES llm.conversations(id) ON DELETE CASCADE,
      request_id      UUID REFERENCES llm.requests(id) ON DELETE SET NULL,
      role            TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
      content         TEXT NOT NULL,
      tokens_in       INT NOT NULL DEFAULT 0,
      tokens_out      INT NOT NULL DEFAULT 0,
      cost_usd        NUMERIC(12,6) NOT NULL DEFAULT 0,
      model           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.conversation_messages (conversation_id)`;
  await sql`CREATE INDEX ON llm.conversation_messages (request_id)`;
}

async function migration011(sql: Sql): Promise<void> {
  // Prompt version history
  await sql`
    CREATE TABLE llm.prompt_versions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id     TEXT NOT NULL,
      version_number  INT NOT NULL,
      content         TEXT NOT NULL,
      variables       TEXT[] NOT NULL DEFAULT '{}',
      description     TEXT,
      changed_by      TEXT,
      change_reason   TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(template_id, version_number)
    )
  `;
  await sql`CREATE INDEX ON llm.prompt_versions (template_id)`;
  await sql`CREATE INDEX ON llm.prompt_versions (template_id, version_number DESC)`;

  // Model comparison snapshots — periodic benchmarks across models
  await sql`
    CREATE TABLE llm.model_comparisons (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID,
      benchmark_prompt TEXT NOT NULL,
      models_compared TEXT[] NOT NULL,
      results         JSONB NOT NULL,
      winner          TEXT,
      recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.model_comparisons (workspace_id)`;
  await sql`CREATE INDEX ON llm.model_comparisons (recorded_at)`;

  // Pre-call cost estimates — log estimated vs actual costs
  await sql`
    CREATE TABLE llm.cost_estimates (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID NOT NULL,
      model           TEXT NOT NULL,
      prompt_tokens   INT NOT NULL,
      max_tokens      INT NOT NULL,
      estimated_cost  NUMERIC(10,6) NOT NULL,
      actual_cost    NUMERIC(10,6),
      accuracy_pct   NUMERIC(5,2),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON llm.cost_estimates (workspace_id)`;
  await sql`CREATE INDEX ON llm.cost_estimates (model)`;
}

async function migration012(sql: Sql): Promise<void> {
  // LLM observability spans — trace-level telemetry for all calls
  await sql`
    CREATE TABLE llm.llm_spans (
      id              VARCHAR(32) PRIMARY KEY,
      trace_id        VARCHAR(32) NOT NULL,
      workspace_id    UUID,
      user_id         UUID,
      provider        TEXT NOT NULL,
      model           TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'chat',
      started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at        TIMESTAMPTZ,
      duration_ms     INT,
      tokens_used     INT,
      cost_used       NUMERIC(10,6),
      success         BOOLEAN,
      error_message   TEXT
    )
  `;
  await sql`CREATE INDEX ON llm.llm_spans (trace_id)`;
  await sql`CREATE INDEX ON llm.llm_spans (workspace_id)`;
  await sql`CREATE INDEX ON llm.llm_spans (started_at)`;
  await sql`CREATE INDEX ON llm.llm_spans (workspace_id, started_at)`;
  await sql`CREATE INDEX ON llm.llm_spans (success) WHERE success IS NULL`;
}
