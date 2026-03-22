/**
 * Habit CRUD operations, completions, streaks, and analytics
 */

import { getDatabase } from "./database.js";

// --- Types ---

export interface Habit {
  id: string;
  name: string;
  description: string | null;
  frequency: "daily" | "weekly" | "monthly";
  target_count: number;
  category: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface HabitRow {
  id: string;
  name: string;
  description: string | null;
  frequency: string;
  target_count: number;
  category: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface Completion {
  id: string;
  habit_id: string;
  completed_at: string;
  notes: string | null;
  value: number | null;
}

export interface Streak {
  habit_id: string;
  current_streak: number;
  longest_streak: number;
  last_completed: string | null;
}

export interface TodayStatus {
  habit: Habit;
  completed_today: boolean;
}

export interface WeeklyReportEntry {
  habit: Habit;
  completions: number;
  target: number;
  rate: number;
}

// --- Helpers ---

function rowToHabit(row: HabitRow): Habit {
  return {
    ...row,
    frequency: row.frequency as Habit["frequency"],
    active: row.active === 1,
  };
}

function todayDate(): string {
  return new Date().toISOString().split("T")[0];
}

function startOfWeek(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split("T")[0];
}

// --- CRUD ---

export interface CreateHabitInput {
  name: string;
  description?: string;
  frequency?: "daily" | "weekly" | "monthly";
  target_count?: number;
  category?: string;
}

export function createHabit(input: CreateHabitInput): Habit {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO habits (id, name, description, frequency, target_count, category)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.description || null,
    input.frequency || "daily",
    input.target_count ?? 1,
    input.category || null
  );

  // Initialize streak record
  db.prepare(
    `INSERT INTO streaks (habit_id, current_streak, longest_streak, last_completed)
     VALUES (?, 0, 0, NULL)`
  ).run(id);

  return getHabit(id)!;
}

export function getHabit(id: string): Habit | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM habits WHERE id = ?").get(id) as HabitRow | null;
  return row ? rowToHabit(row) : null;
}

export interface ListHabitsOptions {
  category?: string;
  active?: boolean;
  frequency?: string;
  limit?: number;
  offset?: number;
}

export function listHabits(options: ListHabitsOptions = {}): Habit[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.category) {
    conditions.push("category = ?");
    params.push(options.category);
  }

  if (options.active !== undefined) {
    conditions.push("active = ?");
    params.push(options.active ? 1 : 0);
  }

  if (options.frequency) {
    conditions.push("frequency = ?");
    params.push(options.frequency);
  }

  let sql = "SELECT * FROM habits";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY name";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as HabitRow[];
  return rows.map(rowToHabit);
}

export interface UpdateHabitInput {
  name?: string;
  description?: string;
  frequency?: "daily" | "weekly" | "monthly";
  target_count?: number;
  category?: string;
}

export function updateHabit(id: string, input: UpdateHabitInput): Habit | null {
  const db = getDatabase();
  const existing = getHabit(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.frequency !== undefined) {
    sets.push("frequency = ?");
    params.push(input.frequency);
  }
  if (input.target_count !== undefined) {
    sets.push("target_count = ?");
    params.push(input.target_count);
  }
  if (input.category !== undefined) {
    sets.push("category = ?");
    params.push(input.category);
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE habits SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getHabit(id);
}

export function deleteHabit(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM habits WHERE id = ?").run(id);
  return result.changes > 0;
}

export function activateHabit(id: string): Habit | null {
  const db = getDatabase();
  const existing = getHabit(id);
  if (!existing) return null;

  db.prepare("UPDATE habits SET active = 1, updated_at = datetime('now') WHERE id = ?").run(id);
  return getHabit(id);
}

export function deactivateHabit(id: string): Habit | null {
  const db = getDatabase();
  const existing = getHabit(id);
  if (!existing) return null;

  db.prepare("UPDATE habits SET active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
  return getHabit(id);
}

// --- Completions ---

export function completeHabit(
  habitId: string,
  notes?: string,
  value?: number
): Completion | null {
  const db = getDatabase();
  const habit = getHabit(habitId);
  if (!habit) return null;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO completions (id, habit_id, completed_at, notes, value)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, habitId, now, notes || null, value ?? null);

  // Update streak
  updateStreak(habitId, now);

  return {
    id,
    habit_id: habitId,
    completed_at: now,
    notes: notes || null,
    value: value ?? null,
  };
}

function updateStreak(habitId: string, completedAt: string): void {
  const db = getDatabase();

  const streak = db.prepare("SELECT * FROM streaks WHERE habit_id = ?").get(habitId) as Streak | null;

  const today = completedAt.split("T")[0];

  if (!streak) {
    // First completion ever
    db.prepare(
      `INSERT INTO streaks (habit_id, current_streak, longest_streak, last_completed)
       VALUES (?, 1, 1, ?)`
    ).run(habitId, today);
    return;
  }

  const lastCompleted = streak.last_completed;

  if (!lastCompleted) {
    // No previous completion
    db.prepare(
      `UPDATE streaks SET current_streak = 1, longest_streak = MAX(longest_streak, 1), last_completed = ? WHERE habit_id = ?`
    ).run(today, habitId);
    return;
  }

  // Check if already completed today
  if (lastCompleted === today) {
    return; // Streak doesn't change for same-day completions
  }

  // Check if this is a consecutive day
  const lastDate = new Date(lastCompleted + "T00:00:00Z");
  const todayDate = new Date(today + "T00:00:00Z");
  const diffDays = Math.floor(
    (todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 1) {
    // Consecutive day — increment streak
    const newStreak = streak.current_streak + 1;
    const newLongest = Math.max(streak.longest_streak, newStreak);
    db.prepare(
      `UPDATE streaks SET current_streak = ?, longest_streak = ?, last_completed = ? WHERE habit_id = ?`
    ).run(newStreak, newLongest, today, habitId);
  } else {
    // Streak broken — reset to 1
    const newLongest = Math.max(streak.longest_streak, 1);
    db.prepare(
      `UPDATE streaks SET current_streak = 1, longest_streak = ?, last_completed = ? WHERE habit_id = ?`
    ).run(newLongest, today, habitId);
  }
}

export function getCompletions(habitId: string, limit?: number): Completion[] {
  const db = getDatabase();
  let sql = "SELECT * FROM completions WHERE habit_id = ? ORDER BY completed_at DESC";
  const params: unknown[] = [habitId];

  if (limit) {
    sql += " LIMIT ?";
    params.push(limit);
  }

  return db.prepare(sql).all(...params) as Completion[];
}

// --- Streaks ---

export function getStreak(habitId: string): Streak | null {
  const db = getDatabase();
  return db.prepare("SELECT * FROM streaks WHERE habit_id = ?").get(habitId) as Streak | null;
}

export function getAllStreaks(): Streak[] {
  const db = getDatabase();
  return db.prepare(
    "SELECT s.* FROM streaks s JOIN habits h ON s.habit_id = h.id WHERE h.active = 1 ORDER BY s.current_streak DESC"
  ).all() as Streak[];
}

// --- Analytics ---

export function getCompletionRate(habitId: string, days: number): number {
  const db = getDatabase();
  const habit = getHabit(habitId);
  if (!habit) return 0;

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);
  const since = sinceDate.toISOString();

  const row = db
    .prepare(
      "SELECT COUNT(*) as count FROM completions WHERE habit_id = ? AND completed_at >= ?"
    )
    .get(habitId, since) as { count: number };

  // For daily habits: target = days * target_count
  // For weekly: target = (days / 7) * target_count
  // For monthly: target = (days / 30) * target_count
  let target: number;
  switch (habit.frequency) {
    case "daily":
      target = days * habit.target_count;
      break;
    case "weekly":
      target = Math.max(1, Math.floor(days / 7)) * habit.target_count;
      break;
    case "monthly":
      target = Math.max(1, Math.floor(days / 30)) * habit.target_count;
      break;
  }

  return Math.min(100, Math.round((row.count / target) * 100));
}

export function getTodayStatus(): TodayStatus[] {
  const db = getDatabase();
  const habits = listHabits({ active: true });
  const today = todayDate();
  const todayStart = today + "T00:00:00";
  const todayEnd = today + "T23:59:59";

  return habits.map((habit) => {
    const row = db
      .prepare(
        "SELECT COUNT(*) as count FROM completions WHERE habit_id = ? AND completed_at >= ? AND completed_at <= ?"
      )
      .get(habit.id, todayStart, todayEnd) as { count: number };

    return {
      habit,
      completed_today: row.count >= habit.target_count,
    };
  });
}

export function getWeeklyReport(): WeeklyReportEntry[] {
  const db = getDatabase();
  const habits = listHabits({ active: true });
  const weekStart = startOfWeek();
  const weekStartDatetime = weekStart + "T00:00:00";

  return habits.map((habit) => {
    const row = db
      .prepare(
        "SELECT COUNT(*) as count FROM completions WHERE habit_id = ? AND completed_at >= ?"
      )
      .get(habit.id, weekStartDatetime) as { count: number };

    let target: number;
    switch (habit.frequency) {
      case "daily":
        target = 7 * habit.target_count;
        break;
      case "weekly":
        target = habit.target_count;
        break;
      case "monthly":
        target = Math.max(1, Math.round(habit.target_count / 4));
        break;
    }

    return {
      habit,
      completions: row.count,
      target,
      rate: Math.min(100, Math.round((row.count / target) * 100)),
    };
  });
}

export function countHabits(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM habits").get() as { count: number };
  return row.count;
}
