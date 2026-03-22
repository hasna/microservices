export interface MigrationEntry {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: MigrationEntry[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL CHECK(channel IN ('email','slack','sms','webhook','in_app')),
        recipient TEXT NOT NULL,
        subject TEXT,
        body TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','read')),
        source_service TEXT,
        source_event TEXT,
        priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        sent_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
      CREATE INDEX IF NOT EXISTS idx_notifications_channel ON notifications(channel);
      CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient);
      CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

      CREATE TABLE IF NOT EXISTS notification_rules (
        id TEXT PRIMARY KEY,
        name TEXT,
        trigger_event TEXT NOT NULL,
        channel TEXT NOT NULL,
        recipient TEXT NOT NULL,
        template_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_rules_trigger ON notification_rules(trigger_event);
      CREATE INDEX IF NOT EXISTS idx_rules_enabled ON notification_rules(enabled);

      CREATE TABLE IF NOT EXISTS notification_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        channel TEXT,
        subject_template TEXT,
        body_template TEXT,
        variables TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_templates_name ON notification_templates(name);
      CREATE INDEX IF NOT EXISTS idx_templates_channel ON notification_templates(channel);
    `,
  },
];
