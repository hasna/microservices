/**
 * PostgreSQL migrations for microservice-memory.
 * All tables live in the `memory` schema.
 */

import type { Sql } from "postgres";

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS memory`;

  await sql`
    CREATE TABLE IF NOT EXISTS memory._migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await run(sql, "001_collections_memories", async (sql) => {
    try { await sql`CREATE EXTENSION IF NOT EXISTS vector`; } catch {}

    await sql`CREATE TABLE memory.collections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      user_id UUID,
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (workspace_id, name)
    )`;

    await sql`CREATE TABLE memory.memories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      user_id UUID,
      collection_id UUID REFERENCES memory.collections(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      summary TEXT,
      importance REAL DEFAULT 0.5,
      metadata JSONB DEFAULT '{}',
      embedding_text TEXT,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    try {
      await sql`ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS embedding vector(1536)`;
      await sql`CREATE INDEX IF NOT EXISTS memory_memories_embedding ON memory.memories USING ivfflat (embedding vector_cosine_ops)`;
    } catch {}

    await sql`CREATE INDEX IF NOT EXISTS memory_memories_fts ON memory.memories USING gin(to_tsvector('english', content))`;
    await sql`CREATE INDEX ON memory.memories (workspace_id, user_id, created_at DESC)`;
  });

  await run(sql, "002_namespaces_types_ttl", async (sql) => {
    await sql`ALTER TABLE memory.collections ADD COLUMN IF NOT EXISTS namespace TEXT NOT NULL DEFAULT 'default'`;
    await sql`CREATE INDEX IF NOT EXISTS memory_collections_namespace ON memory.collections (workspace_id, namespace)`;
    await sql`ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS memory_type TEXT NOT NULL DEFAULT 'semantic' CHECK (memory_type IN ('episodic', 'semantic', 'procedural', 'context'))`;
    await sql`CREATE INDEX IF NOT EXISTS memory_memories_type ON memory.memories (memory_type)`;
    await sql`ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0`;
    await sql`CREATE INDEX IF NOT EXISTS memory_memories_priority ON memory.memories (priority DESC) WHERE expires_at IS NULL`;
    await sql`ALTER TABLE memory.collections ADD COLUMN IF NOT EXISTS default_ttl_seconds INT`;
  });

  await run(sql, "003_fork_pin_ttl", async (sql) => {
    await sql`ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS ttl_seconds INT DEFAULT 0`;
    await sql`ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false`;
    await sql`CREATE INDEX IF NOT EXISTS memory_memories_pinned ON memory.memories (is_pinned) WHERE is_pinned = true`;
    await sql`ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ`;
  });

  await run(sql, "004_access_log", async (sql) => {
    await sql`CREATE TABLE memory.memory_access_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      memory_id UUID NOT NULL REFERENCES memory.memories(id) ON DELETE CASCADE,
      accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      access_type TEXT NOT NULL CHECK (access_type IN ('read', 'write', 'search')),
      response_time_ms REAL
    )`;
    await sql`CREATE INDEX IF NOT EXISTS memory_access_log_mem_id ON memory.memory_access_log (memory_id, accessed_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS memory_access_log_freq ON memory.memory_access_log (accessed_at DESC)`;
  });

  await run(sql, "005_workspace_memories", async (sql) => {
    await sql`CREATE TABLE memory.workspace_memories (
      workspace_id UUID NOT NULL,
      memory_id UUID NOT NULL REFERENCES memory.memories(id) ON DELETE CASCADE,
      added_by UUID,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      permissions TEXT NOT NULL DEFAULT 'read',
      PRIMARY KEY (workspace_id, memory_id)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS memory_workspace_memories_ws ON memory.workspace_memories (workspace_id)`;
    await sql`CREATE INDEX IF NOT EXISTS memory_workspace_memories_mem ON memory.workspace_memories (memory_id)`;
  });

  await run(sql, "006_recall_log", async (sql) => {
    await sql`CREATE TABLE memory.memory_recall_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      memory_id UUID NOT NULL REFERENCES memory.memories(id) ON DELETE CASCADE,
      recalled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      success BOOLEAN NOT NULL,
      latency_ms REAL,
      method TEXT NOT NULL CHECK (method IN ('search', 'direct', 'recommend'))
    )`;
    await sql`CREATE INDEX IF NOT EXISTS memory_recall_log_mem_id ON memory.memory_recall_log (memory_id, recalled_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS memory_recall_log_success ON memory.memory_recall_log (success) WHERE success = false`;
  });

  await run(sql, "007_memory_templates", async (sql) => {
    await sql`CREATE TABLE memory.memory_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      user_id UUID,
      name TEXT NOT NULL,
      description TEXT,
      content_template TEXT NOT NULL,
      variables TEXT[] NOT NULL DEFAULT '{}',
      default_memory_type TEXT NOT NULL DEFAULT 'semantic'
        CHECK (default_memory_type IN ('episodic', 'semantic', 'procedural', 'context')),
      default_priority INT NOT NULL DEFAULT 0,
      metadata_template JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS memory_templates_ws ON memory.memory_templates (workspace_id)`;
    await sql`CREATE INDEX IF NOT EXISTS memory_templates_user ON memory.memory_templates (user_id) WHERE user_id IS NOT NULL`;
  });

  await run(sql, "008_links_policies", async (sql) => {
    // Memory relationship links (parent-child, related, references, derived_from)
    await sql`
      CREATE TABLE memory.memory_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_id UUID NOT NULL REFERENCES memory.memories(id) ON DELETE CASCADE,
        target_id UUID NOT NULL REFERENCES memory.memories(id) ON DELETE CASCADE,
        link_type TEXT NOT NULL CHECK (link_type IN ('parent', 'child', 'related', 'references', 'derived_from')),
        label TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (source_id, target_id, link_type)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS memory_links_source ON memory.memory_links (source_id)`;
    await sql`CREATE INDEX IF NOT EXISTS memory_links_target ON memory.memory_links (target_id)`;
    await sql`CREATE INDEX IF NOT EXISTS memory_links_type ON memory.memory_links (link_type)`;

    // Collection-level policies (default TTL, memory type, importance, max memories, auto-consolidation)
    await sql`
      CREATE TABLE memory.collection_policies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        collection_id UUID NOT NULL REFERENCES memory.collections(id) ON DELETE CASCADE,
        workspace_id UUID NOT NULL,
        default_memory_type TEXT CHECK (default_memory_type IN ('episodic', 'semantic', 'procedural', 'context')),
        default_importance REAL CHECK (default_importance BETWEEN 0 AND 1),
        default_priority INT,
        default_ttl_seconds INT,
        max_memories INT,
        allow_duplicates BOOLEAN DEFAULT TRUE,
        auto_consolidate BOOLEAN DEFAULT FALSE,
        consolidation_window_hours INT DEFAULT 24,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (collection_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS memory_collection_policies_ws ON memory.collection_policies (workspace_id)`;

    // Scheduled consolidation policies for automatic episodic memory consolidation
    await sql`
      CREATE TABLE memory.consolidation_policies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL,
        namespace TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        trigger TEXT NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('schedule', 'count_threshold', 'size_threshold', 'manual')),
        cron_expression TEXT,
        min_episodic_count INT,
        min_total_size_bytes BIGINT,
        window_hours INT NOT NULL DEFAULT 24,
        consolidation_mode TEXT NOT NULL DEFAULT 'summary_only' CHECK (consolidation_mode IN ('summary_only', 'delete_source', 'archive')),
        priority_threshold INT,
        memory_type_filter TEXT,
        last_triggered_at TIMESTAMPTZ,
        next_scheduled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id, namespace, name)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS memory_consolidation_policies_ws ON memory.consolidation_policies (workspace_id)`;
    await sql`CREATE INDEX IF NOT EXISTS memory_consolidation_policies_enabled ON memory.consolidation_policies (enabled) WHERE enabled = true`;
  });

  await run(sql, "009_boosts_dedup_timefilter", async (sql) => {
    // Temporary importance boosts for high-relevance memories
    await sql`
      CREATE TABLE memory.memory_boosts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        memory_id UUID NOT NULL REFERENCES memory.memories(id) ON DELETE CASCADE,
        boost_type TEXT NOT NULL DEFAULT 'manual'
          CHECK (boost_type IN ('manual', 'accessed', 'referenced', 'linked', 'searched')),
        boost_value REAL NOT NULL DEFAULT 1.0,
        reason TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS memory_boosts_mem_id ON memory.memory_boosts (memory_id) WHERE expires_at > NOW()`;
    await sql`CREATE INDEX IF NOT EXISTS memory_boosts_expires ON memory.memory_boosts (expires_at) WHERE expires_at > NOW()`;

    // Deduplication snapshots: stores simhash/fingerprint of memory content
    await sql`
      CREATE TABLE memory.memory_dedup_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        memory_id UUID NOT NULL REFERENCES memory.memories(id) ON DELETE CASCADE,
        content_simhash BIGINT NOT NULL,
        content_fingerprint TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        jaro_winkler_score REAL NOT NULL DEFAULT 1.0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS memory_dedup_snapshots_hash ON memory.memory_dedup_snapshots (content_hash)`;
    await sql`CREATE INDEX IF NOT EXISTS memory_dedup_snapshots_simhash ON memory.memory_dedup_snapshots (content_simhash)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS memory_dedup_snapshots_mem ON memory.memory_dedup_snapshots (memory_id)`;

    // Time-range indexes for fast temporal queries
    await sql`CREATE INDEX IF NOT EXISTS memory_memories_created_idx ON memory.memories (created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS memory_memories_time_range ON memory.memories (workspace_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS memory_memories_updated_idx ON memory.memories (updated_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS memory_access_log_time_idx ON memory.memory_access_log (accessed_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS memory_access_log_time_mem ON memory.memory_access_log (memory_id, accessed_at DESC)`;
  });

  await run(sql, "010_decay_rules_namespaces_type_configs", async (sql) => {
    // Decay rules per workspace/namespace/memory type
    await sql`
      CREATE TABLE memory.decay_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL,
        namespace TEXT NOT NULL DEFAULT '',
        memory_type TEXT NOT NULL DEFAULT '',
        decay_model TEXT NOT NULL DEFAULT 'exponential'
          CHECK (decay_model IN ('linear', 'exponential', 'logarithmic')),
        initial_half_life_hours INT NOT NULL DEFAULT 168,
        min_importance REAL NOT NULL DEFAULT 0.1,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id, namespace, memory_type)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS memory_decay_rules_ws ON memory.decay_rules (workspace_id)`;

    // Memory namespaces
    await sql`
      CREATE TABLE memory.namespaces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        default_ttl_seconds INT,
        default_memory_type TEXT NOT NULL DEFAULT 'semantic'
          CHECK (default_memory_type IN ('episodic', 'semantic', 'procedural', 'context')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id, name)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS memory_namespaces_ws ON memory.namespaces (workspace_id)`;

    // Per-memory-type configs (override defaults per workspace)
    await sql`
      CREATE TABLE memory.memory_type_configs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL,
        memory_type TEXT NOT NULL
          CHECK (memory_type IN ('episodic', 'semantic', 'procedural', 'context')),
        default_ttl_seconds INT,
        auto_consolidate BOOLEAN NOT NULL DEFAULT false,
        consolidation_mode TEXT NOT NULL DEFAULT 'summary_only'
          CHECK (consolidation_mode IN ('summary_only', 'delete_source', 'archive')),
        max_memories INT,
        importance_floor REAL NOT NULL DEFAULT 0.1,
        decay_model TEXT NOT NULL DEFAULT 'exponential'
          CHECK (decay_model IN ('linear', 'exponential', 'logarithmic')),
        half_life_hours INT,
        allow_boost BOOLEAN NOT NULL DEFAULT true,
        search_weight REAL NOT NULL DEFAULT 1.0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id, memory_type)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS memory_type_configs_ws ON memory.memory_type_configs (workspace_id)`;
  });

  await run(sql, "011_archival_policies", async (sql) => {
    // Archival policies per workspace/namespace
    await sql`
      CREATE TABLE memory.archival_policies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL,
        namespace TEXT, -- null = all namespaces
        memory_type TEXT, -- null = all types
        archive_tier TEXT NOT NULL DEFAULT 'cold'
          CHECK (archive_tier IN ('cold', 'frozen', 'deleted')),
        trigger TEXT NOT NULL DEFAULT 'age'
          CHECK (trigger IN ('age', 'importance_threshold', 'access_threshold', 'namespace_quota', 'manual')),
        age_threshold_seconds INT,
        importance_floor REAL CHECK (importance_floor BETWEEN 0 AND 1),
        access_count_floor INT,
        namespace_quota INT,
        enabled BOOLEAN NOT NULL DEFAULT true,
        retain_forever BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS memory_archival_policies_ws ON memory.archival_policies (workspace_id)`;
    await sql`CREATE INDEX IF NOT EXISTS memory_archival_policies_enabled ON memory.archival_policies (enabled) WHERE enabled = true`;

    // Archival history — immutable log of archived/restored memories
    await sql`
      CREATE TABLE memory.archival_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        memory_id UUID NOT NULL,
        archive_tier TEXT NOT NULL CHECK (archive_tier IN ('cold', 'frozen', 'deleted')),
        archived_by TEXT NOT NULL, -- policy_id or 'manual'
        workspace_id UUID NOT NULL,
        content_preview TEXT,
        importance REAL,
        memory_type TEXT,
        archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS memory_archival_history_ws ON memory.archival_history (workspace_id, archived_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS memory_archival_history_mem ON memory.archival_history (memory_id)`;
  });

  await run(sql, "012_ttl_tiers_auto_classify_namespace_quota", m012);
  await run(sql, "013_namespace_quotas_access_policies", m013);
  await run(sql, "014_versioning_analytics_tuning", m014);
}

async function m012(sql: Sql): Promise<void> {
  // Soft-expire column: memories past expires_at enter "soft delete" state
  // A separate purge job then hard-deletes them. grace_period_seconds on namespace controls timing.
  await sql`ALTER TABLE memory.memories ADD COLUMN IF NOT EXISTS soft_expires_at TIMESTAMPTZ`;
  await sql`CREATE INDEX IF NOT EXISTS memory_memories_soft_expires ON memory.memories (soft_expires_at) WHERE soft_expires_at IS NOT NULL`;

  // Add grace_period_seconds to namespaces for tiered TTL enforcement
  await sql`ALTER TABLE memory.namespaces ADD COLUMN IF NOT EXISTS grace_period_seconds INT DEFAULT 0`;
  await sql`ALTER TABLE memory.namespaces ADD COLUMN IF NOT EXISTS max_memories INT`;
  await sql`CREATE INDEX IF NOT EXISTS memory_namespaces_max_memories ON memory.namespaces (max_memories) WHERE max_memories IS NOT NULL`;

  // Auto-classification: classify_memory function/classifier results stored here
  await sql`
    CREATE TABLE memory.memory_classifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      memory_id UUID NOT NULL REFERENCES memory.memories(id) ON DELETE CASCADE,
      classified_type TEXT NOT NULL CHECK (classified_type IN ('episodic', 'semantic', 'procedural', 'context')),
      confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
      classifier_version TEXT NOT NULL DEFAULT 'v1',
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS memory_classifications_mem ON memory.memory_classifications (memory_id)`;
  await sql`CREATE INDEX IF NOT EXISTS memory_classifications_type ON memory.memory_classifications (classified_type)`;

  // Per-workspace namespace memory budget summary
  await sql`
    CREATE TABLE memory.namespace_budgets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      namespace TEXT NOT NULL,
      max_memories INT NOT NULL DEFAULT 0,
      current_count INT NOT NULL DEFAULT 0,
      enforce_quota BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, namespace)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS memory_namespace_budgets_ws ON memory.namespace_budgets (workspace_id)`;

  // Memory type routing rules: auto-assign type based on namespace or content pattern
  await sql`
    CREATE TABLE memory.type_routing_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL,
      namespace TEXT NOT NULL DEFAULT '',
      pattern TEXT NOT NULL,
      match_field TEXT NOT NULL DEFAULT 'content' CHECK (match_field IN ('content', 'metadata', 'summary')),
      assigned_type TEXT NOT NULL CHECK (assigned_type IN ('episodic', 'semantic', 'procedural', 'context')),
      priority INT NOT NULL DEFAULT 0,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, namespace, pattern, match_field)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS memory_type_routing_ws ON memory.type_routing_rules (workspace_id)`;
  await sql`CREATE INDEX IF NOT EXISTS memory_type_routing_enabled ON memory.type_routing_rules (enabled) WHERE enabled = true`;
}

async function m013(sql: Sql): Promise<void> {
  // Hard quota enforcement for namespaces
  await sql`
    CREATE TABLE IF NOT EXISTS memory.namespace_quotas (
      namespace_id UUID PRIMARY KEY REFERENCES memory.namespaces(id) ON DELETE CASCADE,
      max_memories INT,
      max_collections INT,
      max_size_bytes BIGINT,
      enforce_hard_limit BOOLEAN NOT NULL DEFAULT false
    )
  `;

  // Allowed/blocked workspace access per namespace
  await sql`ALTER TABLE memory.namespaces ADD COLUMN IF NOT EXISTS allowed_workspace_ids UUID[]`;
  await sql`ALTER TABLE memory.namespaces ADD COLUMN IF NOT EXISTS blocked_workspace_ids UUID[]`;
  await sql`ALTER TABLE memory.namespaces ADD COLUMN IF NOT EXISTS public_read BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE memory.namespaces ADD COLUMN IF NOT EXISTS public_write BOOLEAN NOT NULL DEFAULT false`;

  // TTL sweeper run history for monitoring
  await sql`
    CREATE TABLE IF NOT EXISTS memory.ttl_sweeper_log (
      id SERIAL PRIMARY KEY,
      workspace_id UUID,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_count INT NOT NULL DEFAULT 0,
      error TEXT,
      duration_ms INT
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS memory_ttl_sweeper_log_run ON memory.ttl_sweeper_log (run_at DESC)`;
}

async function m014(sql: Sql): Promise<void> {
  // Memory versioning — track version history of content changes
  await sql`
    CREATE TABLE IF NOT EXISTS memory.memory_versions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      memory_id       UUID NOT NULL REFERENCES memory.memories(id) ON DELETE CASCADE,
      version_number  INT NOT NULL,
      content         TEXT NOT NULL,
      summary         TEXT,
      importance      REAL NOT NULL,
      memory_type     TEXT NOT NULL,
      changed_by      UUID,
      change_reason   TEXT,
      changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (memory_id, version_number)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS memory_versions_memory ON memory.memory_versions (memory_id)`;
  await sql`CREATE INDEX IF NOT EXISTS memory_versions_changed_at ON memory.memory_versions (changed_at DESC)`;
}

async function run(
  sql: Sql,
  name: string,
  fn: (sql: Sql) => Promise<void>,
): Promise<void> {
  const [existing] =
    await sql`SELECT id FROM memory._migrations WHERE name = ${name}`;
  if (existing) return;
  await sql.begin(async (tx: any) => {
    await fn(tx as any);
    await (tx as any)`INSERT INTO memory._migrations (name) VALUES (${name})`;
  });
}
