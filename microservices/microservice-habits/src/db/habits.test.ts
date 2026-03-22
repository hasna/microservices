import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-habits-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createHabit,
  getHabit,
  listHabits,
  updateHabit,
  deleteHabit,
  activateHabit,
  deactivateHabit,
  completeHabit,
  getCompletions,
  getStreak,
  getAllStreaks,
  getCompletionRate,
  getTodayStatus,
  getWeeklyReport,
  countHabits,
} from "./habits";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Habits CRUD", () => {
  test("create and get habit", () => {
    const habit = createHabit({
      name: "Morning Run",
      description: "Run 5km every morning",
      frequency: "daily",
      target_count: 1,
      category: "Health",
    });

    expect(habit.id).toBeTruthy();
    expect(habit.name).toBe("Morning Run");
    expect(habit.description).toBe("Run 5km every morning");
    expect(habit.frequency).toBe("daily");
    expect(habit.target_count).toBe(1);
    expect(habit.category).toBe("Health");
    expect(habit.active).toBe(true);

    const fetched = getHabit(habit.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(habit.id);
    expect(fetched!.name).toBe("Morning Run");
  });

  test("create habit with defaults", () => {
    const habit = createHabit({ name: "Read" });
    expect(habit.frequency).toBe("daily");
    expect(habit.target_count).toBe(1);
    expect(habit.active).toBe(true);
    expect(habit.description).toBeNull();
    expect(habit.category).toBeNull();
  });

  test("get non-existent habit returns null", () => {
    const result = getHabit("non-existent-id");
    expect(result).toBeNull();
  });

  test("list habits", () => {
    const all = listHabits();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list habits with category filter", () => {
    const health = listHabits({ category: "Health" });
    expect(health.length).toBeGreaterThanOrEqual(1);
    expect(health.every((h) => h.category === "Health")).toBe(true);
  });

  test("list habits with active filter", () => {
    const active = listHabits({ active: true });
    expect(active.every((h) => h.active)).toBe(true);
  });

  test("list habits with frequency filter", () => {
    createHabit({ name: "Weekly Review", frequency: "weekly" });
    const weekly = listHabits({ frequency: "weekly" });
    expect(weekly.length).toBeGreaterThanOrEqual(1);
    expect(weekly.every((h) => h.frequency === "weekly")).toBe(true);
  });

  test("list habits with limit", () => {
    const limited = listHabits({ limit: 1 });
    expect(limited.length).toBe(1);
  });

  test("update habit", () => {
    const habit = createHabit({ name: "Old Name" });
    const updated = updateHabit(habit.id, {
      name: "New Name",
      description: "Updated description",
      category: "Fitness",
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("New Name");
    expect(updated!.description).toBe("Updated description");
    expect(updated!.category).toBe("Fitness");
  });

  test("update non-existent habit returns null", () => {
    const result = updateHabit("non-existent-id", { name: "test" });
    expect(result).toBeNull();
  });

  test("update with no fields returns existing", () => {
    const habit = createHabit({ name: "NoChange" });
    const updated = updateHabit(habit.id, {});
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("NoChange");
  });

  test("delete habit", () => {
    const habit = createHabit({ name: "DeleteMe" });
    expect(deleteHabit(habit.id)).toBe(true);
    expect(getHabit(habit.id)).toBeNull();
  });

  test("delete non-existent habit returns false", () => {
    expect(deleteHabit("non-existent-id")).toBe(false);
  });

  test("count habits", () => {
    const count = countHabits();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

describe("Activate / Deactivate", () => {
  test("deactivate a habit", () => {
    const habit = createHabit({ name: "ToDeactivate" });
    expect(habit.active).toBe(true);

    const deactivated = deactivateHabit(habit.id);
    expect(deactivated).toBeDefined();
    expect(deactivated!.active).toBe(false);
  });

  test("activate a deactivated habit", () => {
    const habit = createHabit({ name: "ToActivate" });
    deactivateHabit(habit.id);

    const activated = activateHabit(habit.id);
    expect(activated).toBeDefined();
    expect(activated!.active).toBe(true);
  });

  test("activate non-existent habit returns null", () => {
    expect(activateHabit("non-existent-id")).toBeNull();
  });

  test("deactivate non-existent habit returns null", () => {
    expect(deactivateHabit("non-existent-id")).toBeNull();
  });
});

describe("Completions", () => {
  test("complete a habit", () => {
    const habit = createHabit({ name: "Completable" });
    const completion = completeHabit(habit.id, "Felt great!", 10);

    expect(completion).toBeDefined();
    expect(completion!.habit_id).toBe(habit.id);
    expect(completion!.notes).toBe("Felt great!");
    expect(completion!.value).toBe(10);
    expect(completion!.completed_at).toBeTruthy();
  });

  test("complete non-existent habit returns null", () => {
    const result = completeHabit("non-existent-id");
    expect(result).toBeNull();
  });

  test("complete without notes and value", () => {
    const habit = createHabit({ name: "SimpleComplete" });
    const completion = completeHabit(habit.id);

    expect(completion).toBeDefined();
    expect(completion!.notes).toBeNull();
    expect(completion!.value).toBeNull();
  });

  test("get completions for a habit", () => {
    const habit = createHabit({ name: "MultiComplete" });
    completeHabit(habit.id, "First");
    completeHabit(habit.id, "Second");
    completeHabit(habit.id, "Third");

    const completions = getCompletions(habit.id);
    expect(completions.length).toBe(3);
    // All three notes should be present
    const notes = completions.map((c) => c.notes);
    expect(notes).toContain("First");
    expect(notes).toContain("Second");
    expect(notes).toContain("Third");
  });

  test("get completions with limit", () => {
    const habit = createHabit({ name: "LimitComplete" });
    completeHabit(habit.id);
    completeHabit(habit.id);
    completeHabit(habit.id);

    const limited = getCompletions(habit.id, 2);
    expect(limited.length).toBe(2);
  });
});

describe("Streaks", () => {
  test("streak initializes to 0", () => {
    const habit = createHabit({ name: "StreakInit" });
    const streak = getStreak(habit.id);

    expect(streak).toBeDefined();
    expect(streak!.current_streak).toBe(0);
    expect(streak!.longest_streak).toBe(0);
    expect(streak!.last_completed).toBeNull();
  });

  test("first completion sets streak to 1", () => {
    const habit = createHabit({ name: "FirstStreak" });
    completeHabit(habit.id);

    const streak = getStreak(habit.id);
    expect(streak!.current_streak).toBe(1);
    expect(streak!.longest_streak).toBe(1);
    expect(streak!.last_completed).toBeTruthy();
  });

  test("get all streaks returns active habits only", () => {
    const active = createHabit({ name: "ActiveStreak" });
    const inactive = createHabit({ name: "InactiveStreak" });
    deactivateHabit(inactive.id);

    completeHabit(active.id);

    const streaks = getAllStreaks();
    const ids = streaks.map((s) => s.habit_id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
  });
});

describe("Analytics", () => {
  test("completion rate for habit with completions", () => {
    const habit = createHabit({ name: "RateHabit", frequency: "daily" });
    completeHabit(habit.id);

    const rate = getCompletionRate(habit.id, 30);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThanOrEqual(100);
  });

  test("completion rate for non-existent habit returns 0", () => {
    const rate = getCompletionRate("non-existent-id", 30);
    expect(rate).toBe(0);
  });

  test("today status returns active habits", () => {
    const habit = createHabit({ name: "TodayHabit" });
    const status = getTodayStatus();

    expect(status.length).toBeGreaterThanOrEqual(1);
    const found = status.find((s) => s.habit.id === habit.id);
    expect(found).toBeDefined();
    expect(found!.completed_today).toBe(false);
  });

  test("today status shows completed after completion", () => {
    const habit = createHabit({ name: "TodayDone" });
    completeHabit(habit.id);

    const status = getTodayStatus();
    const found = status.find((s) => s.habit.id === habit.id);
    expect(found).toBeDefined();
    expect(found!.completed_today).toBe(true);
  });

  test("weekly report returns entries for active habits", () => {
    const habit = createHabit({ name: "WeeklyHabit" });
    completeHabit(habit.id);

    const report = getWeeklyReport();
    expect(report.length).toBeGreaterThanOrEqual(1);

    const entry = report.find((r) => r.habit.id === habit.id);
    expect(entry).toBeDefined();
    expect(entry!.completions).toBeGreaterThanOrEqual(1);
    expect(entry!.rate).toBeGreaterThan(0);
  });

  test("weekly report has correct structure", () => {
    const report = getWeeklyReport();
    for (const entry of report) {
      expect(entry.habit).toBeDefined();
      expect(typeof entry.completions).toBe("number");
      expect(typeof entry.target).toBe("number");
      expect(typeof entry.rate).toBe("number");
      expect(entry.target).toBeGreaterThan(0);
    }
  });
});
