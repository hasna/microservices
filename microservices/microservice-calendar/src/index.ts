/**
 * microservice-calendar — Calendar management microservice
 */

export {
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
  type CalendarEvent,
  type Reminder,
  type CreateEventInput,
  type UpdateEventInput,
  type ListEventsOptions,
  type CreateReminderInput,
} from "./db/calendar.js";

export { getDatabase, closeDatabase } from "./db/database.js";
