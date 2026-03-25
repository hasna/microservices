import { Command } from "commander";
import {
  setSetting,
  getAllSettings,
  deleteSetting,
} from "../../lib/settings.js";

export function registerSettingsCommands(program: Command): void {
  const settingsCmd = program.command("settings").description("Company settings management");

  settingsCmd
    .command("view")
    .description("View all settings")
    .option("--org <id>", "Organization ID")
    .option("--category <cat>", "Filter by category")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const settings = getAllSettings(opts.org || null, opts.category);

      if (opts.json) {
        console.log(JSON.stringify(settings, null, 2));
      } else {
        if (settings.length === 0) {
          console.log("No settings found.");
          return;
        }
        for (const s of settings) {
          const cat = s.category ? ` [${s.category}]` : "";
          console.log(`  ${s.key} = ${s.value}${cat}`);
        }
        console.log(`\n${settings.length} setting(s)`);
      }
    });

  settingsCmd
    .command("set")
    .description("Set a setting value")
    .argument("<key>", "Setting key")
    .argument("<value>", "Setting value")
    .option("--org <id>", "Organization ID")
    .option("--category <cat>", "Category")
    .option("--json", "Output as JSON", false)
    .action((key, value, opts) => {
      const setting = setSetting(opts.org || null, key, value, opts.category);

      if (opts.json) {
        console.log(JSON.stringify(setting, null, 2));
      } else {
        console.log(`Set: ${setting.key} = ${setting.value}`);
      }
    });

  settingsCmd
    .command("delete")
    .description("Delete a setting")
    .argument("<key>", "Setting key")
    .option("--org <id>", "Organization ID")
    .action((key, opts) => {
      const deleted = deleteSetting(opts.org || null, key);
      if (deleted) {
        console.log(`Deleted setting '${key}'`);
      } else {
        console.error(`Setting '${key}' not found.`);
        process.exit(1);
      }
    });
}
