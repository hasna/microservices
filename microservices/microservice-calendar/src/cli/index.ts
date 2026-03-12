#!/usr/bin/env bun

import { Command } from "commander";
import {
  createEvent,
  getEvent,
  listEvents,
  updateEvent,
  deleteEvent,
  getUpcoming,
  getToday,
  createReminder,
  listPendingReminders,
  markReminderSent,
} from "../db/calendar.js";

const program = new Command();

program
  .name("microservice-calendar")
  .description("Calendar management microservice")
  .version("0.0.1");

// --- Events ---

program
  .command("add")
  .description("Add a new event")
  .requiredOption("--title <title>", "Event title")
  .requiredOption("--start <datetime>", "Start date/time (ISO 8601)")
  .option("--end <datetime>", "End date/time (ISO 8601)")
  .option("--all-day", "Mark as all-day event")
  .option("--location <location>", "Location")
  .option("--calendar <name>", "Calendar name", "default")
  .option("--status <status>", "Status: confirmed|tentative|cancelled", "confirmed")
  .option("--recurrence <rule>", "Recurrence rule (e.g. RRULE:FREQ=WEEKLY)")
  .option("--reminder <minutes>", "Reminder minutes before event")
  .option("--description <text>", "Event description")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const event = createEvent({
      title: opts.title,
      start_at: opts.start,
      end_at: opts.end,
      all_day: opts.allDay || false,
      location: opts.location,
      calendar: opts.calendar,
      status: opts.status,
      recurrence_rule: opts.recurrence,
      reminder_minutes: opts.reminder ? parseInt(opts.reminder) : undefined,
      description: opts.description,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(event, null, 2));
    } else {
      console.log(`Created event: ${event.title} (${event.id})`);
      console.log(`  Start: ${event.start_at}`);
      if (event.end_at) console.log(`  End:   ${event.end_at}`);
    }
  });

program
  .command("get")
  .description("Get an event by ID")
  .argument("<id>", "Event ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const event = getEvent(id);
    if (!event) {
      console.error(`Event '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(event, null, 2));
    } else {
      console.log(`${event.title}`);
      console.log(`  Start:    ${event.start_at}`);
      if (event.end_at) console.log(`  End:      ${event.end_at}`);
      console.log(`  Calendar: ${event.calendar}`);
      console.log(`  Status:   ${event.status}`);
      if (event.all_day) console.log(`  All day:  yes`);
      if (event.location) console.log(`  Location: ${event.location}`);
      if (event.description) console.log(`  Description: ${event.description}`);
      if (event.tags.length) console.log(`  Tags: ${event.tags.join(", ")}`);
      if (event.recurrence_rule) console.log(`  Recurrence: ${event.recurrence_rule}`);
      if (event.reminder_minutes != null) console.log(`  Reminder: ${event.reminder_minutes} min before`);
    }
  });

program
  .command("list")
  .description("List events")
  .option("--from <date>", "From date/time")
  .option("--to <date>", "To date/time")
  .option("--calendar <name>", "Filter by calendar")
  .option("--status <status>", "Filter by status")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const events = listEvents({
      from: opts.from,
      to: opts.to,
      calendar: opts.calendar,
      status: opts.status,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(events, null, 2));
    } else {
      if (events.length === 0) {
        console.log("No events found.");
        return;
      }
      for (const e of events) {
        const loc = e.location ? ` @ ${e.location}` : "";
        const tags = e.tags.length ? ` [${e.tags.join(", ")}]` : "";
        console.log(`  ${e.start_at}  ${e.title}${loc}${tags}  (${e.status})`);
      }
      console.log(`\n${events.length} event(s)`);
    }
  });

program
  .command("update")
  .description("Update an event")
  .argument("<id>", "Event ID")
  .option("--title <title>", "Title")
  .option("--start <datetime>", "Start date/time")
  .option("--end <datetime>", "End date/time")
  .option("--all-day", "Mark as all-day")
  .option("--location <location>", "Location")
  .option("--calendar <name>", "Calendar name")
  .option("--status <status>", "Status")
  .option("--recurrence <rule>", "Recurrence rule")
  .option("--reminder <minutes>", "Reminder minutes")
  .option("--description <text>", "Description")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.title !== undefined) input.title = opts.title;
    if (opts.start !== undefined) input.start_at = opts.start;
    if (opts.end !== undefined) input.end_at = opts.end;
    if (opts.allDay !== undefined) input.all_day = opts.allDay;
    if (opts.location !== undefined) input.location = opts.location;
    if (opts.calendar !== undefined) input.calendar = opts.calendar;
    if (opts.status !== undefined) input.status = opts.status;
    if (opts.recurrence !== undefined) input.recurrence_rule = opts.recurrence;
    if (opts.reminder !== undefined) input.reminder_minutes = parseInt(opts.reminder);
    if (opts.description !== undefined) input.description = opts.description;
    if (opts.tags !== undefined) input.tags = opts.tags.split(",").map((t: string) => t.trim());

    const event = updateEvent(id, input);
    if (!event) {
      console.error(`Event '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(event, null, 2));
    } else {
      console.log(`Updated: ${event.title}`);
    }
  });

program
  .command("delete")
  .description("Delete an event")
  .argument("<id>", "Event ID")
  .action((id) => {
    const deleted = deleteEvent(id);
    if (deleted) {
      console.log(`Deleted event ${id}`);
    } else {
      console.error(`Event '${id}' not found.`);
      process.exit(1);
    }
  });

program
  .command("upcoming")
  .description("Show upcoming events")
  .option("--limit <n>", "Number of events", "10")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const events = getUpcoming(parseInt(opts.limit));

    if (opts.json) {
      console.log(JSON.stringify(events, null, 2));
    } else {
      if (events.length === 0) {
        console.log("No upcoming events.");
        return;
      }
      for (const e of events) {
        const loc = e.location ? ` @ ${e.location}` : "";
        console.log(`  ${e.start_at}  ${e.title}${loc}`);
      }
    }
  });

program
  .command("today")
  .description("Show today's events")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const events = getToday();

    if (opts.json) {
      console.log(JSON.stringify(events, null, 2));
    } else {
      if (events.length === 0) {
        console.log("No events today.");
        return;
      }
      for (const e of events) {
        const loc = e.location ? ` @ ${e.location}` : "";
        console.log(`  ${e.start_at}  ${e.title}${loc}`);
      }
    }
  });

// --- Reminders ---

const reminderCmd = program
  .command("reminder")
  .description("Reminder management");

reminderCmd
  .command("add")
  .description("Add a reminder for an event")
  .requiredOption("--event <id>", "Event ID")
  .requiredOption("--at <datetime>", "Remind at date/time (ISO 8601)")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const reminder = createReminder({
      event_id: opts.event,
      remind_at: opts.at,
    });

    if (opts.json) {
      console.log(JSON.stringify(reminder, null, 2));
    } else {
      console.log(`Created reminder: ${reminder.id} for event ${reminder.event_id} at ${reminder.remind_at}`);
    }
  });

reminderCmd
  .command("pending")
  .description("List pending reminders")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const reminders = listPendingReminders();

    if (opts.json) {
      console.log(JSON.stringify(reminders, null, 2));
    } else {
      if (reminders.length === 0) {
        console.log("No pending reminders.");
        return;
      }
      for (const r of reminders) {
        console.log(`  ${r.remind_at}  event:${r.event_id}  (${r.id})`);
      }
    }
  });

reminderCmd
  .command("sent")
  .description("Mark a reminder as sent")
  .argument("<id>", "Reminder ID")
  .action((id) => {
    const marked = markReminderSent(id);
    if (marked) {
      console.log(`Marked reminder ${id} as sent.`);
    } else {
      console.error(`Reminder '${id}' not found.`);
      process.exit(1);
    }
  });

program.parse(process.argv);
