import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-calendar-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

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
} from "./calendar";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Events", () => {
  test("create and get event", () => {
    const event = createEvent({
      title: "Team Meeting",
      start_at: "2026-03-15T10:00:00",
      end_at: "2026-03-15T11:00:00",
      location: "Conference Room A",
      tags: ["work", "meeting"],
    });

    expect(event.id).toBeTruthy();
    expect(event.title).toBe("Team Meeting");
    expect(event.start_at).toBe("2026-03-15T10:00:00");
    expect(event.end_at).toBe("2026-03-15T11:00:00");
    expect(event.location).toBe("Conference Room A");
    expect(event.calendar).toBe("default");
    expect(event.status).toBe("confirmed");
    expect(event.all_day).toBe(false);
    expect(event.tags).toEqual(["work", "meeting"]);

    const fetched = getEvent(event.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(event.id);
  });

  test("create all-day event", () => {
    const event = createEvent({
      title: "Company Holiday",
      start_at: "2026-03-20",
      all_day: true,
      calendar: "holidays",
    });

    expect(event.all_day).toBe(true);
    expect(event.calendar).toBe("holidays");
  });

  test("create tentative event", () => {
    const event = createEvent({
      title: "Maybe Lunch",
      start_at: "2026-03-16T12:00:00",
      status: "tentative",
    });

    expect(event.status).toBe("tentative");
  });

  test("list events", () => {
    const all = listEvents();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("list events by date range", () => {
    createEvent({
      title: "April Event",
      start_at: "2026-04-01T09:00:00",
    });

    const march = listEvents({
      from: "2026-03-01",
      to: "2026-03-31T23:59:59",
    });
    expect(march.every((e) => e.start_at >= "2026-03-01" && e.start_at <= "2026-03-31T23:59:59")).toBe(true);

    const april = listEvents({
      from: "2026-04-01",
      to: "2026-04-30",
    });
    expect(april.length).toBeGreaterThanOrEqual(1);
  });

  test("list events by calendar", () => {
    const holidays = listEvents({ calendar: "holidays" });
    expect(holidays.length).toBeGreaterThanOrEqual(1);
    expect(holidays.every((e) => e.calendar === "holidays")).toBe(true);
  });

  test("list events by status", () => {
    const tentative = listEvents({ status: "tentative" });
    expect(tentative.length).toBeGreaterThanOrEqual(1);
    expect(tentative.every((e) => e.status === "tentative")).toBe(true);
  });

  test("update event", () => {
    const event = createEvent({
      title: "Original Title",
      start_at: "2026-03-17T14:00:00",
    });

    const updated = updateEvent(event.id, {
      title: "Updated Title",
      location: "Room B",
      status: "cancelled",
    });

    expect(updated).toBeDefined();
    expect(updated!.title).toBe("Updated Title");
    expect(updated!.location).toBe("Room B");
    expect(updated!.status).toBe("cancelled");
  });

  test("update event tags", () => {
    const event = createEvent({
      title: "Tagged Event",
      start_at: "2026-03-18T09:00:00",
      tags: ["initial"],
    });

    const updated = updateEvent(event.id, {
      tags: ["updated", "new-tag"],
    });

    expect(updated!.tags).toEqual(["updated", "new-tag"]);
  });

  test("update nonexistent event returns null", () => {
    const result = updateEvent("nonexistent-id", { title: "Nope" });
    expect(result).toBeNull();
  });

  test("delete event", () => {
    const event = createEvent({
      title: "Delete Me",
      start_at: "2026-03-19T08:00:00",
    });

    expect(deleteEvent(event.id)).toBe(true);
    expect(getEvent(event.id)).toBeNull();
  });

  test("delete nonexistent event returns false", () => {
    expect(deleteEvent("nonexistent-id")).toBe(false);
  });

  test("getUpcoming returns future events", () => {
    // Create a far-future event to ensure it shows up
    createEvent({
      title: "Future Event",
      start_at: "2099-01-01T00:00:00",
    });

    const upcoming = getUpcoming(5);
    expect(upcoming.length).toBeGreaterThanOrEqual(1);
    // Should be sorted by start_at ascending
    for (let i = 1; i < upcoming.length; i++) {
      expect(upcoming[i].start_at >= upcoming[i - 1].start_at).toBe(true);
    }
    // Should not include cancelled events
    expect(upcoming.every((e) => e.status !== "cancelled")).toBe(true);
  });

  test("getToday returns today's events", () => {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    createEvent({
      title: "Today Event",
      start_at: `${todayStr}T15:00:00`,
    });

    const today = getToday();
    expect(today.length).toBeGreaterThanOrEqual(1);
    expect(today.some((e) => e.title === "Today Event")).toBe(true);
  });

  test("event with recurrence rule", () => {
    const event = createEvent({
      title: "Weekly Standup",
      start_at: "2026-03-16T09:00:00",
      recurrence_rule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
      reminder_minutes: 15,
    });

    expect(event.recurrence_rule).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(event.reminder_minutes).toBe(15);
  });

  test("event with metadata", () => {
    const event = createEvent({
      title: "Metadata Event",
      start_at: "2026-03-21T10:00:00",
      metadata: { source: "google", external_id: "abc123" },
    });

    expect(event.metadata).toEqual({ source: "google", external_id: "abc123" });
  });
});

describe("Reminders", () => {
  test("create reminder", () => {
    const event = createEvent({
      title: "Reminder Test Event",
      start_at: "2026-03-22T10:00:00",
    });

    const reminder = createReminder({
      event_id: event.id,
      remind_at: "2026-03-22T09:45:00",
    });

    expect(reminder.id).toBeTruthy();
    expect(reminder.event_id).toBe(event.id);
    expect(reminder.remind_at).toBe("2026-03-22T09:45:00");
    expect(reminder.sent).toBe(false);
  });

  test("list pending reminders", () => {
    const event = createEvent({
      title: "Past Reminder Event",
      start_at: "2020-01-01T10:00:00",
    });

    createReminder({
      event_id: event.id,
      remind_at: "2020-01-01T09:00:00",
    });

    const pending = listPendingReminders();
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending.every((r) => r.sent === false)).toBe(true);
  });

  test("mark reminder sent", () => {
    const event = createEvent({
      title: "Mark Sent Event",
      start_at: "2020-02-01T10:00:00",
    });

    const reminder = createReminder({
      event_id: event.id,
      remind_at: "2020-02-01T09:00:00",
    });

    expect(markReminderSent(reminder.id)).toBe(true);

    // Should no longer appear in pending
    const pending = listPendingReminders();
    expect(pending.find((r) => r.id === reminder.id)).toBeUndefined();
  });

  test("mark nonexistent reminder returns false", () => {
    expect(markReminderSent("nonexistent-id")).toBe(false);
  });

  test("deleting event cascades to reminders", () => {
    const event = createEvent({
      title: "Cascade Test",
      start_at: "2020-03-01T10:00:00",
    });

    createReminder({
      event_id: event.id,
      remind_at: "2020-03-01T09:00:00",
    });

    deleteEvent(event.id);

    // Pending reminders should not include reminders for the deleted event
    const pending = listPendingReminders();
    expect(pending.find((r) => r.event_id === event.id)).toBeUndefined();
  });
});
