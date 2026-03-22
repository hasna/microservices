import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-health-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createMetric,
  getMetric,
  listMetrics,
  deleteMetric,
  getMetricTrend,
  createMedication,
  getMedication,
  listMedications,
  updateMedication,
  deactivateMedication,
  deleteMedication,
  getMedicationSchedule,
  createAppointment,
  getAppointment,
  listAppointments,
  updateAppointment,
  completeAppointment,
  cancelAppointment,
  deleteAppointment,
  getUpcomingAppointments,
  createFitnessLog,
  getFitnessLog,
  listFitnessLogs,
  deleteFitnessLog,
  getFitnessStats,
  getHealthSummary,
} from "./health";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================
// Metrics
// ============================================================

describe("Metrics", () => {
  test("create and get metric", () => {
    const metric = createMetric({
      type: "weight",
      value: 75.5,
      unit: "kg",
      notes: "Morning weight",
    });

    expect(metric.id).toBeTruthy();
    expect(metric.type).toBe("weight");
    expect(metric.value).toBe(75.5);
    expect(metric.unit).toBe("kg");
    expect(metric.notes).toBe("Morning weight");
    expect(metric.recorded_at).toBeTruthy();
    expect(metric.metadata).toEqual({});

    const fetched = getMetric(metric.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(metric.id);
  });

  test("create metric with custom recorded_at", () => {
    const metric = createMetric({
      type: "heart_rate",
      value: 72,
      unit: "bpm",
      recorded_at: "2025-01-15T08:00:00Z",
    });

    expect(metric.recorded_at).toBe("2025-01-15T08:00:00Z");
  });

  test("create metric with metadata", () => {
    const metric = createMetric({
      type: "blood_pressure",
      value: 120,
      unit: "mmHg",
      metadata: { systolic: 120, diastolic: 80 },
    });

    expect(metric.metadata).toEqual({ systolic: 120, diastolic: 80 });
  });

  test("list metrics", () => {
    const all = listMetrics();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("list metrics filtered by type", () => {
    const weights = listMetrics({ type: "weight" });
    expect(weights.length).toBeGreaterThanOrEqual(1);
    expect(weights.every((m) => m.type === "weight")).toBe(true);
  });

  test("list metrics with limit", () => {
    const limited = listMetrics({ limit: 1 });
    expect(limited.length).toBe(1);
  });

  test("delete metric", () => {
    const metric = createMetric({ type: "temp", value: 36.6 });
    expect(deleteMetric(metric.id)).toBe(true);
    expect(getMetric(metric.id)).toBeNull();
  });

  test("delete nonexistent metric returns false", () => {
    expect(deleteMetric("nonexistent-id")).toBe(false);
  });

  test("get metric trend", () => {
    // Create some metrics for trend
    createMetric({ type: "steps", value: 8000, recorded_at: new Date().toISOString() });
    createMetric({ type: "steps", value: 10000, recorded_at: new Date().toISOString() });

    const trend = getMetricTrend("steps", 7);
    expect(trend.length).toBeGreaterThanOrEqual(1);
    expect(trend[0]).toHaveProperty("date");
    expect(trend[0]).toHaveProperty("value");
  });

  test("get nonexistent metric returns null", () => {
    expect(getMetric("nonexistent-id")).toBeNull();
  });
});

// ============================================================
// Medications
// ============================================================

describe("Medications", () => {
  test("create and get medication", () => {
    const med = createMedication({
      name: "Ibuprofen",
      dosage: "200mg",
      frequency: "twice daily",
      start_date: "2025-01-01",
      notes: "For headaches",
    });

    expect(med.id).toBeTruthy();
    expect(med.name).toBe("Ibuprofen");
    expect(med.dosage).toBe("200mg");
    expect(med.frequency).toBe("twice daily");
    expect(med.active).toBe(true);

    const fetched = getMedication(med.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Ibuprofen");
  });

  test("list medications", () => {
    const meds = listMedications();
    expect(meds.length).toBeGreaterThanOrEqual(1);
  });

  test("list active medications only", () => {
    createMedication({ name: "InactiveMed", active: false });
    const active = listMedications({ active: true });
    expect(active.every((m) => m.active === true)).toBe(true);
  });

  test("search medications", () => {
    const results = listMedications({ search: "Ibuprofen" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe("Ibuprofen");
  });

  test("update medication", () => {
    const med = createMedication({ name: "UpdateMe" });
    const updated = updateMedication(med.id, {
      dosage: "500mg",
      frequency: "once daily",
    });

    expect(updated).toBeDefined();
    expect(updated!.dosage).toBe("500mg");
    expect(updated!.frequency).toBe("once daily");
  });

  test("update nonexistent medication returns null", () => {
    expect(updateMedication("nonexistent-id", { name: "X" })).toBeNull();
  });

  test("deactivate medication", () => {
    const med = createMedication({ name: "DeactivateMe" });
    const deactivated = deactivateMedication(med.id);
    expect(deactivated).toBeDefined();
    expect(deactivated!.active).toBe(false);
  });

  test("delete medication", () => {
    const med = createMedication({ name: "DeleteMe" });
    expect(deleteMedication(med.id)).toBe(true);
    expect(getMedication(med.id)).toBeNull();
  });

  test("get medication schedule (active meds)", () => {
    const schedule = getMedicationSchedule();
    expect(schedule.every((m) => m.active === true)).toBe(true);
  });

  test("get nonexistent medication returns null", () => {
    expect(getMedication("nonexistent-id")).toBeNull();
  });
});

// ============================================================
// Appointments
// ============================================================

describe("Appointments", () => {
  test("create and get appointment", () => {
    const appt = createAppointment({
      provider: "Dr. Smith",
      specialty: "Cardiology",
      location: "City Hospital",
      scheduled_at: "2025-06-15T10:00:00Z",
      notes: "Annual checkup",
    });

    expect(appt.id).toBeTruthy();
    expect(appt.provider).toBe("Dr. Smith");
    expect(appt.specialty).toBe("Cardiology");
    expect(appt.location).toBe("City Hospital");
    expect(appt.status).toBe("scheduled");
    expect(appt.metadata).toEqual({});

    const fetched = getAppointment(appt.id);
    expect(fetched).toBeDefined();
    expect(fetched!.provider).toBe("Dr. Smith");
  });

  test("list appointments", () => {
    const appts = listAppointments();
    expect(appts.length).toBeGreaterThanOrEqual(1);
  });

  test("list appointments by status", () => {
    const scheduled = listAppointments({ status: "scheduled" });
    expect(scheduled.every((a) => a.status === "scheduled")).toBe(true);
  });

  test("list appointments by provider", () => {
    const results = listAppointments({ provider: "Dr. Smith" });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("update appointment", () => {
    const appt = createAppointment({
      provider: "Dr. Jones",
      scheduled_at: "2025-07-01T14:00:00Z",
    });
    const updated = updateAppointment(appt.id, {
      location: "New Clinic",
      notes: "Updated location",
    });

    expect(updated).toBeDefined();
    expect(updated!.location).toBe("New Clinic");
    expect(updated!.notes).toBe("Updated location");
  });

  test("update nonexistent appointment returns null", () => {
    expect(updateAppointment("nonexistent-id", { provider: "X" })).toBeNull();
  });

  test("complete appointment", () => {
    const appt = createAppointment({
      provider: "Dr. Complete",
      scheduled_at: "2025-01-01T09:00:00Z",
    });
    const completed = completeAppointment(appt.id);
    expect(completed).toBeDefined();
    expect(completed!.status).toBe("completed");
  });

  test("cancel appointment", () => {
    const appt = createAppointment({
      provider: "Dr. Cancel",
      scheduled_at: "2025-01-02T09:00:00Z",
    });
    const cancelled = cancelAppointment(appt.id);
    expect(cancelled).toBeDefined();
    expect(cancelled!.status).toBe("cancelled");
  });

  test("delete appointment", () => {
    const appt = createAppointment({
      provider: "Dr. Delete",
      scheduled_at: "2025-01-03T09:00:00Z",
    });
    expect(deleteAppointment(appt.id)).toBe(true);
    expect(getAppointment(appt.id)).toBeNull();
  });

  test("get upcoming appointments", () => {
    // Create a future appointment
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);
    createAppointment({
      provider: "Dr. Future",
      scheduled_at: futureDate.toISOString(),
    });

    const upcoming = getUpcomingAppointments(30);
    expect(upcoming.length).toBeGreaterThanOrEqual(1);
    expect(upcoming.every((a) => a.status === "scheduled")).toBe(true);
  });

  test("get nonexistent appointment returns null", () => {
    expect(getAppointment("nonexistent-id")).toBeNull();
  });
});

// ============================================================
// Fitness Logs
// ============================================================

describe("Fitness Logs", () => {
  test("create and get fitness log", () => {
    const log = createFitnessLog({
      activity: "running",
      duration_min: 30,
      calories_burned: 300,
      distance: 5.2,
      notes: "Morning run",
    });

    expect(log.id).toBeTruthy();
    expect(log.activity).toBe("running");
    expect(log.duration_min).toBe(30);
    expect(log.calories_burned).toBe(300);
    expect(log.distance).toBe(5.2);
    expect(log.logged_at).toBeTruthy();

    const fetched = getFitnessLog(log.id);
    expect(fetched).toBeDefined();
    expect(fetched!.activity).toBe("running");
  });

  test("create fitness log with custom logged_at", () => {
    const log = createFitnessLog({
      activity: "swimming",
      duration_min: 45,
      logged_at: "2025-03-10T07:00:00Z",
    });

    expect(log.logged_at).toBe("2025-03-10T07:00:00Z");
  });

  test("list fitness logs", () => {
    const logs = listFitnessLogs();
    expect(logs.length).toBeGreaterThanOrEqual(2);
  });

  test("list fitness logs by activity", () => {
    const running = listFitnessLogs({ activity: "running" });
    expect(running.length).toBeGreaterThanOrEqual(1);
  });

  test("list fitness logs with limit", () => {
    const limited = listFitnessLogs({ limit: 1 });
    expect(limited.length).toBe(1);
  });

  test("delete fitness log", () => {
    const log = createFitnessLog({ activity: "deleteme" });
    expect(deleteFitnessLog(log.id)).toBe(true);
    expect(getFitnessLog(log.id)).toBeNull();
  });

  test("delete nonexistent fitness log returns false", () => {
    expect(deleteFitnessLog("nonexistent-id")).toBe(false);
  });

  test("get fitness stats", () => {
    const stats = getFitnessStats(30);
    expect(stats).toHaveProperty("total_sessions");
    expect(stats).toHaveProperty("total_minutes");
    expect(stats).toHaveProperty("total_calories");
    expect(stats).toHaveProperty("avg_duration");
    expect(stats.total_sessions).toBeGreaterThanOrEqual(0);
  });

  test("get nonexistent fitness log returns null", () => {
    expect(getFitnessLog("nonexistent-id")).toBeNull();
  });
});

// ============================================================
// Health Summary
// ============================================================

describe("Health Summary", () => {
  test("get health summary", () => {
    const summary = getHealthSummary();

    expect(summary).toHaveProperty("metrics");
    expect(summary.metrics).toHaveProperty("total");
    expect(summary.metrics).toHaveProperty("types");
    expect(summary.metrics.total).toBeGreaterThanOrEqual(1);

    expect(summary).toHaveProperty("medications");
    expect(summary.medications).toHaveProperty("total");
    expect(summary.medications).toHaveProperty("active");

    expect(summary).toHaveProperty("appointments");
    expect(summary.appointments).toHaveProperty("total");
    expect(summary.appointments).toHaveProperty("upcoming");
    expect(summary.appointments).toHaveProperty("completed");

    expect(summary).toHaveProperty("fitness");
    expect(summary.fitness).toHaveProperty("total_sessions");
    expect(summary.fitness).toHaveProperty("recent_stats");
  });
});
