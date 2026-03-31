import type { Sql } from "postgres";

export interface Experiment {
  id: string; name: string; description: string | null; flag_id: string | null;
  variants: { name: string; weight: number }[]; traffic_pct: number;
  status: string; started_at: string | null; ended_at: string | null; created_at: string;
}

export async function createExperiment(sql: Sql, data: { name: string; description?: string; flagId?: string; variants?: { name: string; weight: number }[]; trafficPct?: number }): Promise<Experiment> {
  const variants = data.variants ?? [{ name: "control", weight: 50 }, { name: "treatment", weight: 50 }];
  const [e] = await sql<Experiment[]>`
    INSERT INTO flags.experiments (name, description, flag_id, variants, traffic_pct)
    VALUES (${data.name}, ${data.description ?? null}, ${data.flagId ?? null}, ${JSON.stringify(variants)}, ${data.trafficPct ?? 100})
    RETURNING *`;
  return e;
}

export async function getExperiment(sql: Sql, id: string): Promise<Experiment | null> {
  const [e] = await sql<Experiment[]>`SELECT * FROM flags.experiments WHERE id = ${id}`;
  return e ?? null;
}

export async function updateExperimentStatus(sql: Sql, id: string, status: string): Promise<void> {
  const started_at = status === "running" ? sql`NOW()` : sql`started_at`;
  const ended_at = status === "completed" ? sql`NOW()` : sql`ended_at`;
  await sql`UPDATE flags.experiments SET status = ${status}, started_at = ${started_at}, ended_at = ${ended_at} WHERE id = ${id}`;
}

/** Assign or retrieve a variant for a user (sticky assignment) */
export async function assignVariant(sql: Sql, experimentId: string, userId: string): Promise<string | null> {
  const exp = await getExperiment(sql, experimentId);
  if (!exp || exp.status !== "running") return null;

  // Check existing assignment
  const [existing] = await sql<[{ variant: string }]>`SELECT variant FROM flags.assignments WHERE experiment_id = ${experimentId} AND user_id = ${userId}`;
  if (existing) return existing.variant;

  // Check traffic inclusion (deterministic)
  const hash = userId.split("").reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0);
  const pct = Math.abs(hash) % 100;
  if (pct >= exp.traffic_pct) return null;

  // Assign variant by weight
  const variants = exp.variants;
  const totalWeight = variants.reduce((s, v) => s + v.weight, 0);
  const roll = pct % totalWeight;
  let cum = 0;
  let chosen = variants[0].name;
  for (const v of variants) { cum += v.weight; if (roll < cum) { chosen = v.name; break; } }

  await sql`INSERT INTO flags.assignments (experiment_id, user_id, variant) VALUES (${experimentId}, ${userId}, ${chosen}) ON CONFLICT DO NOTHING`;
  return chosen;
}

export async function listExperiments(sql: Sql): Promise<Experiment[]> {
  return sql<Experiment[]>`SELECT * FROM flags.experiments ORDER BY created_at DESC`;
}
