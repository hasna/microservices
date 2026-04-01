import type { Sql } from "postgres";
import { enqueue } from "./queue.js";

export interface Schedule {
  id: string;
  name: string;
  cron: string;
  queue: string;
  type: string;
  payload: any;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export async function createSchedule(
  sql: Sql,
  data: {
    name: string;
    cron: string;
    type: string;
    payload?: any;
    queue?: string;
  },
): Promise<Schedule> {
  const [s] = await sql<Schedule[]>`
    INSERT INTO jobs.schedules (name, cron, type, payload, queue)
    VALUES (${data.name}, ${data.cron}, ${data.type}, ${JSON.stringify(data.payload ?? {})}, ${data.queue ?? "default"})
    RETURNING *`;
  return s;
}

export async function listSchedules(sql: Sql): Promise<Schedule[]> {
  return sql<Schedule[]>`SELECT * FROM jobs.schedules ORDER BY name`;
}

export async function updateSchedule(
  sql: Sql,
  id: string,
  data: { enabled?: boolean; payload?: any },
): Promise<void> {
  await sql`UPDATE jobs.schedules SET enabled = COALESCE(${data.enabled ?? null}, enabled), payload = COALESCE(${data.payload ? JSON.stringify(data.payload) : null}::jsonb, payload), updated_at = NOW() WHERE id = ${id}`;
}

export async function deleteSchedule(sql: Sql, id: string): Promise<boolean> {
  const r = await sql`DELETE FROM jobs.schedules WHERE id = ${id}`;
  return r.count > 0;
}

/** Parse simple cron and check if it should fire. Supports wildcard (*), step (every N), and specific values. */
export function shouldFire(cron: string, now: Date = new Date()): boolean {
  const [min, hour, dom, month, dow] = cron.split(" ");
  const checks = [
    matchCronField(min, now.getMinutes()),
    matchCronField(hour, now.getHours()),
    matchCronField(dom, now.getDate()),
    matchCronField(month, now.getMonth() + 1),
    matchCronField(dow, now.getDay()),
  ];
  return checks.every(Boolean);
}

function matchCronField(field: string, value: number): boolean {
  if (field === "*") return true;
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return value % step === 0;
  }
  return parseInt(field, 10) === value;
}

/** Trigger due schedules (call from a cron job every minute) */
export async function triggerDueSchedules(sql: Sql): Promise<number> {
  const schedules = await sql<
    Schedule[]
  >`SELECT * FROM jobs.schedules WHERE enabled = true`;
  const now = new Date();
  let triggered = 0;
  for (const s of schedules) {
    if (shouldFire(s.cron, now)) {
      await enqueue(sql, { type: s.type, payload: s.payload, queue: s.queue });
      await sql`UPDATE jobs.schedules SET last_run_at = NOW(), updated_at = NOW() WHERE id = ${s.id}`;
      triggered++;
    }
  }
  return triggered;
}
