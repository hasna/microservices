import type { Sql } from "postgres";

export interface Experiment {
  id: string;
  prompt_id: string;
  name: string;
  status: "draft" | "running" | "completed";
  variants: { name: string; version_id: string; weight: number }[];
  traffic_pct: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface Assignment {
  id: string;
  experiment_id: string;
  user_id: string;
  variant_name: string;
  assigned_at: string;
}

function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export async function createExperiment(
  sql: Sql,
  opts: { promptId: string; name: string; variants: { name: string; version_id: string; weight: number }[]; trafficPct?: number }
): Promise<Experiment> {
  const [row] = await sql`
    INSERT INTO prompts.experiments (prompt_id, name, variants, traffic_pct)
    VALUES (${opts.promptId}, ${opts.name}, ${JSON.stringify(opts.variants)}, ${opts.trafficPct ?? 100})
    RETURNING *`;
  return row as unknown as Experiment;
}

export async function startExperiment(sql: Sql, id: string): Promise<void> {
  await sql`UPDATE prompts.experiments SET status = 'running', started_at = NOW() WHERE id = ${id}`;
}

export async function stopExperiment(sql: Sql, id: string): Promise<void> {
  await sql`UPDATE prompts.experiments SET status = 'completed', ended_at = NOW() WHERE id = ${id}`;
}

export async function getAssignment(sql: Sql, experimentId: string, userId: string): Promise<string> {
  // Check for existing sticky assignment
  const [existing] = await sql`
    SELECT variant_name FROM prompts.assignments WHERE experiment_id = ${experimentId} AND user_id = ${userId}`;
  if (existing) return existing.variant_name as string;

  // Load experiment to pick variant using deterministic hash
  const [exp] = await sql`SELECT variants FROM prompts.experiments WHERE id = ${experimentId}`;
  if (!exp) throw new Error(`Experiment ${experimentId} not found`);
  const variants = exp.variants as { name: string; version_id: string; weight: number }[];
  if (variants.length === 0) throw new Error("No variants configured");

  const variantName = pickVariant(variants, userId, experimentId);

  // Persist sticky assignment
  await sql`
    INSERT INTO prompts.assignments (experiment_id, user_id, variant_name)
    VALUES (${experimentId}, ${userId}, ${variantName})
    ON CONFLICT (experiment_id, user_id) DO NOTHING`;

  return variantName;
}

/** Deterministic variant selection using weighted hash */
export function pickVariant(
  variants: { name: string; weight: number }[],
  userId: string,
  experimentId: string
): string {
  const totalWeight = variants.reduce((s, v) => s + v.weight, 0);
  if (totalWeight === 0) return variants[0].name;
  const hash = simpleHash(`${experimentId}:${userId}`);
  let bucket = hash % totalWeight;
  for (const v of variants) {
    if (bucket < v.weight) return v.name;
    bucket -= v.weight;
  }
  return variants[variants.length - 1].name;
}

export async function listExperiments(sql: Sql, promptId?: string): Promise<Experiment[]> {
  if (promptId) {
    return (await sql`SELECT * FROM prompts.experiments WHERE prompt_id = ${promptId} ORDER BY created_at DESC`) as unknown as Experiment[];
  }
  return (await sql`SELECT * FROM prompts.experiments ORDER BY created_at DESC`) as unknown as Experiment[];
}
