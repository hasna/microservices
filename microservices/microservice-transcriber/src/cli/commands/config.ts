import type { Command } from "commander";
import { getConfig, setConfig, resetConfig, CONFIG_DEFAULTS, CONFIG_KEYS, type ConfigKey } from "../../lib/config.js";

export function registerConfigCommands(program: Command): void {
  // ---------------------------------------------------------------------------
  // config
  // ---------------------------------------------------------------------------

  const configCmd = program
    .command("config")
    .description("View or change persistent configuration defaults");

  configCmd
    .command("view")
    .description("Show current config")
    .option("--json", "Output as JSON")
    .action((opts) => {
      const cfg = getConfig();
      if (opts.json) {
        console.log(JSON.stringify(cfg, null, 2));
        return;
      }
      console.log(`defaultProvider  ${cfg.defaultProvider}`);
      console.log(`defaultLanguage  ${cfg.defaultLanguage}`);
      console.log(`defaultFormat    ${cfg.defaultFormat}`);
      console.log(`diarize          ${cfg.diarize}`);
      console.log(`vocab            ${cfg.vocab?.length ? cfg.vocab.join(", ") : "(none)"}`);
    });

  configCmd
    .command("set <key> <value>")
    .description(`Set a config value. Keys: ${CONFIG_KEYS.join(", ")}`)
    .action((key: string, value: string) => {
      if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
        console.error(`Unknown config key: '${key}'. Valid keys: ${CONFIG_KEYS.join(", ")}`);
        process.exit(1);
      }

      const k = key as ConfigKey;
      let parsed: unknown = value;
      if (k === "diarize") parsed = value === "true";
      if (k === "vocab") parsed = value.split(",").map((v: string) => v.trim()).filter(Boolean);

      const updated = setConfig({ [k]: parsed } as Partial<typeof CONFIG_DEFAULTS>);
      console.log(`Set ${key} = ${updated[k]}`);
    });

  configCmd
    .command("reset")
    .description("Reset all config to defaults")
    .action(() => {
      resetConfig();
      console.log("Config reset to defaults.");
    });
}
