/**
 * microservice-habits — Habit tracking microservice
 */

export {
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
  type Habit,
  type Completion,
  type Streak,
  type TodayStatus,
  type WeeklyReportEntry,
  type CreateHabitInput,
  type UpdateHabitInput,
  type ListHabitsOptions,
} from "./db/habits.js";

export { getDatabase, closeDatabase } from "./db/database.js";
