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
  await runMigration(sql, "004_device_management", migration004);
  await runMigration(sql, "005_passkeys", migration005);
  await runMigration(sql, "006_devices", migration006);
  await runMigration(sql, "007_passkey_credentials", migration007);
  await runMigration(sql, "008_login_events", migration008);
  await runMigration(sql, "009_workspace_members", migration009);
  await runMigration(sql, "010_login_throttle", migration010);
  await runMigration(sql, "011_oauth_tokens_api_key_scopes_audit", migration011);
  await runMigration(sql, "012_totp_lockout_fraud", migration012);
  await runMigration(sql, "013_password_history_device_mfa_ip", migration013);
  await runMigration(sql, "014_device_trust_passkey_mfa_auth_risk", migration014);
  await runMigration(sql, "015_device_trust_policies", migration015);
  await runMigration(sql, "016_session_anomalies", migration016);
  await runMigration(sql, "017_permission_delegations", migration017);
  await runMigration(sql, "018_auth_timeout_policies", migration018);
  await runMigration(sql, "019_suspicious_activities", migration019);
  await runMigration(sql, "020_oauth_authorization_codes", migration020);
  await runMigration(sql, "021_fresh_token_detection", migration021);
}

async function runMigration(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>,
): Promise<void> {
  const [existing] =
    await sql`SELECT id FROM auth._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO auth._migrations (name) VALUES (${name})`;
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

async function migration004(sql: Sql): Promise<void> {
  // Add device tracking columns to sessions
  await sql`ALTER TABLE auth.sessions ADD COLUMN IF NOT EXISTS device_id TEXT`;
  await sql`ALTER TABLE auth.sessions ADD COLUMN IF NOT EXISTS device_name TEXT`;
  await sql`ALTER TABLE auth.sessions ADD COLUMN IF NOT EXISTS is_trusted BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE auth.sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`;

  await sql`CREATE INDEX IF NOT EXISTS auth_sessions_device_id ON auth.sessions (user_id, device_id) WHERE device_id IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS auth_sessions_is_trusted ON auth.sessions (user_id, is_trusted) WHERE is_trusted = TRUE`;

  // Dedicated trusted devices table for persistent device trust across sessions
  await sql`
    CREATE TABLE auth.trusted_devices (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      device_id    TEXT NOT NULL,
      device_name  TEXT,
      fingerprint  TEXT,
      trusted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_agent   TEXT,
      ip_address   TEXT,
      UNIQUE (user_id, device_id)
    )
  `;

  await sql`CREATE INDEX ON auth.trusted_devices (user_id)`;
  await sql`CREATE INDEX ON auth.trusted_devices (device_id)`;
}

async function migration005(sql: Sql): Promise<void> {
  // WebAuthn passkeys — stores credential public keys and metadata
  await sql`
    CREATE TABLE auth.passkeys (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      credential_id   TEXT NOT NULL UNIQUE,
      public_key      TEXT NOT NULL,
      counter         BIGINT NOT NULL DEFAULT 0,
      device_type     TEXT,
      backed_up       BOOLEAN NOT NULL DEFAULT FALSE,
      transport       TEXT[],
      rp_id           TEXT,
      authenticator_label TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at    TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX ON auth.passkeys (user_id)`;
  await sql`CREATE INDEX ON auth.passkeys (credential_id)`;

  // User count index for fast lookups
  await sql`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS passkey_count INT NOT NULL DEFAULT 0`;
}

async function migration006(sql: Sql): Promise<void> {
  // Standalone devices table with richer metadata than the trusted_devices overlay
  await sql`
    CREATE TABLE auth.devices (
      device_id    TEXT PRIMARY KEY,
      user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      name         TEXT,
      type         TEXT,
      last_seen_at TIMESTAMPTZ,
      ip_address   TEXT,
      user_agent   TEXT,
      active       BOOLEAN NOT NULL DEFAULT TRUE
    )
  `;

  await sql`CREATE INDEX ON auth.devices (user_id)`;
  await sql`CREATE INDEX ON auth.devices (user_id, active)`;
}

async function migration007(sql: Sql): Promise<void> {
  // WebAuthn passkey credentials — simplified byte-based challenge/response
  await sql`
    CREATE TABLE auth.passkey_credentials (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      credential_id   TEXT NOT NULL UNIQUE,
      public_key      TEXT NOT NULL,
      counter         BIGINT NOT NULL DEFAULT 0,
      device_type     TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at    TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX ON auth.passkey_credentials (user_id)`;
  await sql`CREATE INDEX ON auth.passkey_credentials (credential_id)`;

  // Temporary challenge store for passkey authentication flow
  await sql`
    CREATE TABLE auth.passkey_challenges (
      challenge_id TEXT PRIMARY KEY,
      user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      challenge    TEXT NOT NULL,
      expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes'
    )
  `;
  await sql`CREATE INDEX ON auth.passkey_challenges (user_id)`;
  await sql`CREATE INDEX ON auth.passkey_challenges (expires_at)`;
}

async function migration008(sql: Sql): Promise<void> {
  // Login / authentication event log for forensics
  await sql`
    CREATE TABLE auth.login_events (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      event_type  TEXT NOT NULL CHECK (event_type IN (
        'login_success', 'login_failure', 'logout', 'token_refresh', 'passkey_success'
      )),
      ip          TEXT,
      user_agent  TEXT,
      device_id   TEXT,
      metadata    JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON auth.login_events (user_id)`;
  await sql`CREATE INDEX ON auth.login_events (created_at)`;
  await sql`CREATE INDEX ON auth.login_events (event_type)`;
}

async function migration009(sql: Sql): Promise<void> {
  // Workspace membership table
  await sql`
    CREATE TABLE auth.workspace_members (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      role         TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
      invited_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, user_id)
    )
  `;
  await sql`CREATE INDEX ON auth.workspace_members (workspace_id)`;
  await sql`CREATE INDEX ON auth.workspace_members (user_id)`;

  // Pending workspace invites
  await sql`
    CREATE TABLE auth.workspace_invites (
      token        TEXT PRIMARY KEY,
      workspace_id UUID NOT NULL,
      email        TEXT NOT NULL,
      role         TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
      invited_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      expires_at   TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON auth.workspace_invites (workspace_id)`;
  await sql`CREATE INDEX ON auth.workspace_invites (expires_at)`;
}

async function migration010(sql: Sql): Promise<void> {
  // Login attempt throttling
  await sql`
    CREATE TABLE auth.login_attempts (
      email            TEXT PRIMARY KEY,
      attempt_count    INT NOT NULL DEFAULT 0,
      first_attempt_at TIMESTAMPTZ,
      last_attempt_at  TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX ON auth.login_attempts (first_attempt_at)`;
}

async function migration011(sql: Sql): Promise<void> {
  // OAuth tokens (access + refresh tokens for third-party apps)
  await sql`
    CREATE TABLE auth.oauth_tokens (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      client_id           TEXT NOT NULL,
      access_token        TEXT NOT NULL,
      refresh_token_hash  TEXT NOT NULL,
      scopes              TEXT[] NOT NULL DEFAULT '{}',
      expires_at          TIMESTAMPTZ NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at        TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX ON auth.oauth_tokens (user_id)`;
  await sql`CREATE INDEX ON auth.oauth_tokens (access_token)`;
  await sql`CREATE INDEX ON auth.oauth_tokens (client_id)`;

  // OAuth clients (registered third-party applications)
  await sql`
    CREATE TABLE auth.oauth_clients (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name              TEXT NOT NULL,
      redirect_uris     TEXT[] NOT NULL DEFAULT '{}',
      scopes            TEXT[] NOT NULL DEFAULT '{}',
      client_secret_hash TEXT NOT NULL,
      is_active         BOOLEAN NOT NULL DEFAULT true,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // API key usage log (for scoped keys)
  await sql`
    CREATE TABLE auth.api_key_usage_log (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      api_key_id      UUID NOT NULL REFERENCES auth.api_keys(id) ON DELETE CASCADE,
      endpoint        TEXT NOT NULL,
      method           TEXT NOT NULL,
      status_code     INT NOT NULL,
      response_time_ms REAL NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON auth.api_key_usage_log (api_key_id)`;
  await sql`CREATE INDEX ON auth.api_key_usage_log (created_at)`;

  // Add metadata column to api_keys for rotation schedule
  await sql`ALTER TABLE auth.api_keys ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`;

  // Audit log (comprehensive auth event tracking)
  await sql`
    CREATE TABLE auth.audit_log (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type    TEXT NOT NULL,
      user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      actor_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      ip_address    TEXT,
      user_agent    TEXT,
      resource_type TEXT,
      resource_id   TEXT,
      metadata      JSONB NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON auth.audit_log (user_id)`;
  await sql`CREATE INDEX ON auth.audit_log (event_type)`;
  await sql`CREATE INDEX ON auth.audit_log (created_at)`;
  await sql`CREATE INDEX ON auth.audit_log (resource_type, resource_id)`;
  await sql`CREATE INDEX ON auth.audit_log (ip_address)`;
}

async function migration012(sql: Sql): Promise<void> {
  // TOTP two-factor enrollment (replaces legacy totp_secrets from migration002)
  await sql`
    CREATE TABLE auth.totp_enrollments (
      user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      secret          TEXT NOT NULL,
      algorithm       TEXT NOT NULL DEFAULT 'SHA1' CHECK (algorithm IN ('SHA1', 'SHA256', 'SHA512')),
      digits          INT NOT NULL DEFAULT 6 CHECK (digits IN (6, 8)),
      period          INT NOT NULL DEFAULT 30,
      verified        BOOLEAN NOT NULL DEFAULT FALSE,
      backup_codes    TEXT[] NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at    TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX ON auth.totp_enrollments (user_id)`;

  // Account lockout tracking (per-user and per-IP)
  await sql`
    CREATE TABLE auth.account_lockouts (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      ip_address      TEXT,
      lockout_type    TEXT NOT NULL CHECK (lockout_type IN ('user', 'ip', 'user_ip')),
      reason          TEXT NOT NULL DEFAULT 'failed_attempts',
      attempt_count   INT NOT NULL DEFAULT 0,
      locked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at      TIMESTAMPTZ NOT NULL,
      unlocked_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON auth.account_lockouts (user_id) WHERE user_id IS NOT NULL`;
  await sql`CREATE INDEX ON auth.account_lockouts (ip_address) WHERE ip_address IS NOT NULL`;
  await sql`CREATE INDEX ON auth.account_lockouts (expires_at)`;
  await sql`CREATE INDEX ON auth.account_lockouts (locked_at)`;

  // Enrich login_events with geo and device fingerprint data
  await sql`ALTER TABLE auth.login_events ADD COLUMN IF NOT EXISTS ip_lat REAL`;
  await sql`ALTER TABLE auth.login_events ADD COLUMN IF NOT EXISTS ip_lon REAL`;
  await sql`ALTER TABLE auth.login_events ADD COLUMN IF NOT EXISTS device_fingerprint TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS auth_login_events_ip_geo ON auth.login_events (ip_lat, ip_lon) WHERE ip_lat IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS auth_login_events_fingerprint ON auth.login_events (device_fingerprint) WHERE device_fingerprint IS NOT NULL`;
}

async function migration013(sql: Sql): Promise<void> {
  // Password history — prevents reuse of old passwords
  await sql`
    CREATE TABLE auth.password_history (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      password_hash   TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON auth.password_history (user_id)`;
  await sql`CREATE INDEX ON auth.password_history (user_id, created_at DESC)`;

  // Trusted device MFA bypass windows
  await sql`
    CREATE TABLE auth.trusted_device_mfa (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      device_id       TEXT NOT NULL,
      device_name     TEXT,
      expires_at      TIMESTAMPTZ NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at      TIMESTAMPTZ,
      last_bypassed_at TIMESTAMPTZ,
      UNIQUE (user_id, device_id)
    )
  `;
  await sql`CREATE INDEX ON auth.trusted_device_mfa (user_id)`;
  await sql`CREATE INDEX ON auth.trusted_device_mfa (expires_at) WHERE revoked_at IS NULL`;

  // IP-level login attempt tracking for distributed brute force detection
  await sql`
    CREATE TABLE auth.ip_login_attempts (
      ip_address           TEXT PRIMARY KEY,
      failed_attempts      INT NOT NULL DEFAULT 0,
      locked_until         TIMESTAMPTZ,
      last_attempted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_attempted_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
    )
  `;
  await sql`CREATE INDEX ON auth.ip_login_attempts (locked_until)`;
  await sql`CREATE INDEX ON auth.ip_login_attempts (failed_attempts DESC)`;
}

async function migration014(sql: Sql): Promise<void> {
  // Device trust scores — computed from login history, age, and verification
  await sql`
    CREATE TABLE auth.device_trust (
      device_id         TEXT PRIMARY KEY REFERENCES auth.devices(device_id) ON DELETE CASCADE,
      user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      trust_score       REAL NOT NULL DEFAULT 50.0 CHECK (trust_score >= 0 AND trust_score <= 100),
      login_count       INT NOT NULL DEFAULT 0,
      successful_logins INT NOT NULL DEFAULT 0,
      failed_logins    INT NOT NULL DEFAULT 0,
      last_successful_at TIMESTAMPTZ,
      last_failed_at    TIMESTAMPTZ,
      first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_verified       BOOLEAN NOT NULL DEFAULT FALSE,
      risk_level        TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
      metadata          JSONB NOT NULL DEFAULT '{}',
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON auth.device_trust (user_id)`;
  await sql`CREATE INDEX ON auth.device_trust (trust_score)`;
  await sql`CREATE INDEX ON auth.device_trust (risk_level)`;

  // Passkey MFA challenges — WebAuthn assertion used as a second factor
  await sql`
    CREATE TABLE auth.passkey_mfa_challenges (
      challenge_id     TEXT PRIMARY KEY,
      user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      credential_id   TEXT NOT NULL,
      challenge        TEXT NOT NULL,
      expires_at       TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',
      completed_at     TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON auth.passkey_mfa_challenges (user_id)`;
  await sql`CREATE INDEX ON auth.passkey_mfa_challenges (expires_at)`;

  // Auth risk events — aggregated risk signals per login attempt
  await sql`
    CREATE TABLE auth.auth_risk_events (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      session_id       UUID REFERENCES auth.sessions(id) ON DELETE SET NULL,
      event_type       TEXT NOT NULL CHECK (event_type IN ('login_risk', 'token_refresh_risk', 'api_auth_risk')),
      risk_score       REAL NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
      risk_level       TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
      signals          JSONB NOT NULL DEFAULT '{}',
      triggered_rules  TEXT[] NOT NULL DEFAULT '{}',
      action_taken     TEXT,
      ip_address       TEXT,
      user_agent       TEXT,
      device_id        TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON auth.auth_risk_events (user_id)`;
  await sql`CREATE INDEX ON auth.auth_risk_events (risk_level)`;
  await sql`CREATE INDEX ON auth.auth_risk_events (created_at)`;
  await sql`CREATE INDEX ON auth.auth_risk_events (risk_score DESC) WHERE risk_level IN ('high', 'critical')`;
}

async function migration015(sql: Sql): Promise<void> {
  // Device trust policies — per-workspace auto-trust/auto-revoke thresholds
  await sql`
    CREATE TABLE auth.device_trust_policies (
      id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id              UUID,
      auto_trust_threshold      REAL NOT NULL DEFAULT 70.0 CHECK (auto_trust_threshold >= 0 AND auto_trust_threshold <= 100),
      auto_revoke_threshold     REAL NOT NULL DEFAULT 30.0 CHECK (auto_revoke_threshold >= 0 AND auto_revoke_threshold <= 100),
      require_reauth_on_decline BOOLEAN NOT NULL DEFAULT TRUE,
      enabled                   BOOLEAN NOT NULL DEFAULT TRUE,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id)
    )
  `;
  await sql`CREATE INDEX ON auth.device_trust_policies (workspace_id) WHERE workspace_id IS NOT NULL`;
  await sql`CREATE INDEX ON auth.device_trust_policies (enabled)`;

  // Add trust_score and trust_level columns to devices table
  await sql`ALTER TABLE auth.devices ADD COLUMN IF NOT EXISTS trust_level TEXT DEFAULT NULL CHECK (trust_level IN ('untrusted','cautious','trusted','high_trust'))`;
  await sql`ALTER TABLE auth.devices ADD COLUMN IF NOT EXISTS trust_score REAL DEFAULT NULL CHECK (trust_score >= 0 AND trust_score <= 100)`;
  await sql`ALTER TABLE auth.devices ADD COLUMN IF NOT EXISTS last_trust_computed_at TIMESTAMPTZ DEFAULT NULL`;

  // Add index on login_events for device_id lookups
  await sql`CREATE INDEX IF NOT EXISTS auth_login_events_device_id ON auth.login_events (user_id, device_id)`;
}

async function migration016(sql: Sql): Promise<void> {
  // Session anomalies — detected suspicious session patterns
  await sql`
    CREATE TABLE auth.session_anomalies (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id    UUID NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
      user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      anomaly_type  TEXT NOT NULL CHECK (anomaly_type IN (
        'unusual_login_time', 'geographic_anomaly', 'ip_change_anomaly',
        'session_duration_anomaly', 'concurrent_session_anomaly', 'device_mismatch'
      )),
      severity      TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      detail        TEXT NOT NULL,
      detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON auth.session_anomalies (user_id)`;
  await sql`CREATE INDEX ON auth.session_anomalies (session_id)`;
  await sql`CREATE INDEX ON auth.session_anomalies (anomaly_type)`;
  await sql`CREATE INDEX ON auth.session_anomalies (severity)`;
  await sql`CREATE INDEX ON auth.session_anomalies (detected_at)`;
}

async function migration017(sql: Sql): Promise<void> {
  // Permission delegations — temporary grant of scopes from one user to another
  await sql`
    CREATE TABLE auth.permission_delegations (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      grantor_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      grantee_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      scopes          TEXT[] NOT NULL DEFAULT '{}',
      reason          TEXT,
      expires_at      TIMESTAMPTZ NOT NULL,
      revoked_at      TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON auth.permission_delegations (grantor_id)`;
  await sql`CREATE INDEX ON auth.permission_delegations (grantee_id)`;
  await sql`CREATE INDEX ON auth.permission_delegations (expires_at) WHERE revoked_at IS NULL`;
  await sql`CREATE UNIQUE INDEX ON auth.permission_delegations (grantor_id, grantee_id, created_at) WHERE revoked_at IS NULL`;
}

async function migration018(sql: Sql): Promise<void> {
  // Auth timeout policies — per-workspace and per-user session timeout configuration
  await sql`
    CREATE TABLE auth.auth_timeout_policies (
      id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id                        UUID,
      user_id                             UUID,
      session_max_age_seconds             INT NOT NULL DEFAULT 86400,
      session_idle_timeout_seconds        INT NOT NULL DEFAULT 3600,
      require_reauth_on_inactive_seconds  INT,
      enabled                             BOOLEAN NOT NULL DEFAULT TRUE,
      created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, user_id)
    )
  `;
  await sql`CREATE INDEX ON auth.auth_timeout_policies (workspace_id) WHERE workspace_id IS NOT NULL`;
  await sql`CREATE INDEX ON auth.auth_timeout_policies (user_id) WHERE user_id IS NOT NULL`;
}

async function migration019(sql: Sql): Promise<void> {
  // Suspicious auth activities — detected anomalous patterns
  await sql`
    CREATE TABLE auth.suspicious_activities (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      workspace_id    UUID,
      activity_type   TEXT NOT NULL,
      severity        TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      description     TEXT NOT NULL,
      ip_addresses    TEXT[] NOT NULL DEFAULT '{}',
      metadata        JSONB NOT NULL DEFAULT '{}',
      detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at     TIMESTAMPTZ,
      resolved_by     UUID,
      false_positive  BOOLEAN NOT NULL DEFAULT FALSE
    )
  `;
  await sql`CREATE INDEX ON auth.suspicious_activities (user_id)`;
  await sql`CREATE INDEX ON auth.suspicious_activities (workspace_id)`;
  await sql`CREATE INDEX ON auth.suspicious_activities (severity)`;
  await sql`CREATE INDEX ON auth.suspicious_activities (detected_at)`;
  await sql`CREATE INDEX ON auth.suspicious_activities (resolved_at) WHERE resolved_at IS NULL`;
}

async function migration020(sql: Sql): Promise<void> {
  // OAuth2 authorization codes — for authorization_code grant flow
  await sql`
    CREATE TABLE auth.oauth_authorization_codes (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code                TEXT NOT NULL UNIQUE,
      user_id             UUID NOT NULL,
      client_id           TEXT NOT NULL,
      redirect_uri        TEXT NOT NULL,
      scopes              TEXT[] NOT NULL DEFAULT '{}',
      code_challenge      TEXT,
      code_challenge_method TEXT,
      nonce               TEXT,
      state               TEXT,
      expires_at          TIMESTAMPTZ NOT NULL,
      used                BOOLEAN NOT NULL DEFAULT FALSE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at             TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX ON auth.oauth_authorization_codes (code)`;
  await sql`CREATE INDEX ON auth.oauth_authorization_codes (user_id, client_id)`;
  await sql`CREATE INDEX ON auth.oauth_authorization_codes (expires_at) WHERE used = FALSE`;
}

async function migration021(sql: Sql): Promise<void> {
  // Fresh token reuse detection — track token issuance and usage to detect
  // immediate reuse (potential token stealing)
  await sql`
    CREATE TABLE auth.fresh_token_events (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash          TEXT NOT NULL,
      user_id             UUID NOT NULL,
      workspace_id        UUID,
      event_type          TEXT NOT NULL CHECK (event_type IN ('issued', 'used')),
      ip_address          TEXT,
      user_agent          TEXT,
      detected_reuse      BOOLEAN NOT NULL DEFAULT FALSE,
      reuse_window_ms     BIGINT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON auth.fresh_token_events (token_hash)`;
  await sql`CREATE INDEX ON auth.fresh_token_events (user_id)`;
  await sql`CREATE INDEX ON auth.fresh_token_events (created_at) WHERE detected_reuse = TRUE`;

  await sql`
    CREATE TABLE auth.fresh_token_alerts (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             UUID NOT NULL,
      workspace_id        UUID,
      token_hash          TEXT NOT NULL,
      issued_at           TIMESTAMPTZ NOT NULL,
      reused_at           TIMESTAMPTZ NOT NULL,
      issued_ip           TEXT,
      reused_ip           TEXT,
      issued_user_agent   TEXT,
      reused_user_agent   TEXT,
      reuse_window_ms     BIGINT NOT NULL,
      severity            TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      resolved            BOOLEAN NOT NULL DEFAULT FALSE,
      resolved_at         TIMESTAMPTZ,
      resolved_by         UUID,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON auth.fresh_token_alerts (user_id)`;
  await sql`CREATE INDEX ON auth.fresh_token_alerts (workspace_id)`;
  await sql`CREATE INDEX ON auth.fresh_token_alerts (severity) WHERE resolved = FALSE`;
}
