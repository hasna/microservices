/**
 * Payroll schedule management
 */

import { getDatabase } from "./database.js";

// --- Types ---

export interface PayrollSchedule {
  id: string;
  frequency: "weekly" | "biweekly" | "semimonthly" | "monthly";
  anchor_date: string;
  created_at: string;
}

// --- Functions ---

export function setSchedule(frequency: PayrollSchedule["frequency"], anchorDate: string): PayrollSchedule {
  const db = getDatabase();
  // Only one schedule at a time — delete existing and insert new
  db.prepare("DELETE FROM payroll_schedule").run();
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO payroll_schedule (id, frequency, anchor_date) VALUES (?, ?, ?)"
  ).run(id, frequency, anchorDate);
  return getSchedule()!;
}

export function getSchedule(): PayrollSchedule | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM payroll_schedule ORDER BY created_at DESC LIMIT 1").get() as PayrollSchedule | null;
  return row || null;
}

function fmtDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Calculate the next pay period based on the payroll schedule.
 * Returns {start_date, end_date} for the next upcoming period from today.
 */
export function getNextPayPeriod(fromDate?: string): { start_date: string; end_date: string } | null {
  const schedule = getSchedule();
  if (!schedule) return null;

  const today = fromDate ? new Date(fromDate) : new Date();
  const anchor = new Date(schedule.anchor_date);

  switch (schedule.frequency) {
    case "weekly": {
      // Find the next weekly start from anchor
      const msPerWeek = 7 * 24 * 60 * 60 * 1000;
      const diffMs = today.getTime() - anchor.getTime();
      const weeksSinceAnchor = Math.ceil(diffMs / msPerWeek);
      const start = new Date(anchor.getTime() + weeksSinceAnchor * msPerWeek);
      const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
      return { start_date: fmtDate(start), end_date: fmtDate(end) };
    }
    case "biweekly": {
      const msPerTwoWeeks = 14 * 24 * 60 * 60 * 1000;
      const diffMs = today.getTime() - anchor.getTime();
      const biweeksSinceAnchor = Math.ceil(diffMs / msPerTwoWeeks);
      const start = new Date(anchor.getTime() + biweeksSinceAnchor * msPerTwoWeeks);
      const end = new Date(start.getTime() + 13 * 24 * 60 * 60 * 1000);
      return { start_date: fmtDate(start), end_date: fmtDate(end) };
    }
    case "semimonthly": {
      // Periods: 1st-15th and 16th-end of month
      const year = today.getFullYear();
      const month = today.getMonth();
      const day = today.getDate();
      if (day <= 15) {
        return {
          start_date: fmtDate(new Date(year, month, 1)),
          end_date: fmtDate(new Date(year, month, 15)),
        };
      } else {
        const lastDay = new Date(year, month + 1, 0).getDate();
        return {
          start_date: fmtDate(new Date(year, month, 16)),
          end_date: fmtDate(new Date(year, month, lastDay)),
        };
      }
    }
    case "monthly": {
      const year = today.getFullYear();
      const month = today.getMonth();
      const lastDay = new Date(year, month + 1, 0).getDate();
      return {
        start_date: fmtDate(new Date(year, month, 1)),
        end_date: fmtDate(new Date(year, month, lastDay)),
      };
    }
    default:
      return null;
  }
}
