/**
 * Health CRUD operations for metrics, medications, appointments, and fitness logs
 */

import { getDatabase } from "./database.js";

// ============================================================
// Metrics
// ============================================================

export interface Metric {
  id: string;
  type: string;
  value: number;
  unit: string | null;
  notes: string | null;
  recorded_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface MetricRow {
  id: string;
  type: string;
  value: number;
  unit: string | null;
  notes: string | null;
  recorded_at: string;
  metadata: string;
  created_at: string;
}

function rowToMetric(row: MetricRow): Metric {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreateMetricInput {
  type: string;
  value: number;
  unit?: string;
  notes?: string;
  recorded_at?: string;
  metadata?: Record<string, unknown>;
}

export function createMetric(input: CreateMetricInput): Metric {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});
  const recorded_at = input.recorded_at || new Date().toISOString();

  db.prepare(
    `INSERT INTO metrics (id, type, value, unit, notes, recorded_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.type, input.value, input.unit || null, input.notes || null, recorded_at, metadata);

  return getMetric(id)!;
}

export function getMetric(id: string): Metric | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM metrics WHERE id = ?").get(id) as MetricRow | null;
  return row ? rowToMetric(row) : null;
}

export interface ListMetricsOptions {
  type?: string;
  limit?: number;
  offset?: number;
}

export function listMetrics(options: ListMetricsOptions = {}): Metric[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }

  let sql = "SELECT * FROM metrics";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY recorded_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as MetricRow[];
  return rows.map(rowToMetric);
}

export function deleteMetric(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM metrics WHERE id = ?").run(id);
  return result.changes > 0;
}

export interface MetricTrendPoint {
  date: string;
  value: number;
}

export function getMetricTrend(type: string, days: number): MetricTrendPoint[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT date(recorded_at) as date, AVG(value) as value
       FROM metrics
       WHERE type = ? AND recorded_at >= datetime('now', '-' || ? || ' days')
       GROUP BY date(recorded_at)
       ORDER BY date(recorded_at) ASC`
    )
    .all(type, days) as MetricTrendPoint[];
  return rows;
}

// ============================================================
// Medications
// ============================================================

export interface Medication {
  id: string;
  name: string;
  dosage: string | null;
  frequency: string | null;
  start_date: string | null;
  end_date: string | null;
  refill_date: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

interface MedicationRow {
  id: string;
  name: string;
  dosage: string | null;
  frequency: string | null;
  start_date: string | null;
  end_date: string | null;
  refill_date: string | null;
  notes: string | null;
  active: number;
  created_at: string;
}

function rowToMedication(row: MedicationRow): Medication {
  return {
    ...row,
    active: row.active === 1,
  };
}

export interface CreateMedicationInput {
  name: string;
  dosage?: string;
  frequency?: string;
  start_date?: string;
  end_date?: string;
  refill_date?: string;
  notes?: string;
  active?: boolean;
}

export function createMedication(input: CreateMedicationInput): Medication {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const active = input.active !== undefined ? (input.active ? 1 : 0) : 1;

  db.prepare(
    `INSERT INTO medications (id, name, dosage, frequency, start_date, end_date, refill_date, notes, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.dosage || null,
    input.frequency || null,
    input.start_date || null,
    input.end_date || null,
    input.refill_date || null,
    input.notes || null,
    active
  );

  return getMedication(id)!;
}

export function getMedication(id: string): Medication | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM medications WHERE id = ?").get(id) as MedicationRow | null;
  return row ? rowToMedication(row) : null;
}

export interface ListMedicationsOptions {
  active?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listMedications(options: ListMedicationsOptions = {}): Medication[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.active !== undefined) {
    conditions.push("active = ?");
    params.push(options.active ? 1 : 0);
  }

  if (options.search) {
    conditions.push("(name LIKE ? OR dosage LIKE ? OR notes LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q);
  }

  let sql = "SELECT * FROM medications";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY name ASC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as MedicationRow[];
  return rows.map(rowToMedication);
}

export interface UpdateMedicationInput {
  name?: string;
  dosage?: string;
  frequency?: string;
  start_date?: string;
  end_date?: string;
  refill_date?: string;
  notes?: string;
  active?: boolean;
}

export function updateMedication(id: string, input: UpdateMedicationInput): Medication | null {
  const db = getDatabase();
  const existing = getMedication(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.dosage !== undefined) {
    sets.push("dosage = ?");
    params.push(input.dosage);
  }
  if (input.frequency !== undefined) {
    sets.push("frequency = ?");
    params.push(input.frequency);
  }
  if (input.start_date !== undefined) {
    sets.push("start_date = ?");
    params.push(input.start_date);
  }
  if (input.end_date !== undefined) {
    sets.push("end_date = ?");
    params.push(input.end_date);
  }
  if (input.refill_date !== undefined) {
    sets.push("refill_date = ?");
    params.push(input.refill_date);
  }
  if (input.notes !== undefined) {
    sets.push("notes = ?");
    params.push(input.notes);
  }
  if (input.active !== undefined) {
    sets.push("active = ?");
    params.push(input.active ? 1 : 0);
  }

  if (sets.length === 0) return existing;

  params.push(id);
  db.prepare(`UPDATE medications SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getMedication(id);
}

export function deactivateMedication(id: string): Medication | null {
  return updateMedication(id, { active: false });
}

export function deleteMedication(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM medications WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getMedicationSchedule(): Medication[] {
  return listMedications({ active: true });
}

// ============================================================
// Appointments
// ============================================================

export interface Appointment {
  id: string;
  provider: string;
  specialty: string | null;
  location: string | null;
  scheduled_at: string;
  status: "scheduled" | "completed" | "cancelled" | "rescheduled";
  notes: string | null;
  follow_up_date: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface AppointmentRow {
  id: string;
  provider: string;
  specialty: string | null;
  location: string | null;
  scheduled_at: string;
  status: string;
  notes: string | null;
  follow_up_date: string | null;
  metadata: string;
  created_at: string;
}

function rowToAppointment(row: AppointmentRow): Appointment {
  return {
    ...row,
    status: row.status as Appointment["status"],
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreateAppointmentInput {
  provider: string;
  specialty?: string;
  location?: string;
  scheduled_at: string;
  status?: Appointment["status"];
  notes?: string;
  follow_up_date?: string;
  metadata?: Record<string, unknown>;
}

export function createAppointment(input: CreateAppointmentInput): Appointment {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});
  const status = input.status || "scheduled";

  db.prepare(
    `INSERT INTO appointments (id, provider, specialty, location, scheduled_at, status, notes, follow_up_date, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.provider,
    input.specialty || null,
    input.location || null,
    input.scheduled_at,
    status,
    input.notes || null,
    input.follow_up_date || null,
    metadata
  );

  return getAppointment(id)!;
}

export function getAppointment(id: string): Appointment | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id) as AppointmentRow | null;
  return row ? rowToAppointment(row) : null;
}

export interface ListAppointmentsOptions {
  status?: string;
  provider?: string;
  limit?: number;
  offset?: number;
}

export function listAppointments(options: ListAppointmentsOptions = {}): Appointment[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options.provider) {
    conditions.push("provider LIKE ?");
    params.push(`%${options.provider}%`);
  }

  let sql = "SELECT * FROM appointments";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY scheduled_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as AppointmentRow[];
  return rows.map(rowToAppointment);
}

export interface UpdateAppointmentInput {
  provider?: string;
  specialty?: string;
  location?: string;
  scheduled_at?: string;
  status?: Appointment["status"];
  notes?: string;
  follow_up_date?: string;
  metadata?: Record<string, unknown>;
}

export function updateAppointment(id: string, input: UpdateAppointmentInput): Appointment | null {
  const db = getDatabase();
  const existing = getAppointment(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.provider !== undefined) {
    sets.push("provider = ?");
    params.push(input.provider);
  }
  if (input.specialty !== undefined) {
    sets.push("specialty = ?");
    params.push(input.specialty);
  }
  if (input.location !== undefined) {
    sets.push("location = ?");
    params.push(input.location);
  }
  if (input.scheduled_at !== undefined) {
    sets.push("scheduled_at = ?");
    params.push(input.scheduled_at);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.notes !== undefined) {
    sets.push("notes = ?");
    params.push(input.notes);
  }
  if (input.follow_up_date !== undefined) {
    sets.push("follow_up_date = ?");
    params.push(input.follow_up_date);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  params.push(id);
  db.prepare(`UPDATE appointments SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getAppointment(id);
}

export function completeAppointment(id: string): Appointment | null {
  return updateAppointment(id, { status: "completed" });
}

export function cancelAppointment(id: string): Appointment | null {
  return updateAppointment(id, { status: "cancelled" });
}

export function deleteAppointment(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM appointments WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getUpcomingAppointments(days: number): Appointment[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM appointments
       WHERE status = 'scheduled'
         AND scheduled_at >= datetime('now')
         AND scheduled_at <= datetime('now', '+' || ? || ' days')
       ORDER BY scheduled_at ASC`
    )
    .all(days) as AppointmentRow[];
  return rows.map(rowToAppointment);
}

// ============================================================
// Fitness Logs
// ============================================================

export interface FitnessLog {
  id: string;
  activity: string;
  duration_min: number | null;
  calories_burned: number | null;
  distance: number | null;
  notes: string | null;
  logged_at: string;
  created_at: string;
}

export interface CreateFitnessLogInput {
  activity: string;
  duration_min?: number;
  calories_burned?: number;
  distance?: number;
  notes?: string;
  logged_at?: string;
}

export function createFitnessLog(input: CreateFitnessLogInput): FitnessLog {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const logged_at = input.logged_at || new Date().toISOString();

  db.prepare(
    `INSERT INTO fitness_logs (id, activity, duration_min, calories_burned, distance, notes, logged_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.activity,
    input.duration_min ?? null,
    input.calories_burned ?? null,
    input.distance ?? null,
    input.notes || null,
    logged_at
  );

  return getFitnessLog(id)!;
}

export function getFitnessLog(id: string): FitnessLog | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM fitness_logs WHERE id = ?").get(id) as FitnessLog | null;
  return row;
}

export interface ListFitnessLogsOptions {
  activity?: string;
  limit?: number;
  offset?: number;
}

export function listFitnessLogs(options: ListFitnessLogsOptions = {}): FitnessLog[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.activity) {
    conditions.push("activity LIKE ?");
    params.push(`%${options.activity}%`);
  }

  let sql = "SELECT * FROM fitness_logs";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY logged_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as FitnessLog[];
  return rows;
}

export function deleteFitnessLog(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM fitness_logs WHERE id = ?").run(id);
  return result.changes > 0;
}

export interface FitnessStats {
  total_sessions: number;
  total_minutes: number;
  total_calories: number;
  avg_duration: number;
}

export function getFitnessStats(days: number): FitnessStats {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT
         COUNT(*) as total_sessions,
         COALESCE(SUM(duration_min), 0) as total_minutes,
         COALESCE(SUM(calories_burned), 0) as total_calories,
         COALESCE(AVG(duration_min), 0) as avg_duration
       FROM fitness_logs
       WHERE logged_at >= datetime('now', '-' || ? || ' days')`
    )
    .get(days) as FitnessStats;
  return {
    total_sessions: row.total_sessions,
    total_minutes: row.total_minutes,
    total_calories: row.total_calories,
    avg_duration: Math.round(row.avg_duration * 100) / 100,
  };
}

// ============================================================
// Health Summary
// ============================================================

export interface HealthSummary {
  metrics: { total: number; types: string[] };
  medications: { total: number; active: number };
  appointments: { total: number; upcoming: number; completed: number };
  fitness: { total_sessions: number; recent_stats: FitnessStats };
}

export function getHealthSummary(): HealthSummary {
  const db = getDatabase();

  // Metrics summary
  const metricTotal = (
    db.prepare("SELECT COUNT(*) as count FROM metrics").get() as { count: number }
  ).count;
  const metricTypes = (
    db.prepare("SELECT DISTINCT type FROM metrics ORDER BY type").all() as { type: string }[]
  ).map((r) => r.type);

  // Medications summary
  const medTotal = (
    db.prepare("SELECT COUNT(*) as count FROM medications").get() as { count: number }
  ).count;
  const medActive = (
    db.prepare("SELECT COUNT(*) as count FROM medications WHERE active = 1").get() as {
      count: number;
    }
  ).count;

  // Appointments summary
  const apptTotal = (
    db.prepare("SELECT COUNT(*) as count FROM appointments").get() as { count: number }
  ).count;
  const apptUpcoming = (
    db.prepare(
      "SELECT COUNT(*) as count FROM appointments WHERE status = 'scheduled' AND scheduled_at >= datetime('now')"
    ).get() as { count: number }
  ).count;
  const apptCompleted = (
    db.prepare(
      "SELECT COUNT(*) as count FROM appointments WHERE status = 'completed'"
    ).get() as { count: number }
  ).count;

  // Fitness summary
  const fitnessTotal = (
    db.prepare("SELECT COUNT(*) as count FROM fitness_logs").get() as { count: number }
  ).count;
  const recentStats = getFitnessStats(30);

  return {
    metrics: { total: metricTotal, types: metricTypes },
    medications: { total: medTotal, active: medActive },
    appointments: { total: apptTotal, upcoming: apptUpcoming, completed: apptCompleted },
    fitness: { total_sessions: fitnessTotal, recent_stats: recentStats },
  };
}
