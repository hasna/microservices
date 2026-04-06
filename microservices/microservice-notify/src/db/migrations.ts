import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS notify`;
  await sql`CREATE TABLE IF NOT EXISTS notify._migrations (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await run(sql, "001_notifications_preferences", m001);
  await run(sql, "002_templates_webhooks_delivery", m002);
  await run(sql, "003_scheduling_priorities_batch", m003);
  await run(sql, "004_channels_delivery_records_engagement_templates", m004);
  await run(sql, "005_digests_retry_log_receipts", m005);
  await run(sql, "006_template_versions_engagement_analytics", m006);
  await run(sql, "007_batch_queue_template_render_log", m007);
  await run(sql, "008_read_receipts", m008);
  await run(sql, "009_priority_rules", m009);
  await run(sql, "010_ab_tests_inbox_failover", m010);
  await run(sql, "011_delivery_windows_quiet_hours", m011);
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

async function m003(sql: Sql) {
  // Scheduled notifications + priority + retry support
  await sql`ALTER TABLE notify.notifications ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ`;
  await sql`ALTER TABLE notify.notifications ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 5`;
  await sql`ALTER TABLE notify.notifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`;
  await sql`ALTER TABLE notify.notifications ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','cancelled'))`;

  // Batch delivery support
  await sql`ALTER TABLE notify.delivery_log ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE notify.delivery_log ADD COLUMN IF NOT EXISTS max_retries INT NOT NULL DEFAULT 3`;
  await sql`ALTER TABLE notify.delivery_log ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ`;

  // Scheduled job queue
  await sql`
    CREATE TABLE IF NOT EXISTS notify.scheduled_jobs (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      notification_id UUID REFERENCES notify.notifications(id) ON DELETE CASCADE,
      status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
      scheduled_at    TIMESTAMPTZ NOT NULL,
      processed_at    TIMESTAMPTZ,
      error           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.scheduled_jobs (status, scheduled_at)`;
  await sql`CREATE INDEX ON notify.scheduled_jobs (notification_id)`;
}

async function m004(sql: Sql) {
  // --- Channel prioritization ---
  await sql`
    CREATE TABLE IF NOT EXISTS notify.channels (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID,
      name        TEXT NOT NULL,
      channel_type TEXT NOT NULL CHECK (channel_type IN ('email','sms','in_app','webhook')),
      priority    INT NOT NULL DEFAULT 0,
      active      BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.channels (workspace_id)`;
  await sql`CREATE INDEX ON notify.channels (priority DESC)`;

  // Delivery records with priority (separate from delivery_log for queue processing)
  await sql`
    CREATE TABLE IF NOT EXISTS notify.delivery_records (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      notification_id UUID REFERENCES notify.notifications(id) ON DELETE CASCADE,
      channel         TEXT NOT NULL,
      priority        INT NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
      retry_count     INT NOT NULL DEFAULT 0,
      max_retries     INT NOT NULL DEFAULT 3,
      next_retry_at   TIMESTAMPTZ,
      error           TEXT,
      sent_at         TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.delivery_records (status, priority DESC, created_at ASC)`;
  await sql`CREATE INDEX ON notify.delivery_records (notification_id)`;

  // --- Scheduled notifications (standalone queue) ---
  await sql`
    CREATE TABLE IF NOT EXISTS notify.scheduled_notifications (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id   UUID,
      channel_type   TEXT NOT NULL,
      payload        JSONB NOT NULL DEFAULT '{}',
      scheduled_for  TIMESTAMPTZ NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','cancelled','failed')),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.scheduled_notifications (status, scheduled_for ASC)`;
  await sql`CREATE INDEX ON notify.scheduled_notifications (workspace_id)`;

  // --- Notification engagement tracking ---
  await sql`
    CREATE TABLE IF NOT EXISTS notify.notification_engagement (
      notification_id UUID NOT NULL,
      channel_type    TEXT NOT NULL,
      delivered_at    TIMESTAMPTZ,
      read_at         TIMESTAMPTZ,
      clicked_at      TIMESTAMPTZ,
      metadata        JSONB,
      PRIMARY KEY (notification_id, channel_type)
    )
  `;
  await sql`CREATE INDEX ON notify.notification_engagement (notification_id)`;

  // --- Notification templates with variable support ---
  await sql`
    CREATE TABLE IF NOT EXISTS notify.notification_templates (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id     UUID,
      name             TEXT NOT NULL,
      channel_type     TEXT,
      subject_template TEXT,
      body_template    TEXT NOT NULL,
      variables        TEXT[] NOT NULL DEFAULT '{}',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.notification_templates (workspace_id)`;
  await sql`CREATE INDEX ON notify.notification_templates (name)`;
}

async function m005(sql: Sql) {
  // --- Notification digests ---
  await sql`
    CREATE TABLE IF NOT EXISTS notify.digest_schedules (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL,
      workspace_id  UUID,
      channel       TEXT NOT NULL CHECK (channel IN ('email','sms','in_app','webhook')),
      frequency     TEXT NOT NULL CHECK (frequency IN ('hourly','daily','weekly')),
      enabled       BOOLEAN NOT NULL DEFAULT true,
      hour_of_day   INT CHECK (hour_of_day >= 0 AND hour_of_day <= 23),
      day_of_week   INT CHECK (day_of_week >= 0 AND day_of_week <= 6),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, channel, frequency)
    )
  `;
  await sql`CREATE INDEX ON notify.digest_schedules (user_id)`;
  await sql`CREATE INDEX ON notify.digest_schedules (enabled, hour_of_day, day_of_week)`;

  await sql`
    CREATE TABLE IF NOT EXISTS notify.digests (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL,
      workspace_id     UUID,
      channel          TEXT NOT NULL,
      frequency        TEXT NOT NULL,
      subject          TEXT NOT NULL,
      body             TEXT NOT NULL,
      notification_ids TEXT[] NOT NULL DEFAULT '{}',
      rendered_data    JSONB NOT NULL DEFAULT '{}',
      status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','cancelled')),
      sent_at          TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.digests (user_id)`;
  await sql`CREATE INDEX ON notify.digests (status, created_at DESC)`;

  // --- Retry log with exponential backoff ---
  await sql`
    CREATE TABLE IF NOT EXISTS notify.retry_log (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      notification_id  UUID REFERENCES notify.notifications(id) ON DELETE CASCADE,
      channel          TEXT NOT NULL,
      attempt          INT NOT NULL DEFAULT 0,
      next_retry_at    TIMESTAMPTZ NOT NULL,
      last_error       TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.retry_log (notification_id)`;
  await sql`CREATE INDEX ON notify.retry_log (next_retry_at) WHERE next_retry_at > NOW()`;

  // --- Delivery receipts ---
  await sql`
    CREATE TABLE IF NOT EXISTS notify.delivery_receipts (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      notification_id     UUID NOT NULL,
      channel             TEXT NOT NULL,
      provider_message_id TEXT,
      status              TEXT NOT NULL CHECK (status IN ('queued','sent','delivered','bounced','dropped','spam','failed')),
      provider_status     TEXT,
      provider_response   JSONB,
      delivered_at        TIMESTAMPTZ,
      bounced_at          TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (notification_id, channel)
    )
  `;
  await sql`CREATE INDEX ON notify.delivery_receipts (notification_id)`;
  await sql`CREATE INDEX ON notify.delivery_receipts (status, created_at DESC)`;
  await sql`CREATE INDEX ON notify.delivery_receipts (provider_message_id)`;
}

async function m006(sql: Sql): Promise<void> {
  // Template version history — immutable append-only log
  await sql`
    CREATE TABLE IF NOT EXISTS notify.template_versions (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id       UUID NOT NULL REFERENCES notify.notification_templates(id) ON DELETE CASCADE,
      version_number    INT NOT NULL,
      name              TEXT NOT NULL,
      subject_template TEXT,
      body_template     TEXT NOT NULL,
      channel_type      TEXT,
      variables         TEXT[] NOT NULL DEFAULT '{}',
      changed_by        TEXT,
      change_reason     TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(template_id, version_number)
    )
  `;
  await sql`CREATE INDEX ON notify.template_versions (template_id, version_number DESC)`;

  // Engagement analytics — daily aggregates for time-series
  await sql`
    CREATE TABLE IF NOT EXISTS notify.engagement_daily (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID NOT NULL,
      channel_type    TEXT NOT NULL,
      date            DATE NOT NULL,
      delivered       INT NOT NULL DEFAULT 0,
      read_count      INT NOT NULL DEFAULT 0,
      clicked         INT NOT NULL DEFAULT 0,
      bounced         INT NOT NULL DEFAULT 0,
      failed          INT NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workspace_id, channel_type, date)
    )
  `;
  await sql`CREATE INDEX ON notify.engagement_daily (workspace_id, date DESC)`;
  await sql`CREATE INDEX ON notify.engagement_daily (channel_type, date DESC)`;
}

async function m007(sql: Sql): Promise<void> {
  // Batch queue: separate table for batch notification tracking
  await sql`
    CREATE TABLE IF NOT EXISTS notify.notification_delivery (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID NOT NULL,
      workspace_id    UUID,
      channel         TEXT NOT NULL CHECK (channel IN ('email','sms','in_app','webhook','push')),
      type            TEXT NOT NULL,
      title           TEXT,
      body            TEXT NOT NULL,
      data            JSONB,
      priority        INT NOT NULL DEFAULT 5,
      scheduled_at    TIMESTAMPTZ,
      status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','delivered','failed')),
      error           TEXT,
      retry_count     INT NOT NULL DEFAULT 0,
      template_id     UUID,
      delivered_at    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.notification_delivery (status, priority DESC, created_at ASC)`;
  await sql`CREATE INDEX ON notify.notification_delivery (user_id)`;
  await sql`CREATE INDEX ON notify.notification_delivery (workspace_id)`;
  await sql`CREATE INDEX ON notify.notification_delivery (channel, status)`;
  await sql`CREATE INDEX ON notify.notification_delivery (scheduled_at) WHERE scheduled_at IS NOT NULL`;

  // Template render log for analytics
  await sql`
    CREATE TABLE IF NOT EXISTS notify.notification_render_log (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id  UUID,
      workspace_id UUID,
      channel      TEXT NOT NULL,
      rendered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.notification_render_log (template_id, rendered_at DESC)`;
  await sql`CREATE INDEX ON notify.notification_render_log (workspace_id, rendered_at DESC)`;

  // Notification events for tracking opens/clicks
  await sql`
    CREATE TABLE IF NOT EXISTS notify.notification_events (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      notification_id UUID,
      template_id   UUID,
      workspace_id UUID,
      user_id      UUID,
      channel      TEXT NOT NULL,
      event_type   TEXT NOT NULL CHECK (event_type IN ('rendered','sent','delivered','opened','clicked','bounced','failed')),
      metadata     JSONB,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.notification_events (notification_id, event_type)`;
  await sql`CREATE INDEX ON notify.notification_events (template_id, event_type)`;
  await sql`CREATE INDEX ON notify.notification_events (created_at DESC)`;
}

async function m008(sql: Sql): Promise<void> {
  // Per-user read receipts — tracks which user read which notification
  await sql`
    CREATE TABLE IF NOT EXISTS notify.notification_read_receipts (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      notification_id UUID NOT NULL,
      user_id         UUID NOT NULL,
      read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (notification_id, user_id)
    )
  `;
  await sql`CREATE INDEX ON notify.notification_read_receipts (user_id, read_at DESC)`;
  await sql`CREATE INDEX ON notify.notification_read_receipts (notification_id)`;
}

async function m009(_sql: Sql): Promise<void> {
  // Priority rules engine — dynamic priority adjustment based on notification attributes
  await _sql`
    CREATE TABLE IF NOT EXISTS notify.priority_rules (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL,
      channel     TEXT,                           -- NULL = applies to all channels
      type        TEXT,                           -- notification type filter
      condition   TEXT NOT NULL,                  -- JSON condition expression
      priority_boost INT NOT NULL DEFAULT 0,      -- priority boost when matched
      enabled     BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await _sql`CREATE INDEX ON notify.priority_rules (channel, enabled)`;
  await _sql`CREATE INDEX ON notify.priority_rules (type, enabled)`;
}

async function m010(sql: Sql): Promise<void> {
  // A/B testing for notification templates and timing
  await sql`
    CREATE TABLE IF NOT EXISTS notify.ab_tests (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id        UUID NOT NULL,
      name                TEXT NOT NULL,
      description         TEXT,
      target_users        UUID[] NOT NULL DEFAULT '{}',
      control_user_count  INT NOT NULL DEFAULT 0,
      variant_user_count  INT NOT NULL DEFAULT 0,
      start_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      end_at              TIMESTAMPTZ,
      status              TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'running', 'paused', 'completed', 'cancelled')),
      winning_variant     UUID,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.ab_tests (workspace_id, status)`;
  await sql`CREATE INDEX ON notify.ab_tests (start_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS notify.ab_test_variants (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      test_id           UUID NOT NULL REFERENCES notify.ab_tests(id) ON DELETE CASCADE,
      name              TEXT NOT NULL,
      template_id       UUID,
      subject_template  TEXT,
      body_template     TEXT,
      channel           TEXT NOT NULL,
      send_delay_seconds INT,
      weight            INT NOT NULL DEFAULT 50 CHECK (weight >= 0 AND weight <= 100),
      sends             INT NOT NULL DEFAULT 0,
      opens             INT NOT NULL DEFAULT 0,
      clicks            INT NOT NULL DEFAULT 0,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.ab_test_variants (test_id)`;

  // Notification inbox — persistent per-user inbox with read/archive state
  await sql`
    CREATE TABLE IF NOT EXISTS notify.inbox_items (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID NOT NULL,
      notification_id UUID,
      workspace_id    UUID,
      title           TEXT NOT NULL,
      body            TEXT NOT NULL,
      channel         TEXT NOT NULL,
      priority        INT NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'unread'
        CHECK (status IN ('unread', 'read', 'archived', 'deleted')),
      read_at         TIMESTAMPTZ,
      archived_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.inbox_items (user_id, status)`;
  await sql`CREATE INDEX ON notify.inbox_items (user_id, created_at DESC)`;
  await sql`CREATE INDEX ON notify.inbox_items (user_id, priority DESC)`;

  // Channel failover rules
  await sql`
    CREATE TABLE IF NOT EXISTS notify.channel_failover_rules (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id        UUID,
      user_id             UUID,
      primary_channel     TEXT NOT NULL,
      failover_channel    TEXT NOT NULL,
      trigger             TEXT NOT NULL DEFAULT 'delivery_failure'
        CHECK (trigger IN ('delivery_failure', 'channel_disabled', 'rate_limit', 'user_preference_off')),
      max_retries         INT NOT NULL DEFAULT 3,
      retry_delay_seconds  INT NOT NULL DEFAULT 60,
      enabled             BOOLEAN NOT NULL DEFAULT TRUE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.channel_failover_rules (primary_channel, enabled)`;
  await sql`CREATE INDEX ON notify.channel_failover_rules (workspace_id) WHERE workspace_id IS NOT NULL`;

  // Failover event log
  await sql`
    CREATE TABLE IF NOT EXISTS notify.failover_events (
      id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id                   UUID,
      workspace_id              UUID,
      user_id                   UUID,
      primary_channel           TEXT NOT NULL,
      failover_channel          TEXT NOT NULL,
      trigger                   TEXT NOT NULL,
      original_notification_id   UUID,
      failover_notification_id  UUID,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.failover_events (created_at)`;
  await sql`CREATE INDEX ON notify.failover_events (workspace_id)`;
}

async function m011(sql: Sql) {
  // Delivery windows — restrict when notifications can be sent per user
  await sql`
    CREATE TABLE notify.delivery_windows (
      id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
      user_id         UUID NOT NULL,
      channel         TEXT NOT NULL,
      day_of_week     INT[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
      start_hour      INT NOT NULL DEFAULT 9,
      start_minute    INT NOT NULL DEFAULT 0,
      end_hour        INT NOT NULL DEFAULT 21,
      end_minute      INT NOT NULL DEFAULT 0,
      timezone        TEXT NOT NULL DEFAULT 'UTC',
      is_active       BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, channel)
    )
  `;
  await sql`CREATE INDEX ON notify.delivery_windows (user_id) WHERE is_active = true`;

  // Quiet hours — no notifications during specified time window
  await sql`
    CREATE TABLE notify.quiet_hours (
      id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
      user_id         UUID UNIQUE NOT NULL,
      start_hour      INT NOT NULL DEFAULT 22,
      start_minute    INT NOT NULL DEFAULT 0,
      end_hour        INT NOT NULL DEFAULT 7,
      end_minute      INT NOT NULL DEFAULT 0,
      timezone        TEXT NOT NULL DEFAULT 'UTC',
      is_active       BOOLEAN NOT NULL DEFAULT true,
      channels_affected TEXT[] NOT NULL DEFAULT '{"email", "in_app"}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.quiet_hours (user_id) WHERE is_active = true`;

  // Snoozed notifications — temporarily held notifications
  await sql`
    CREATE TABLE notify.snoozed_notifications (
      notification_id  VARCHAR(36) PRIMARY KEY,
      user_id          UUID NOT NULL,
      snoozed_until    TIMESTAMPTZ NOT NULL,
      original_channel TEXT NOT NULL,
      original_priority INT NOT NULL DEFAULT 5,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON notify.snoozed_notifications (user_id) WHERE snoozed_until > NOW()`;
  await sql`CREATE INDEX ON notify.snoozed_notifications (snoozed_until)`;
}
