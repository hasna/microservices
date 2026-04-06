/**
 * Rule versioning — maintains a version history for each guard rule
 * so changes can be audited and rolled back to any previous version.
 *
 * rule_versions table: immutable append-only log of every change to a rule.
 * getRuleVersion() — retrieve any specific version by number.
 * listRuleVersions() — list all versions of a rule.
 * rollbackRule() — revert a rule to a previous version by creating a new version entry.
 */

import type { Sql } from "postgres";

export interface RuleVersion {
  id: string;
  rule_id: string;
  version_number: number;
  name: string;
  pattern: string;
  severity: "low" | "medium" | "high" | "critical";
  action: "block" | "redact" | "warn" | "log";
  priority: number;
  enabled: boolean;
  changed_by: string | null;
  change_reason: string | null;
  created_at: Date;
}

export interface CreateVersionInput {
  rule_id: string;
  name: string;
  pattern: string;
  severity: "low" | "medium" | "high" | "critical";
  action: "block" | "redact" | "warn" | "log";
  priority: number;
  enabled: boolean;
  changed_by?: string | null;
  change_reason?: string | null;
}

/**
 * Record a new version of a rule. Called whenever a rule is created or updated.
 * Returns the new RuleVersion row.
 */
export async function createRuleVersion(
  sql: Sql,
  input: CreateVersionInput,
): Promise<RuleVersion> {
  // Get the next version number for this rule
  const [last] = await sql<RuleVersion[]>`
    SELECT version_number FROM guardrails.rule_versions
    WHERE rule_id = ${input.rule_id}
    ORDER BY version_number DESC
    LIMIT 1
  `;
  const nextVersion = last ? last.version_number + 1 : 1;

  const [row] = await sql<RuleVersion[]>`
    INSERT INTO guardrails.rule_versions (
      rule_id, version_number, name, pattern, severity,
      action, priority, enabled, changed_by, change_reason
    )
    VALUES (
      ${input.rule_id},
      ${nextVersion},
      ${input.name},
      ${input.pattern},
      ${input.severity},
      ${input.action},
      ${input.priority},
      ${input.enabled},
      ${input.changed_by ?? null},
      ${input.change_reason ?? null}
    )
    RETURNING *
  `;
  return row;
}

/**
 * Get a specific version of a rule by rule_id and version_number.
 */
export async function getRuleVersion(
  sql: Sql,
  ruleId: string,
  versionNumber: number,
): Promise<RuleVersion | null> {
  const [row] = await sql<RuleVersion[]>`
    SELECT * FROM guardrails.rule_versions
    WHERE rule_id = ${ruleId} AND version_number = ${versionNumber}
  `;
  return row ?? null;
}

/**
 * List all versions of a rule, newest first.
 */
export async function listRuleVersions(
  sql: Sql,
  ruleId: string,
): Promise<RuleVersion[]> {
  return sql<RuleVersion[]>`
    SELECT * FROM guardrails.rule_versions
    WHERE rule_id = ${ruleId}
    ORDER BY version_number DESC
  `;
}

/**
 * Get the latest version of a rule (convenience wrapper).
 */
export async function getLatestRuleVersion(
  sql: Sql,
  ruleId: string,
): Promise<RuleVersion | null> {
  const [row] = await sql<RuleVersion[]>`
    SELECT * FROM guardrails.rule_versions
    WHERE rule_id = ${ruleId}
    ORDER BY version_number DESC
    LIMIT 1
  `;
  return row ?? null;
}

/**
 * Rollback a rule to a specific version. Creates a new version entry
 * with the content of the target version, preserving audit trail.
 * Returns the newly created RuleVersion (now at HEAD).
 */
export async function rollbackRule(
  sql: Sql,
  ruleId: string,
  targetVersion: number,
  changedBy?: string,
  reason?: string,
): Promise<RuleVersion | null> {
  // Fetch the target version
  const target = await getRuleVersion(sql, ruleId, targetVersion);
  if (!target) return null;

  // Update the live rule row first
  await sql`
    UPDATE guardrails.guard_rules SET
      name     = ${target.name},
      pattern  = ${target.pattern},
      severity = ${target.severity},
      action   = ${target.action},
      priority = ${target.priority},
      enabled  = ${target.enabled}
    WHERE id = ${ruleId}
  `;

  // Create a new version entry recording the rollback
  return createRuleVersion(sql, {
    rule_id: ruleId,
    name: target.name,
    pattern: target.pattern,
    severity: target.severity,
    action: target.action,
    priority: target.priority,
    enabled: target.enabled,
    changed_by: changedBy ?? `rollback to v${targetVersion}`,
    change_reason: reason ?? "Rollback to previous version",
  });
}

/**
 * Get version diff between two versions of the same rule.
 * Returns a human-readable description of what changed.
 */
export async function getRuleVersionDiff(
  sql: Sql,
  ruleId: string,
  fromVersion: number,
  toVersion: number,
): Promise<{
  from: RuleVersion;
  to: RuleVersion;
  changes: string[];
} | null> {
  const [from, to] = await Promise.all([
    getRuleVersion(sql, ruleId, fromVersion),
    getRuleVersion(sql, ruleId, toVersion),
  ]);
  if (!from || !to) return null;

  const changes: string[] = [];
  if (from.name !== to.name) changes.push(`name: "${from.name}" → "${to.name}"`);
  if (from.pattern !== to.pattern) changes.push(`pattern: "${from.pattern}" → "${to.pattern}"`);
  if (from.severity !== to.severity) changes.push(`severity: ${from.severity} → ${to.severity}`);
  if (from.action !== to.action) changes.push(`action: ${from.action} → ${to.action}`);
  if (from.priority !== to.priority) changes.push(`priority: ${from.priority} → ${to.priority}`);
  if (from.enabled !== to.enabled) changes.push(`enabled: ${from.enabled} → ${to.enabled}`);

  return { from, to, changes };
}

/**
 * Prune old rule versions, keeping the most recent N versions per rule.
 * Useful for storage management without losing recent history.
 * Returns the number of versions pruned.
 */
export async function pruneRuleVersions(
  sql: Sql,
  opts: {
    ruleId?: string;
    keepLatest?: number;
    olderThanDays?: number;
  },
): Promise<number> {
  let deleted = 0;

  if (opts.ruleId) {
    // Prune specific rule
    const toKeep = opts.keepLatest ?? 10;
    const [oldOnes] = await sql<[{ id: string }]>`
      DELETE FROM guardrails.rule_versions
      WHERE rule_id = ${opts.ruleId}
        AND id NOT IN (
          SELECT id FROM guardrails.rule_versions
          WHERE rule_id = ${opts.ruleId}
          ORDER BY version_number DESC
          LIMIT ${toKeep}
        )
      RETURNING id
    `;
    deleted = oldOnes.length;
  } else if (opts.olderThanDays !== undefined) {
    // Prune by age across all rules
    const cutoff = new Date(Date.now() - opts.olderThanDays * 86400 * 1000);
    const result = await sql`
      DELETE FROM guardrails.rule_versions
      WHERE created_at < ${cutoff}
        AND id NOT IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY rule_id ORDER BY version_number DESC) as rn
            FROM guardrails.rule_versions
          ) sub
          WHERE rn <= 10
        )
    `;
    deleted = result.count;
  }

  return deleted;
}

/**
 * Compare two rule versions side-by-side — structured diff for review.
 */
export async function compareRuleVersions(
  sql: Sql,
  ruleId: string,
  versionA: number,
  versionB: number,
): Promise<{
  version_a: RuleVersion;
  version_b: RuleVersion;
  diff: {
    field: string;
    a: unknown;
    b: unknown;
    changed: boolean;
  }[];
  total_changes: number;
}> {
  const [a, b] = await Promise.all([
    getRuleVersion(sql, ruleId, versionA),
    getRuleVersion(sql, ruleId, versionB),
  ]);
  if (!a || !b) throw new Error("One or both versions not found");

  const fields: (keyof RuleVersion)[] = ["name", "pattern", "severity", "action", "priority", "enabled", "changed_by", "change_reason"];
  const diff = fields.map(field => ({
    field,
    a: a[field],
    b: b[field],
    changed: a[field] !== b[field],
  }));

  return {
    version_a: a,
    version_b: b,
    diff,
    total_changes: diff.filter(d => d.changed).length,
  };
}
