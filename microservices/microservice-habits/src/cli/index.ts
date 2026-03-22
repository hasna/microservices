#!/usr/bin/env bun

import { Command } from "commander";
import {
  createHabit,
  getHabit,
  listHabits,
  updateHabit,
  deleteHabit,
  activateHabit,
  deactivateHabit,
  completeHabit,
  getStreak,
  getAllStreaks,
  getCompletionRate,
  getTodayStatus,
  getWeeklyReport,
} from "../db/habits.js";

const program = new Command();

program
  .name("microservice-habits")
  .description("Habit tracking microservice")
  .version("0.0.1");

// --- Habits CRUD ---

program
  .command("create")
  .description("Create a new habit")
  .requiredOption("--name <name>", "Habit name")
  .option("--description <desc>", "Description")
  .option("--frequency <freq>", "Frequency: daily, weekly, monthly", "daily")
  .option("--target <n>", "Target count per period", "1")
  .option("--category <cat>", "Category")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const habit = createHabit({
      name: opts.name,
      description: opts.description,
      frequency: opts.frequency,
      target_count: parseInt(opts.target),
      category: opts.category,
    });

    if (opts.json) {
      console.log(JSON.stringify(habit, null, 2));
    } else {
      console.log(`Created habit: ${habit.name} (${habit.id})`);
    }
  });

program
  .command("get")
  .description("Get a habit by ID")
  .argument("<id>", "Habit ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const habit = getHabit(id);
    if (!habit) {
      console.error(`Habit '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(habit, null, 2));
    } else {
      console.log(`${habit.name}`);
      if (habit.description) console.log(`  Description: ${habit.description}`);
      console.log(`  Frequency: ${habit.frequency}`);
      console.log(`  Target: ${habit.target_count}`);
      if (habit.category) console.log(`  Category: ${habit.category}`);
      console.log(`  Active: ${habit.active}`);
    }
  });

program
  .command("list")
  .description("List habits")
  .option("--category <cat>", "Filter by category")
  .option("--active", "Show only active habits")
  .option("--inactive", "Show only inactive habits")
  .option("--frequency <freq>", "Filter by frequency")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    let active: boolean | undefined;
    if (opts.active) active = true;
    if (opts.inactive) active = false;

    const habits = listHabits({
      category: opts.category,
      active,
      frequency: opts.frequency,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(habits, null, 2));
    } else {
      if (habits.length === 0) {
        console.log("No habits found.");
        return;
      }
      for (const h of habits) {
        const cat = h.category ? ` [${h.category}]` : "";
        const status = h.active ? "" : " (inactive)";
        console.log(`  ${h.name} (${h.frequency}, target: ${h.target_count})${cat}${status}`);
      }
      console.log(`\n${habits.length} habit(s)`);
    }
  });

program
  .command("update")
  .description("Update a habit")
  .argument("<id>", "Habit ID")
  .option("--name <name>", "Habit name")
  .option("--description <desc>", "Description")
  .option("--frequency <freq>", "Frequency")
  .option("--target <n>", "Target count")
  .option("--category <cat>", "Category")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.description !== undefined) input.description = opts.description;
    if (opts.frequency !== undefined) input.frequency = opts.frequency;
    if (opts.target !== undefined) input.target_count = parseInt(opts.target);
    if (opts.category !== undefined) input.category = opts.category;

    const habit = updateHabit(id, input);
    if (!habit) {
      console.error(`Habit '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(habit, null, 2));
    } else {
      console.log(`Updated: ${habit.name}`);
    }
  });

program
  .command("delete")
  .description("Delete a habit")
  .argument("<id>", "Habit ID")
  .action((id) => {
    const deleted = deleteHabit(id);
    if (deleted) {
      console.log(`Deleted habit ${id}`);
    } else {
      console.error(`Habit '${id}' not found.`);
      process.exit(1);
    }
  });

program
  .command("activate")
  .description("Activate a habit")
  .argument("<id>", "Habit ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const habit = activateHabit(id);
    if (!habit) {
      console.error(`Habit '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(habit, null, 2));
    } else {
      console.log(`Activated: ${habit.name}`);
    }
  });

program
  .command("deactivate")
  .description("Deactivate a habit")
  .argument("<id>", "Habit ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const habit = deactivateHabit(id);
    if (!habit) {
      console.error(`Habit '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(habit, null, 2));
    } else {
      console.log(`Deactivated: ${habit.name}`);
    }
  });

// --- Completions ---

program
  .command("complete")
  .description("Record a habit completion")
  .argument("<id>", "Habit ID")
  .option("--notes <notes>", "Completion notes")
  .option("--value <n>", "Numeric value")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const completion = completeHabit(
      id,
      opts.notes,
      opts.value ? parseFloat(opts.value) : undefined
    );
    if (!completion) {
      console.error(`Habit '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(completion, null, 2));
    } else {
      console.log(`Completed habit ${id} at ${completion.completed_at}`);
    }
  });

// --- Status & Analytics ---

program
  .command("today")
  .description("Show today's habit status")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const status = getTodayStatus();

    if (opts.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      if (status.length === 0) {
        console.log("No active habits.");
        return;
      }
      for (const s of status) {
        const check = s.completed_today ? "[x]" : "[ ]";
        console.log(`  ${check} ${s.habit.name}`);
      }
      const done = status.filter((s) => s.completed_today).length;
      console.log(`\n${done}/${status.length} completed today`);
    }
  });

program
  .command("streaks")
  .description("Show all streaks")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const streaks = getAllStreaks();

    if (opts.json) {
      console.log(JSON.stringify(streaks, null, 2));
    } else {
      if (streaks.length === 0) {
        console.log("No streaks.");
        return;
      }
      for (const s of streaks) {
        const habit = getHabit(s.habit_id);
        const name = habit ? habit.name : s.habit_id;
        console.log(`  ${name}: ${s.current_streak} day(s) (best: ${s.longest_streak})`);
      }
    }
  });

program
  .command("weekly-report")
  .description("Show weekly completion report")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const report = getWeeklyReport();

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      if (report.length === 0) {
        console.log("No active habits for report.");
        return;
      }
      for (const r of report) {
        console.log(`  ${r.habit.name}: ${r.completions}/${r.target} (${r.rate}%)`);
      }
    }
  });

program
  .command("rate")
  .description("Get completion rate for a habit")
  .argument("<id>", "Habit ID")
  .option("--days <n>", "Number of days to look back", "30")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const habit = getHabit(id);
    if (!habit) {
      console.error(`Habit '${id}' not found.`);
      process.exit(1);
    }

    const days = parseInt(opts.days);
    const rate = getCompletionRate(id, days);

    if (opts.json) {
      console.log(JSON.stringify({ habit_id: id, days, rate }));
    } else {
      console.log(`${habit.name}: ${rate}% completion rate over ${days} days`);
    }
  });

program.parse(process.argv);
