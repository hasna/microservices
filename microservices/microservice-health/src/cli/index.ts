#!/usr/bin/env bun

import { Command } from "commander";
import {
  createMetric,
  listMetrics,
  getMetricTrend,
  deleteMetric,
} from "../db/health.js";
import {
  createMedication,
  getMedication,
  listMedications,
  updateMedication,
  deactivateMedication,
} from "../db/health.js";
import {
  createAppointment,
  listAppointments,
  completeAppointment,
  cancelAppointment,
  getUpcomingAppointments,
} from "../db/health.js";
import {
  createFitnessLog,
  listFitnessLogs,
  getFitnessStats,
} from "../db/health.js";
import { getHealthSummary } from "../db/health.js";

const program = new Command();

program
  .name("microservice-health")
  .description("Health tracking microservice")
  .version("0.0.1");

// --- Metrics ---

const metricCmd = program
  .command("metric")
  .description("Health metrics tracking");

metricCmd
  .command("record")
  .description("Record a health metric")
  .requiredOption("--type <type>", "Metric type (e.g. weight, blood_pressure, heart_rate)")
  .requiredOption("--value <value>", "Metric value")
  .option("--unit <unit>", "Unit of measurement")
  .option("--notes <notes>", "Notes")
  .option("--recorded-at <datetime>", "When recorded (ISO 8601)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const metric = createMetric({
      type: opts.type,
      value: parseFloat(opts.value),
      unit: opts.unit,
      notes: opts.notes,
      recorded_at: opts.recordedAt,
    });

    if (opts.json) {
      console.log(JSON.stringify(metric, null, 2));
    } else {
      console.log(`Recorded ${metric.type}: ${metric.value}${metric.unit ? ` ${metric.unit}` : ""} (${metric.id})`);
    }
  });

metricCmd
  .command("list")
  .description("List health metrics")
  .option("--type <type>", "Filter by type")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const metrics = listMetrics({
      type: opts.type,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(metrics, null, 2));
    } else {
      if (metrics.length === 0) {
        console.log("No metrics found.");
        return;
      }
      for (const m of metrics) {
        const unit = m.unit ? ` ${m.unit}` : "";
        console.log(`  ${m.type}: ${m.value}${unit} (${m.recorded_at})`);
      }
      console.log(`\n${metrics.length} metric(s)`);
    }
  });

metricCmd
  .command("trend")
  .description("Show metric trend over time")
  .requiredOption("--type <type>", "Metric type")
  .option("--days <n>", "Number of days", "30")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const trend = getMetricTrend(opts.type, parseInt(opts.days));

    if (opts.json) {
      console.log(JSON.stringify(trend, null, 2));
    } else {
      if (trend.length === 0) {
        console.log(`No data for ${opts.type} in the last ${opts.days} days.`);
        return;
      }
      console.log(`Trend for ${opts.type} (last ${opts.days} days):`);
      for (const point of trend) {
        console.log(`  ${point.date}: ${point.value}`);
      }
    }
  });

// --- Medications ---

const medCmd = program
  .command("medication")
  .alias("med")
  .description("Medication management");

medCmd
  .command("add")
  .description("Add a medication")
  .requiredOption("--name <name>", "Medication name")
  .option("--dosage <dosage>", "Dosage (e.g. 10mg)")
  .option("--frequency <frequency>", "Frequency (e.g. twice daily)")
  .option("--start-date <date>", "Start date")
  .option("--end-date <date>", "End date")
  .option("--refill-date <date>", "Next refill date")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const med = createMedication({
      name: opts.name,
      dosage: opts.dosage,
      frequency: opts.frequency,
      start_date: opts.startDate,
      end_date: opts.endDate,
      refill_date: opts.refillDate,
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(med, null, 2));
    } else {
      console.log(`Added medication: ${med.name}${med.dosage ? ` (${med.dosage})` : ""} (${med.id})`);
    }
  });

medCmd
  .command("list")
  .description("List medications")
  .option("--active", "Show only active medications")
  .option("--all", "Show all medications including inactive")
  .option("--search <query>", "Search by name")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const meds = listMedications({
      active: opts.all ? undefined : (opts.active !== undefined ? true : undefined),
      search: opts.search,
    });

    if (opts.json) {
      console.log(JSON.stringify(meds, null, 2));
    } else {
      if (meds.length === 0) {
        console.log("No medications found.");
        return;
      }
      for (const m of meds) {
        const dosage = m.dosage ? ` ${m.dosage}` : "";
        const freq = m.frequency ? ` (${m.frequency})` : "";
        const status = m.active ? "" : " [INACTIVE]";
        console.log(`  ${m.name}${dosage}${freq}${status}`);
      }
      console.log(`\n${meds.length} medication(s)`);
    }
  });

medCmd
  .command("get")
  .description("Get medication details")
  .argument("<id>", "Medication ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const med = getMedication(id);
    if (!med) {
      console.error(`Medication '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(med, null, 2));
    } else {
      console.log(`${med.name}`);
      if (med.dosage) console.log(`  Dosage: ${med.dosage}`);
      if (med.frequency) console.log(`  Frequency: ${med.frequency}`);
      if (med.start_date) console.log(`  Start: ${med.start_date}`);
      if (med.end_date) console.log(`  End: ${med.end_date}`);
      if (med.refill_date) console.log(`  Refill: ${med.refill_date}`);
      console.log(`  Active: ${med.active ? "Yes" : "No"}`);
      if (med.notes) console.log(`  Notes: ${med.notes}`);
    }
  });

medCmd
  .command("update")
  .description("Update a medication")
  .argument("<id>", "Medication ID")
  .option("--name <name>", "Name")
  .option("--dosage <dosage>", "Dosage")
  .option("--frequency <frequency>", "Frequency")
  .option("--start-date <date>", "Start date")
  .option("--end-date <date>", "End date")
  .option("--refill-date <date>", "Refill date")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.dosage !== undefined) input.dosage = opts.dosage;
    if (opts.frequency !== undefined) input.frequency = opts.frequency;
    if (opts.startDate !== undefined) input.start_date = opts.startDate;
    if (opts.endDate !== undefined) input.end_date = opts.endDate;
    if (opts.refillDate !== undefined) input.refill_date = opts.refillDate;
    if (opts.notes !== undefined) input.notes = opts.notes;

    const med = updateMedication(id, input);
    if (!med) {
      console.error(`Medication '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(med, null, 2));
    } else {
      console.log(`Updated: ${med.name}`);
    }
  });

medCmd
  .command("deactivate")
  .description("Deactivate a medication")
  .argument("<id>", "Medication ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const med = deactivateMedication(id);
    if (!med) {
      console.error(`Medication '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(med, null, 2));
    } else {
      console.log(`Deactivated: ${med.name}`);
    }
  });

// --- Appointments ---

const apptCmd = program
  .command("appointment")
  .alias("appt")
  .description("Appointment management");

apptCmd
  .command("schedule")
  .description("Schedule an appointment")
  .requiredOption("--provider <provider>", "Provider name")
  .requiredOption("--scheduled-at <datetime>", "Date/time (ISO 8601)")
  .option("--specialty <specialty>", "Specialty")
  .option("--location <location>", "Location")
  .option("--notes <notes>", "Notes")
  .option("--follow-up <date>", "Follow-up date")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const appt = createAppointment({
      provider: opts.provider,
      scheduled_at: opts.scheduledAt,
      specialty: opts.specialty,
      location: opts.location,
      notes: opts.notes,
      follow_up_date: opts.followUp,
    });

    if (opts.json) {
      console.log(JSON.stringify(appt, null, 2));
    } else {
      console.log(`Scheduled: ${appt.provider} on ${appt.scheduled_at} (${appt.id})`);
    }
  });

apptCmd
  .command("list")
  .description("List appointments")
  .option("--status <status>", "Filter by status")
  .option("--provider <provider>", "Filter by provider")
  .option("--upcoming <days>", "Show upcoming appointments within N days")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    let appointments;
    if (opts.upcoming) {
      appointments = getUpcomingAppointments(parseInt(opts.upcoming));
    } else {
      appointments = listAppointments({
        status: opts.status,
        provider: opts.provider,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
    }

    if (opts.json) {
      console.log(JSON.stringify(appointments, null, 2));
    } else {
      if (appointments.length === 0) {
        console.log("No appointments found.");
        return;
      }
      for (const a of appointments) {
        const specialty = a.specialty ? ` (${a.specialty})` : "";
        const location = a.location ? ` @ ${a.location}` : "";
        console.log(`  ${a.provider}${specialty}${location} - ${a.scheduled_at} [${a.status}]`);
      }
      console.log(`\n${appointments.length} appointment(s)`);
    }
  });

apptCmd
  .command("complete")
  .description("Mark an appointment as completed")
  .argument("<id>", "Appointment ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const appt = completeAppointment(id);
    if (!appt) {
      console.error(`Appointment '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(appt, null, 2));
    } else {
      console.log(`Completed: ${appt.provider} (${appt.scheduled_at})`);
    }
  });

apptCmd
  .command("cancel")
  .description("Cancel an appointment")
  .argument("<id>", "Appointment ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const appt = cancelAppointment(id);
    if (!appt) {
      console.error(`Appointment '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(appt, null, 2));
    } else {
      console.log(`Cancelled: ${appt.provider} (${appt.scheduled_at})`);
    }
  });

// --- Fitness ---

const fitnessCmd = program
  .command("fitness")
  .description("Fitness log tracking");

fitnessCmd
  .command("log")
  .description("Log a fitness activity")
  .requiredOption("--activity <activity>", "Activity type (e.g. running, swimming)")
  .option("--duration <min>", "Duration in minutes")
  .option("--calories <cal>", "Calories burned")
  .option("--distance <dist>", "Distance")
  .option("--notes <notes>", "Notes")
  .option("--logged-at <datetime>", "When logged (ISO 8601)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const log = createFitnessLog({
      activity: opts.activity,
      duration_min: opts.duration ? parseInt(opts.duration) : undefined,
      calories_burned: opts.calories ? parseInt(opts.calories) : undefined,
      distance: opts.distance ? parseFloat(opts.distance) : undefined,
      notes: opts.notes,
      logged_at: opts.loggedAt,
    });

    if (opts.json) {
      console.log(JSON.stringify(log, null, 2));
    } else {
      const dur = log.duration_min ? ` ${log.duration_min}min` : "";
      const cal = log.calories_burned ? ` ${log.calories_burned}cal` : "";
      console.log(`Logged: ${log.activity}${dur}${cal} (${log.id})`);
    }
  });

fitnessCmd
  .command("list")
  .description("List fitness logs")
  .option("--activity <activity>", "Filter by activity")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const logs = listFitnessLogs({
      activity: opts.activity,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(logs, null, 2));
    } else {
      if (logs.length === 0) {
        console.log("No fitness logs found.");
        return;
      }
      for (const l of logs) {
        const dur = l.duration_min ? ` ${l.duration_min}min` : "";
        const cal = l.calories_burned ? ` ${l.calories_burned}cal` : "";
        const dist = l.distance ? ` ${l.distance}` : "";
        console.log(`  ${l.activity}${dur}${cal}${dist} (${l.logged_at})`);
      }
      console.log(`\n${logs.length} log(s)`);
    }
  });

fitnessCmd
  .command("stats")
  .description("Show fitness statistics")
  .option("--days <n>", "Number of days", "30")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getFitnessStats(parseInt(opts.days));

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(`Fitness stats (last ${opts.days} days):`);
      console.log(`  Total sessions: ${stats.total_sessions}`);
      console.log(`  Total minutes: ${stats.total_minutes}`);
      console.log(`  Total calories: ${stats.total_calories}`);
      console.log(`  Avg duration: ${stats.avg_duration} min`);
    }
  });

// --- Summary ---

program
  .command("summary")
  .description("Show overall health summary")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const summary = getHealthSummary();

    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log("Health Summary:");
      console.log(`\n  Metrics: ${summary.metrics.total} recorded`);
      if (summary.metrics.types.length) {
        console.log(`    Types: ${summary.metrics.types.join(", ")}`);
      }
      console.log(`\n  Medications: ${summary.medications.total} total, ${summary.medications.active} active`);
      console.log(`\n  Appointments: ${summary.appointments.total} total`);
      console.log(`    Upcoming: ${summary.appointments.upcoming}`);
      console.log(`    Completed: ${summary.appointments.completed}`);
      console.log(`\n  Fitness (last 30 days):`);
      console.log(`    Sessions: ${summary.fitness.recent_stats.total_sessions}`);
      console.log(`    Total minutes: ${summary.fitness.recent_stats.total_minutes}`);
      console.log(`    Total calories: ${summary.fitness.recent_stats.total_calories}`);
    }
  });

program.parse(process.argv);
