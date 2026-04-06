/**
 * Notification A/B testing — run controlled experiments on notification templates and timing.
 */

import type { Sql } from "postgres";

export interface ABTest {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  variants: ABTestVariant[];
  target_users: string[];       // user IDs in experiment
  control_user_count: number;
  variant_user_count: number;
  start_at: string;
  end_at: string | null;
  status: "draft" | "running" | "paused" | "completed" | "cancelled";
  winning_variant: string | null;  // variant_id
  created_at: string;
}

export interface ABTestVariant {
  id: string;
  test_id: string;
  name: string;             // e.g. "Control", "Variant A"
  template_id: string | null;
  subject_template: string | null;
  body_template: string | null;
  channel: string;
  send_delay_seconds: number | null;  // delay after trigger
  weight: number;           // 0-100, proportion of users in this variant
  conversions: number;
  sends: number;
}

export interface ABTestResult {
  test_id: string;
  variant_id: string;
  variant_name: string;
  sends: number;
  opens: number;
  clicks: number;
  conversion_rate: number;
  confidence: number | null;
  winner: boolean;
}

/**
 * Create a new A/B test with multiple variants.
 */
export async function createABTest(
  sql: Sql,
  data: {
    workspaceId: string;
    name: string;
    description?: string;
    variants: Array<{
      name: string;
      templateId?: string;
      subjectTemplate?: string;
      bodyTemplate?: string;
      channel: string;
      sendDelaySeconds?: number;
      weight: number;
    }>;
    targetUserIds: string[];
    startAt?: string;
    endAt?: string;
  },
): Promise<ABTest> {
  const [row] = await sql<any[]>`
    INSERT INTO notify.ab_tests
      (workspace_id, name, description, target_users, control_user_count, variant_user_count,
       start_at, end_at, status)
    VALUES (
      ${data.workspaceId},
      ${data.name},
      ${data.description ?? null},
      ${data.targetUserIds},
      ${data.variants.length > 0 ? Math.floor(data.targetUserIds.length / data.variants.length) : 0},
      ${Math.floor(data.targetUserIds.length / data.variants.length)},
      ${data.startAt ?? new Date().toISOString()},
      ${data.endAt ?? null}
    )
    RETURNING *
  `;

  const testId = row.id;

  // Insert variants
  for (const v of data.variants) {
    await sql`
      INSERT INTO notify.ab_test_variants
        (test_id, name, template_id, subject_template, body_template, channel,
         send_delay_seconds, weight)
      VALUES (
        ${testId}, ${v.name}, ${v.templateId ?? null}, ${v.subjectTemplate ?? null},
        ${v.bodyTemplate ?? null}, ${v.channel}, ${v.sendDelaySeconds ?? null}, ${v.weight}
      )
    `;
  }

  return { ...row, variants: data.variants.map((v) => ({ ...v, id: "", test_id: testId, conversions: 0, sends: 0 })) } as any;
}

/**
 * Get an A/B test with its variants.
 */
export async function getABTest(sql: Sql, testId: string): Promise<ABTest | null> {
  const [row] = await sql<any[]>`SELECT * FROM notify.ab_tests WHERE id = ${testId}`;
  if (!row) return null;
  const [variants] = await sql<any[]>`SELECT * FROM notify.ab_test_variants WHERE test_id = ${testId}`;
  return { ...row, variants };
}

/**
 * Record a conversion event for an A/B test variant (open, click, etc.).
 */
export async function recordABConversion(
  sql: Sql,
  variantId: string,
  eventType: "send" | "open" | "click",
): Promise<void> {
  const col = eventType === "send" ? "sends" : eventType === "open" ? "opens" : "clicks";
  await sql`UPDATE notify.ab_test_variants SET ${sql.unsafe(`${col} = ${col} + 1`)} WHERE id = ${variantId}`;
}

/**
 * Get results for all variants in a test, with basic statistics.
 */
export async function getABTestResults(
  sql: Sql,
  testId: string,
): Promise<ABTestResult[]> {
  const [variants] = await sql<any[]>`
    SELECT * FROM notify.ab_test_variants WHERE test_id = ${testId}
  `;

  return variants.map((v) => {
    const convRate = v.sends > 0 ? (v.clicks / v.sends) * 100 : 0;
    return {
      test_id: testId,
      variant_id: v.id,
      variant_name: v.name,
      sends: v.sends,
      opens: v.opens ?? 0,
      clicks: v.clicks ?? 0,
      conversion_rate: Math.round(convRate * 100) / 100,
      confidence: null,
      winner: false,
    };
  });
}

/**
 * Mark a test as completed and pick a winner.
 */
export async function completeABTest(
  sql: Sql,
  testId: string,
): Promise<ABTest | null> {
  const results = await getABTestResults(sql, testId);
  if (results.length === 0) return null;

  const winner = results.reduce((best, r) =>
    r.conversion_rate > (best?.conversion_rate ?? 0) ? r : best,
  );

  const [row] = await sql<any[]>`
    UPDATE notify.ab_tests
    SET status = 'completed', winning_variant = ${winner?.variant_id ?? null}
    WHERE id = ${testId} AND status = 'running'
    RETURNING *
  `;

  return row ? getABTest(sql, testId) : null;
}

/**
 * List A/B tests for a workspace.
 */
export async function listABTests(
  sql: Sql,
  workspaceId: string,
  opts?: { status?: string; limit?: number },
): Promise<ABTest[]> {
  const [rows] = await sql<any[]>`
    SELECT * FROM notify.ab_tests
    WHERE workspace_id = ${workspaceId}
      AND (${opts?.status ? sql`status = ${opts.status}` : sql`true`})
    ORDER BY created_at DESC
    LIMIT ${opts?.limit ?? 50}
  `;
  return rows;
}
