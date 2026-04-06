/**
 * PostgreSQL migrations for microservice-sessions.
 * All tables live in the `sessions` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS sessions`;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await runMigration(sql, "001_conversations_messages", migration001);
  await runMigration(sql, "002_summaries_fork_tree", migration002);
  await runMigration(sql, "003_session_summaries_lineage_search_analytics", migration003);
  await runMigration(sql, "004_templates_snapshots_diff", migration004);
  await runMigration(sql, "005_annotations_retention", migration005);
  await runMigration(sql, "006_tags_metrics_response_times", migration006);
  await runMigration(sql, "007_fork_lifecycle_importance_scheduled_archival", migration007);
  await runMigration(sql, "008_retention_history_analytics", migration008);
  await runMigration(sql, "009_fork_pins_summary_settings", migration009);
  await runMigration(sql, "010_sharing_merge_content_filter", migration010);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>,
): Promise<void> {
  const [existing] =
    await sql`SELECT id FROM sessions._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO sessions._migrations (name) VALUES (${name})`;
  });
}

async function migration001(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE sessions.conversations (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id  UUID NOT NULL,
      user_id       UUID NOT NULL,
      title         TEXT,
      model         TEXT,
      system_prompt TEXT,
      metadata      JSONB NOT NULL DEFAULT '{}',
      is_archived   BOOLEAN NOT NULL DEFAULT false,
      is_pinned     BOOLEAN NOT NULL DEFAULT false,
      total_tokens  INT NOT NULL DEFAULT 0,
      message_count INT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON sessions.conversations (workspace_id, user_id)`;
  await sql`CREATE INDEX ON sessions.conversations (is_archived)`;
  await sql`CREATE INDEX ON sessions.conversations (created_at DESC)`;

  await sql`
    CREATE TABLE sessions.messages (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES sessions.conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
      content         TEXT NOT NULL,
      name            TEXT,
      tool_calls      JSONB,
      tokens          INT NOT NULL DEFAULT 0,
      latency_ms      INT,
      model           TEXT,
      metadata        JSONB NOT NULL DEFAULT '{}',
      is_pinned       BOOLEAN NOT NULL DEFAULT false,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX ON sessions.messages (conversation_id, created_at)`;
  await sql`CREATE INDEX ON sessions.messages (role)`;
  await sql`CREATE INDEX ON sessions.messages USING gin(to_tsvector('english', content))`;
}

async function migration002(sql: Sql): Promise<void> {
  // Fork tree: parent/child conversation relationships
  await sql`ALTER TABLE sessions.conversations ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES sessions.conversations(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE sessions.conversations ADD COLUMN IF NOT EXISTS fork_depth INT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE sessions.conversations ADD COLUMN IF NOT EXISTS summary TEXT`;
  await sql`ALTER TABLE sessions.conversations ADD COLUMN IF NOT EXISTS summary_tokens INT`;
  await sql`ALTER TABLE sessions.conversations ADD COLUMN IF NOT EXISTS is_fork_pinned BOOLEAN NOT NULL DEFAULT false`;

  await sql`CREATE INDEX IF NOT EXISTS sessions_conversations_parent_id ON sessions.conversations (parent_id)`;

  // Fork metadata stored per message
  await sql`ALTER TABLE sessions.messages ADD COLUMN IF NOT EXISTS fork_point BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE sessions.messages ADD COLUMN IF NOT EXISTS summary_of_prior BOOLEAN NOT NULL DEFAULT false`;

  // Tree tracking: canonical root conversation
  await sql`ALTER TABLE sessions.conversations ADD COLUMN IF NOT EXISTS root_id UUID REFERENCES sessions.conversations(id) ON DELETE SET NULL`;
  await sql`CREATE INDEX IF NOT EXISTS sessions_conversations_root_id ON sessions.conversations (root_id)`;
}

async function migration003(sql: Sql): Promise<void> {
  // ── Feature 1: session_summaries ──────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.session_summaries (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id            UUID NOT NULL REFERENCES sessions.conversations(id) ON DELETE CASCADE,
      summary_text          TEXT NOT NULL,
      model_used            TEXT,
      summarized_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      original_message_count INT NOT NULL DEFAULT 0
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS sessions_session_summaries_session_id ON sessions.session_summaries (session_id)`;

  // ── Feature 2: fork sessions — parent_session_id already covered by parent_id ──
  // is_fork_pinned already exists as is_fork_pinned; pin_session / unpin_session reuse setForkPinned
  // We add a convenience parent_session_id alias column (same as parent_id, for clarity in session-specific queries)
  await sql`ALTER TABLE sessions.conversations ADD COLUMN IF NOT EXISTS parent_session_id UUID REFERENCES sessions.conversations(id) ON DELETE SET NULL`;
  // back-fill parent_session_id from existing parent_id rows
  await sql`UPDATE sessions.conversations SET parent_session_id = parent_id WHERE parent_id IS NOT NULL AND parent_session_id IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS sessions_conversations_parent_session_id ON sessions.conversations (parent_session_id)`;

  // ── Feature 3: session search — full-text index on messages (already in 001) ──
  // Add a GIN index on conversation metadata for JSONB containment queries
  await sql`CREATE INDEX IF NOT EXISTS sessions_conversations_metadata_gin ON sessions.conversations USING gin(metadata)`;

  // Add tsvector column + index on messages for ranked search
  await sql`ALTER TABLE sessions.messages ADD COLUMN IF NOT EXISTS content_tsvector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`;
  await sql`CREATE INDEX IF NOT EXISTS sessions_messages_content_tsvector ON sessions.messages USING gin(content_tsvector)`;

  // ── Feature 4: session activity / analytics ───────────────────────────────
  // active sessions view (last message within last hour) — implemented as a query function; no new table needed.
  // We'll track last_activity_at via updated_at (already maintained on message insert).
  await sql`ALTER TABLE sessions.conversations ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  // Keep last_activity_at in sync with updated_at (updated by message inserts)
  await sql`CREATE INDEX IF NOT EXISTS sessions_conversations_last_activity ON sessions.conversations (last_activity_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS sessions_conversations_workspace_activity ON sessions.conversations (workspace_id, last_activity_at DESC)`;
}

async function migration004(sql: Sql): Promise<void> {
  // Session templates (reusable session templates with variable placeholders)
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.session_templates (
      id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id           UUID NOT NULL,
      user_id                UUID,
      name                   TEXT NOT NULL,
      description            TEXT,
      system_prompt_template TEXT NOT NULL,
      variables              TEXT[] NOT NULL DEFAULT '{}',
      default_model          TEXT,
      metadata               JSONB NOT NULL DEFAULT '{}',
      use_count              INT NOT NULL DEFAULT 0,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON sessions.session_templates (workspace_id)`;
  await sql`CREATE INDEX ON sessions.session_templates (user_id) WHERE user_id IS NOT NULL`;

  // Session snapshots (point-in-time snapshots for audit/rollback)
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.session_snapshots (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id     UUID NOT NULL REFERENCES sessions.conversations(id) ON DELETE CASCADE,
      label          TEXT,
      description    TEXT,
      snapshot_data  JSONB NOT NULL,
      message_count  INT NOT NULL DEFAULT 0,
      total_tokens   INT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON sessions.session_snapshots (session_id)`;
  await sql`CREATE INDEX ON sessions.session_snapshots (created_at DESC)`;
}

async function migration005(sql: Sql): Promise<void> {
  // Session annotations (bookmarks, notes, highlights, tags, issues)
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.session_annotations (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id       UUID NOT NULL REFERENCES sessions.conversations(id) ON DELETE CASCADE,
      message_id       UUID REFERENCES sessions.messages(id) ON DELETE CASCADE,
      start_message_id UUID REFERENCES sessions.messages(id) ON DELETE CASCADE,
      end_message_id   UUID REFERENCES sessions.messages(id) ON DELETE CASCADE,
      annotation_type  TEXT NOT NULL CHECK (annotation_type IN ('bookmark', 'note', 'highlight', 'tag', 'issue')),
      label            TEXT NOT NULL,
      content          JSONB NOT NULL DEFAULT '{}',
      metadata         JSONB NOT NULL DEFAULT '{}',
      created_by       UUID,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON sessions.session_annotations (session_id)`;
  await sql`CREATE INDEX ON sessions.session_annotations (message_id) WHERE message_id IS NOT NULL`;
  await sql`CREATE INDEX ON sessions.session_annotations (annotation_type)`;
  await sql`CREATE INDEX ON sessions.session_annotations (created_by) WHERE created_by IS NOT NULL`;

  // Retention policies (archive, delete, or snapshot_then_delete sessions)
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.retention_policies (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id     UUID,
      user_id          UUID,
      name             TEXT NOT NULL,
      description      TEXT,
      scope            TEXT NOT NULL CHECK (scope IN ('workspace', 'user', 'global')),
      retention_action TEXT NOT NULL CHECK (retention_action IN ('archive', 'delete', 'snapshot_then_delete')),
      min_age_days     INT NOT NULL DEFAULT 30,
      max_age_days     INT,
      conditions       JSONB,
      enabled          BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON sessions.retention_policies (workspace_id) WHERE workspace_id IS NOT NULL`;
  await sql`CREATE INDEX ON sessions.retention_policies (user_id) WHERE user_id IS NOT NULL`;
  await sql`CREATE INDEX ON sessions.retention_policies (scope)`;
  await sql`CREATE INDEX ON sessions.retention_policies (enabled)`;
}

async function migration006(sql: Sql): Promise<void> {
  // Session tags — lightweight per-session labels
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.session_tags (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id  UUID NOT NULL REFERENCES sessions.conversations(id) ON DELETE CASCADE,
      tag         TEXT NOT NULL,
      color       TEXT,
      created_by  UUID,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, tag)
    )
  `;
  await sql`CREATE INDEX ON sessions.session_tags (session_id)`;
  await sql`CREATE INDEX ON sessions.session_tags (tag)`;

  // Session bookmarks — per-message bookmarks within a session
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.session_bookmarks (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id  UUID NOT NULL REFERENCES sessions.conversations(id) ON DELETE CASCADE,
      message_id  UUID NOT NULL REFERENCES sessions.messages(id) ON DELETE CASCADE,
      label       TEXT,
      note        TEXT,
      created_by  UUID,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, message_id)
    )
  `;
  await sql`CREATE INDEX ON sessions.session_bookmarks (session_id)`;
  await sql`CREATE INDEX ON sessions.session_bookmarks (message_id)`;

  // Session usage metrics — aggregated token/cost stats per session
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.session_metrics (
      session_id              UUID PRIMARY KEY REFERENCES sessions.conversations(id) ON DELETE CASCADE,
      message_count           INT NOT NULL DEFAULT 0,
      user_message_count      INT NOT NULL DEFAULT 0,
      assistant_message_count INT NOT NULL DEFAULT 0,
      prompt_tokens           INT NOT NULL DEFAULT 0,
      completion_tokens       INT NOT NULL DEFAULT 0,
      total_tokens            INT NOT NULL DEFAULT 0,
      estimated_cost_cents    NUMERIC(10,4),
      avg_response_time_ms    REAL,
      last_message_at        TIMESTAMPTZ,
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON sessions.session_metrics (total_tokens DESC)`;
  await sql`CREATE INDEX ON sessions.session_metrics (last_message_at DESC)`;

  // Individual response time samples for rolling average
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.session_response_times (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id      UUID NOT NULL REFERENCES sessions.conversations(id) ON DELETE CASCADE,
      response_time_ms REAL NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON sessions.session_response_times (session_id)`;
  await sql`CREATE INDEX ON sessions.session_response_times (created_at DESC)`;
}

async function migration008(sql: Sql): Promise<void> {
  // Retention history — audit log of all retention policy executions
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.retention_history (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_id         UUID NOT NULL REFERENCES sessions.retention_policies(id) ON DELETE CASCADE,
      conversation_id   UUID NOT NULL,
      action            TEXT NOT NULL CHECK (action IN ('archive','soft_delete','hard_delete','summarize')),
      importance_score  REAL,
      access_count      INT,
      age_days          REAL,
      reason            TEXT NOT NULL,
      executed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON sessions.retention_history (policy_id)`;
  await sql`CREATE INDEX ON sessions.retention_history (conversation_id)`;
  await sql`CREATE INDEX ON sessions.retention_history (executed_at DESC)`;
  await sql`CREATE INDEX ON sessions.retention_history (action)`;

  // Session retention policy execution log
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.retention_policy_runs (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_id    UUID NOT NULL REFERENCES sessions.retention_policies(id) ON DELETE CASCADE,
      archived     INT NOT NULL DEFAULT 0,
      deleted      INT NOT NULL DEFAULT 0,
      preserved    INT NOT NULL DEFAULT 0,
      dry_run      BOOLEAN NOT NULL DEFAULT FALSE,
      executed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON sessions.retention_policy_runs (policy_id)`;
  await sql`CREATE INDEX ON sessions.retention_policy_runs (executed_at DESC)`;
}

async function migration007(sql: Sql): Promise<void> {
  // Session importance scores — computed from activity, annotations, forks, and metadata
  await sql`
    CREATE TABLE sessions.session_importance (
      session_id              UUID PRIMARY KEY REFERENCES sessions.conversations(id) ON DELETE CASCADE,
      importance_score       REAL NOT NULL DEFAULT 50.0 CHECK (importance_score >= 0 AND importance_score <= 100),
      activity_score         REAL NOT NULL DEFAULT 0,
      annotation_score       REAL NOT NULL DEFAULT 0,
      fork_score              REAL NOT NULL DEFAULT 0,
      metadata_score          REAL NOT NULL DEFAULT 0,
      is_pinned_override     BOOLEAN,
      computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON sessions.session_importance (importance_score DESC)`;
  await sql`CREATE INDEX ON sessions.session_importance (updated_at)`;

  // Fork lifecycle state machine — tracks forks through active → archived → deleted
  await sql`
    CREATE TABLE sessions.fork_lifecycle (
      fork_id               UUID PRIMARY KEY REFERENCES sessions.conversations(id) ON DELETE CASCADE,
      parent_session_id    UUID REFERENCES sessions.conversations(id) ON DELETE SET NULL,
      lifecycle_state       TEXT NOT NULL DEFAULT 'active'
        CHECK (lifecycle_state IN ('active', 'archived', 'orphaned', 'promoted', 'deleted')),
      archived_at           TIMESTAMPTZ,
      deleted_at            TIMESTAMPTZ,
      promoted_to_session_id UUID REFERENCES sessions.conversations(id) ON DELETE SET NULL,
      preservation_reason   TEXT,
      last_accessed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON sessions.fork_lifecycle (parent_session_id)`;
  await sql`CREATE INDEX ON sessions.fork_lifecycle (lifecycle_state)`;
  await sql`CREATE INDEX ON sessions.fork_lifecycle (last_accessed_at)`;

  // Scheduled archival jobs — tracks pending/future archival tasks
  await sql`
    CREATE TABLE sessions.scheduled_archivals (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id          UUID NOT NULL REFERENCES sessions.conversations(id) ON DELETE CASCADE,
      scheduled_for       TIMESTAMPTZ NOT NULL,
      action              TEXT NOT NULL CHECK (action IN ('archive', 'delete', 'snapshot_then_delete', 'summarize')),
      status              TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
      retention_policy_id UUID,
      error_message       TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at        TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX ON sessions.scheduled_archivals (session_id)`;
  await sql`CREATE INDEX ON sessions.scheduled_archivals (status)`;
  await sql`CREATE INDEX ON sessions.scheduled_archivals (scheduled_for) WHERE status = 'pending'`;
  await sql`CREATE INDEX ON sessions.scheduled_archivals (retention_policy_id) WHERE retention_policy_id IS NOT NULL`;
}

async function migration009(sql: Sql): Promise<void> {
  // Fork pinning — explicit pin records with who/when/why
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.fork_pins (
      fork_id       UUID PRIMARY KEY REFERENCES sessions.conversations(id) ON DELETE CASCADE,
      pinned_by     UUID,
      pinned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      pin_note      TEXT,
      auto_protect  BOOLEAN NOT NULL DEFAULT TRUE
    )
  `;
  await sql`CREATE INDEX ON sessions.fork_pins (pinned_by) WHERE pinned_by IS NOT NULL`;
  await sql`CREATE INDEX ON sessions.fork_pins (pinned_at)`;

  // Context summary settings per workspace
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.summary_settings (
      workspace_id              UUID PRIMARY KEY,
      default_keep_recent      INT NOT NULL DEFAULT 5,
      default_target_tokens    INT NOT NULL DEFAULT 2000,
      auto_summarize_threshold INT NOT NULL DEFAULT 6000,
      summarize_model          TEXT,
      enabled                  BOOLEAN NOT NULL DEFAULT TRUE,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function migration010(sql: Sql): Promise<void> {
  // Session sharing — ACL-based sharing with users and teams
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.session_shares (
      session_id    UUID NOT NULL REFERENCES sessions.conversations(id) ON DELETE CASCADE,
      share_type    TEXT NOT NULL CHECK (share_type IN ('user', 'team')),
      principal_id  UUID NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'admin')),
      shared_by     UUID NOT NULL,
      shared_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at    TIMESTAMPTZ,
      note          TEXT,
      PRIMARY KEY (session_id, share_type, principal_id)
    )
  `;
  await sql`CREATE INDEX ON sessions.session_shares (principal_id) WHERE share_type = 'user'`;
  await sql`CREATE INDEX ON sessions.session_shares (principal_id) WHERE share_type = 'team'`;
  await sql`CREATE INDEX ON sessions.session_shares (shared_by)`;
  await sql`CREATE INDEX ON sessions.session_shares (expires_at) WHERE expires_at IS NOT NULL`;

  // Team memberships (needed for team-based sharing)
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.team_memberships (
      team_id   UUID NOT NULL,
      user_id   UUID NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (team_id, user_id)
    )
  `;
  await sql`CREATE INDEX ON sessions.team_memberships (user_id)`;

  // Merge history — tracks 3-way merge operations
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.merge_history (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      new_session_id     UUID NOT NULL REFERENCES sessions.conversations(id) ON DELETE CASCADE,
      source_session_id  UUID NOT NULL,
      target_session_id  UUID NOT NULL,
      ancestor_session_id UUID NOT NULL,
      messages_merged    INT NOT NULL DEFAULT 0,
      conflicts_resolved INT NOT NULL DEFAULT 0,
      merge_strategy     TEXT NOT NULL,
      performed_by       UUID,
      performed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON sessions.merge_history (source_session_id)`;
  await sql`CREATE INDEX ON sessions.merge_history (target_session_id)`;
  await sql`CREATE INDEX ON sessions.merge_history (performed_by)`;

  // Content filter logs — tracks redaction events
  await sql`
    CREATE TABLE IF NOT EXISTS sessions.content_filter_logs (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id   UUID REFERENCES sessions.conversations(id) ON DELETE SET NULL,
      user_id      UUID,
      pattern_type TEXT NOT NULL,
      matches_found INT NOT NULL DEFAULT 0,
      action       TEXT NOT NULL CHECK (action IN ('detected', 'redacted')),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON sessions.content_filter_logs (session_id)`;
  await sql`CREATE INDEX ON sessions.content_filter_logs (pattern_type)`;
  await sql`CREATE INDEX ON sessions.content_filter_logs (created_at DESC)`;
}
