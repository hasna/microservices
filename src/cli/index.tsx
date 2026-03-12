#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { Command } from "commander";
import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { App } from "./components/App.js";
import {
  MICROSERVICES,
  CATEGORIES,
  getMicroservice,
  getMicroservicesByCategory,
  searchMicroservices,
} from "../lib/registry.js";
import {
  installMicroservice,
  installMicroservices,
  getInstalledMicroservices,
  removeMicroservice,
  getMicroserviceStatus,
} from "../lib/installer.js";
import {
  runMicroserviceCommand,
  getMicroserviceOperations,
  getMicroserviceCliPath,
} from "../lib/runner.js";

const isTTY = process.stdout.isTTY ?? false;

const program = new Command();

program
  .name("microservices")
  .description("Mini business apps for AI agents — invoices, contacts, bookkeeping and more")
  .version("0.0.1")
  .enablePositionalOptions();

// Interactive mode (default)
program
  .command("interactive", { isDefault: true })
  .alias("i")
  .description("Interactive microservice browser")
  .action(() => {
    if (!isTTY) {
      console.log("Non-interactive environment detected. Use a subcommand:\n");
      console.log("  microservices list              List all available microservices");
      console.log("  microservices search <query>     Search microservices");
      console.log("  microservices install <names...> Install microservices");
      console.log("  microservices remove <name>      Remove a microservice");
      console.log("  microservices info <name>        Show microservice details");
      console.log("  microservices status             Show installed status");
      console.log("  microservices categories         List categories");
      console.log("  microservices run <name> [args]  Run a microservice command");
      console.log("\nRun 'microservices --help' for full usage.");
      process.exit(0);
    }
    render(<App />);
  });

// Install command
program
  .command("install")
  .alias("add")
  .argument("[services...]", "Microservices to install")
  .option("-o, --overwrite", "Overwrite existing installations", false)
  .option("-c, --category <category>", "Install all microservices in a category")
  .option("--json", "Output results as JSON", false)
  .description("Install one or more microservices")
  .action((services: string[], options) => {
    let toInstall = [...services];

    if (options.category) {
      const matched = CATEGORIES.find(
        (c) => c.toLowerCase() === options.category.toLowerCase()
      );
      if (!matched) {
        console.error(
          chalk.red(`Unknown category: "${options.category}". Available: ${CATEGORIES.join(", ")}`)
        );
        process.exit(1);
      }
      const categoryServices = getMicroservicesByCategory(matched);
      toInstall.push(...categoryServices.map((m) => m.name));
    }

    if (toInstall.length === 0) {
      console.error(chalk.red("No microservices specified. Use: microservices install <names...>"));
      process.exit(1);
    }

    // Deduplicate
    toInstall = [...new Set(toInstall)];

    const results = installMicroservices(toInstall, {
      overwrite: options.overwrite,
    });

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    for (const r of results) {
      if (r.success) {
        console.log(chalk.green(`  + ${r.microservice}`) + chalk.gray(` -> ${r.path}`));
      } else {
        console.log(chalk.red(`  x ${r.microservice}`) + chalk.gray(` ${r.error}`));
      }
    }

    const successCount = results.filter((r) => r.success).length;
    if (successCount > 0) {
      console.log(chalk.green(`\nInstalled ${successCount} microservice(s).`));
    }
  });

// Remove command
program
  .command("remove")
  .alias("rm")
  .argument("<name>", "Microservice to remove")
  .option("--delete-data", "Also delete the database file", false)
  .description("Remove an installed microservice")
  .action((name: string, options) => {
    const removed = removeMicroservice(name, { deleteData: options.deleteData });
    if (removed) {
      console.log(
        chalk.green(`Removed ${name}.`) +
          (options.deleteData
            ? chalk.yellow(" Database deleted.")
            : chalk.gray(" Database preserved."))
      );
    } else {
      console.log(chalk.red(`Microservice '${name}' not found.`));
    }
  });

// List command
program
  .command("list")
  .alias("ls")
  .option("-c, --category <category>", "Filter by category")
  .option("--installed", "Show only installed", false)
  .option("--json", "Output as JSON", false)
  .description("List available microservices")
  .action((options) => {
    let services = MICROSERVICES;

    if (options.category) {
      const matched = CATEGORIES.find(
        (c) => c.toLowerCase() === options.category.toLowerCase()
      );
      if (!matched) {
        console.error(
          chalk.red(`Unknown category. Available: ${CATEGORIES.join(", ")}`)
        );
        process.exit(1);
      }
      services = getMicroservicesByCategory(matched);
    }

    if (options.installed) {
      const installed = getInstalledMicroservices();
      services = services.filter((m) => installed.includes(m.name));
    }

    if (options.json) {
      console.log(JSON.stringify(services, null, 2));
      return;
    }

    const installed = getInstalledMicroservices();

    // Group by category
    const grouped = new Map<string, typeof services>();
    for (const m of services) {
      const cat = m.category;
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(m);
    }

    for (const [category, items] of grouped) {
      console.log(chalk.bold.blue(`\n  ${category}`));
      for (const m of items) {
        const status = installed.includes(m.name) ? chalk.green(" [installed]") : "";
        console.log(
          `    ${chalk.white(m.name.padEnd(20))} ${chalk.gray(m.description)}${status}`
        );
      }
    }
    console.log();
  });

// Search command
program
  .command("search")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .description("Search microservices")
  .action((query: string, options) => {
    const results = searchMicroservices(query);

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log(chalk.yellow(`No microservices matching "${query}".`));
      return;
    }

    for (const m of results) {
      console.log(
        `  ${chalk.white(m.name.padEnd(20))} ${chalk.blue(m.category.padEnd(15))} ${chalk.gray(m.description)}`
      );
    }
  });

// Info command
program
  .command("info")
  .argument("<name>", "Microservice name")
  .option("--json", "Output as JSON", false)
  .description("Show microservice details")
  .action((name: string, options) => {
    const meta = getMicroservice(name);
    if (!meta) {
      console.error(chalk.red(`Microservice '${name}' not found.`));
      process.exit(1);
    }

    const status = getMicroserviceStatus(name);

    if (options.json) {
      console.log(JSON.stringify({ ...meta, ...status }, null, 2));
      return;
    }

    console.log(chalk.bold(`\n  ${meta.displayName}`));
    console.log(chalk.gray(`  ${meta.description}\n`));
    console.log(`  Category:  ${chalk.blue(meta.category)}`);
    console.log(`  Tags:      ${meta.tags.map((t) => chalk.cyan(t)).join(", ")}`);
    console.log(`  Installed: ${status.installed ? chalk.green("yes") : chalk.gray("no")}`);
    if (status.hasDatabase) {
      const sizeKb = (status.dbSizeBytes / 1024).toFixed(1);
      console.log(`  Database:  ${chalk.green(`${sizeKb} KB`)}`);
    }
    console.log(`  Data dir:  ${chalk.gray(status.dataDir)}`);
    console.log();
  });

// Status command
program
  .command("status")
  .description("Show status of all installed microservices")
  .option("--json", "Output as JSON", false)
  .action((options) => {
    const installed = getInstalledMicroservices();

    if (installed.length === 0) {
      console.log(chalk.yellow("No microservices installed."));
      return;
    }

    const statuses = installed.map((name) => getMicroserviceStatus(name));

    if (options.json) {
      console.log(JSON.stringify(statuses, null, 2));
      return;
    }

    console.log(chalk.bold("\n  Installed Microservices\n"));
    for (const s of statuses) {
      const sizeKb = s.hasDatabase ? `${(s.dbSizeBytes / 1024).toFixed(1)} KB` : "no db";
      const dbIcon = s.hasDatabase ? chalk.green("●") : chalk.gray("○");
      console.log(`  ${dbIcon} ${chalk.white(s.name.padEnd(20))} ${chalk.gray(sizeKb)}`);
    }
    console.log();
  });

// Categories command
program
  .command("categories")
  .description("List microservice categories")
  .option("--json", "Output as JSON", false)
  .action((options) => {
    const categoryCounts = CATEGORIES.map((cat) => ({
      category: cat,
      count: getMicroservicesByCategory(cat).length,
    }));

    if (options.json) {
      console.log(JSON.stringify(categoryCounts, null, 2));
      return;
    }

    console.log(chalk.bold("\n  Categories\n"));
    for (const { category, count } of categoryCounts) {
      console.log(`  ${chalk.blue(category.padEnd(20))} ${chalk.gray(`${count} microservices`)}`);
    }
    console.log(`\n  ${chalk.bold("Total:")} ${MICROSERVICES.length} microservices\n`);
  });

// Run command
program
  .command("run")
  .argument("<name>", "Microservice name")
  .argument("[args...]", "Command arguments")
  .option("-t, --timeout <ms>", "Timeout in milliseconds", "30000")
  .allowUnknownOption(true)
  .passThroughOptions(true)
  .description("Run a command on an installed microservice")
  .action(async (name: string, args: string[], options) => {
    const meta = getMicroservice(name);
    if (!meta) {
      console.error(chalk.red(`Microservice '${name}' not found.`));
      process.exit(1);
    }

    if (!getMicroserviceCliPath(name)) {
      console.error(chalk.red(`Microservice '${name}' is not installed or has no CLI.`));
      process.exit(1);
    }

    const result = await runMicroserviceCommand(name, args, parseInt(options.timeout));

    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);

    process.exit(result.exitCode);
  });

// Operations command
program
  .command("ops")
  .argument("<name>", "Microservice name")
  .description("List available operations for a microservice")
  .action(async (name: string) => {
    const meta = getMicroservice(name);
    if (!meta) {
      console.error(chalk.red(`Microservice '${name}' not found.`));
      process.exit(1);
    }

    if (!getMicroserviceCliPath(name)) {
      console.error(chalk.red(`Microservice '${name}' is not installed.`));
      process.exit(1);
    }

    const ops = await getMicroserviceOperations(name);
    console.log(ops.helpText);
  });

// MCP setup command
program
  .command("mcp")
  .description("Register MCP server with AI coding agents")
  .option("--register <target>", "Register with: claude, codex, gemini, or all", "all")
  .action((options) => {
    const target = options.register;
    const mcpBin = "microservices-mcp";
    const mcpBinFull = join(homedir(), ".bun", "bin", "microservices-mcp");
    let registered = 0;

    // Claude Code (~/.claude.json)
    if (target === "all" || target === "claude") {
      const claudePath = join(homedir(), ".claude.json");
      try {
        const config = existsSync(claudePath)
          ? JSON.parse(readFileSync(claudePath, "utf-8"))
          : {};
        if (!config.mcpServers) config.mcpServers = {};
        config.mcpServers.microservices = {
          type: "stdio",
          command: mcpBin,
          args: [],
          env: {},
        };
        writeFileSync(claudePath, JSON.stringify(config, null, 2));
        console.log(chalk.green("  + Claude Code") + chalk.gray(` (${claudePath})`));
        registered++;
      } catch (e) {
        console.log(chalk.red(`  x Claude Code: ${e instanceof Error ? e.message : e}`));
      }
    }

    // Codex CLI (~/.codex/config.toml)
    if (target === "all" || target === "codex") {
      const codexPath = join(homedir(), ".codex", "config.toml");
      try {
        let content = existsSync(codexPath) ? readFileSync(codexPath, "utf-8") : "";
        if (content.includes("[mcp_servers.microservices]")) {
          console.log(chalk.yellow("  ~ Codex CLI (already registered)"));
        } else {
          content += `\n[mcp_servers.microservices]\ncommand = "${mcpBin}"\n`;
          writeFileSync(codexPath, content);
          console.log(chalk.green("  + Codex CLI") + chalk.gray(` (${codexPath})`));
        }
        registered++;
      } catch (e) {
        console.log(chalk.red(`  x Codex CLI: ${e instanceof Error ? e.message : e}`));
      }
    }

    // Gemini CLI (~/.gemini/settings.json)
    if (target === "all" || target === "gemini") {
      const geminiPath = join(homedir(), ".gemini", "settings.json");
      try {
        const config = existsSync(geminiPath)
          ? JSON.parse(readFileSync(geminiPath, "utf-8"))
          : {};
        if (!config.mcpServers) config.mcpServers = {};
        config.mcpServers.microservices = {
          command: mcpBinFull,
          args: [],
        };
        writeFileSync(geminiPath, JSON.stringify(config, null, 2));
        console.log(chalk.green("  + Gemini CLI") + chalk.gray(` (${geminiPath})`));
        registered++;
      } catch (e) {
        console.log(chalk.red(`  x Gemini CLI: ${e instanceof Error ? e.message : e}`));
      }
    }

    if (registered > 0) {
      console.log(chalk.green(`\nMCP server registered. Restart your agent to activate.`));
    }
  });

program.parse(process.argv);
