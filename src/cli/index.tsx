#!/usr/bin/env bun
/**
 * @hasna/microservices hub CLI
 * Manages all @hasna/microservice-* packages.
 */

import { Command } from "commander";
import chalk from "chalk";
import { MICROSERVICES, getMicroservice, searchMicroservices } from "../lib/registry.js";
import {
  installMicroservice,
  installMicroservices,
  getInstalledMicroservices,
  removeMicroservice,
  getMicroserviceStatus,
  microserviceExists,
} from "../lib/installer.js";
import { runMicroserviceCommand } from "../lib/runner.js";
import { getPackageVersion } from "../lib/package-info.js";

const program = new Command();

program
  .name("microservices")
  .description("Production-grade microservice building blocks for SaaS apps")
  .version(getPackageVersion());

// List all microservices
program
  .command("list")
  .description("List all available microservices")
  .option("--installed", "Show only installed microservices")
  .action((opts) => {
    const services = opts.installed
      ? MICROSERVICES.filter((m) => microserviceExists(m.name))
      : MICROSERVICES;

    console.log(chalk.bold("\nAvailable microservices:\n"));
    for (const m of services) {
      const installed = microserviceExists(m.name);
      const status = installed ? chalk.green("✓ installed") : chalk.gray("  available");
      console.log(`  ${status}  ${chalk.cyan(m.binary.padEnd(22))}  ${m.description.slice(0, 60)}`);
    }
    console.log();
  });

// Install one or more microservices
program
  .command("install [names...]")
  .description("Install microservices globally via bun")
  .option("--all", "Install all microservices")
  .option("--force", "Reinstall even if already installed")
  .action(async (names: string[], opts) => {
    const targets = opts.all
      ? MICROSERVICES.map((m) => m.name)
      : names.length > 0
      ? names
      : [];

    if (targets.length === 0) {
      console.error(chalk.red("Specify microservice names or use --all"));
      process.exit(1);
    }

    console.log(chalk.bold(`\nInstalling ${targets.length} microservice(s)...\n`));
    const results = installMicroservices(targets, { force: opts.force });

    for (const r of results) {
      if (r.success) {
        console.log(`  ${chalk.green("✓")} ${r.microservice}${r.version ? ` (${r.version})` : ""}`);
      } else {
        console.log(`  ${chalk.red("✗")} ${r.microservice}: ${r.error}`);
      }
    }
    console.log();
  });

// Remove a microservice
program
  .command("remove <name>")
  .description("Remove an installed microservice")
  .action((name: string) => {
    const ok = removeMicroservice(name);
    if (ok) console.log(chalk.green(`✓ Removed ${name}`));
    else console.log(chalk.red(`✗ Failed to remove ${name} — is it installed?`));
  });

// Status of all or one microservice
program
  .command("status [name]")
  .description("Show installation status")
  .action((name?: string) => {
    const targets = name ? [name] : MICROSERVICES.map((m) => m.name);
    console.log(chalk.bold("\nMicroservice status:\n"));
    for (const n of targets) {
      const s = getMicroserviceStatus(n);
      const icon = s.installed ? chalk.green("✓") : chalk.gray("✗");
      const ver = s.version ? chalk.gray(`v${s.version}`) : "";
      const env = s.meta?.requiredEnv.join(", ") ?? "";
      console.log(`  ${icon} ${n.padEnd(20)} ${ver.padEnd(12)} ${env ? chalk.gray(`needs: ${env}`) : ""}`);
    }
    console.log();
  });

// Run a command on an installed microservice
program
  .command("run <name> [args...]")
  .description("Run a command on an installed microservice")
  .action(async (name: string, args: string[]) => {
    const result = await runMicroserviceCommand(name, args);
    if (result.stdout) process.stdout.write(result.stdout + "\n");
    if (result.stderr) process.stderr.write(result.stderr + "\n");
    process.exit(result.exitCode);
  });

// Search microservices
program
  .command("search <query>")
  .description("Search microservices by name or keyword")
  .action((query: string) => {
    const results = searchMicroservices(query);
    if (results.length === 0) {
      console.log(chalk.gray(`No microservices matching "${query}"`));
      return;
    }
    for (const m of results) {
      console.log(`  ${chalk.cyan(m.name.padEnd(20))}  ${m.description}`);
    }
  });

// Migrate all installed microservices
program
  .command("migrate-all")
  .description("Run migrations on all installed microservices")
  .option("--db <url>", "PostgreSQL connection URL (overrides DATABASE_URL)")
  .action(async (opts) => {
    if (opts.db) process.env["DATABASE_URL"] = opts.db;
    const installed = getInstalledMicroservices();
    if (installed.length === 0) {
      console.log(chalk.yellow("No microservices installed."));
      return;
    }
    console.log(chalk.bold(`\nMigrating ${installed.length} microservice(s)...\n`));
    for (const name of installed) {
      const result = await runMicroserviceCommand(name, ["migrate"]);
      if (result.success) console.log(`  ${chalk.green("✓")} ${name}`);
      else console.log(`  ${chalk.red("✗")} ${name}: ${result.stderr || result.stdout}`);
    }
    console.log();
  });

// Info about a microservice
program
  .command("info <name>")
  .description("Show detailed info about a microservice")
  .action((name: string) => {
    const m = getMicroservice(name);
    if (!m) { console.error(chalk.red(`Unknown microservice: ${name}`)); process.exit(1); }
    const installed = microserviceExists(name);
    console.log(chalk.bold(`\n${m.displayName}`));
    console.log(`  Package:     ${chalk.cyan(m.package)}`);
    console.log(`  Binary:      ${m.binary}`);
    console.log(`  Schema:      ${m.schemaPrefix}.*`);
    console.log(`  Category:    ${m.category}`);
    console.log(`  Status:      ${installed ? chalk.green("installed") : chalk.gray("not installed")}`);
    console.log(`  Description: ${m.description}`);
    console.log(`  Required env: ${m.requiredEnv.join(", ")}`);
    if (m.optionalEnv?.length) console.log(`  Optional env: ${m.optionalEnv.join(", ")}`);
    console.log(`  Tags:        ${m.tags.join(", ")}`);
    console.log();
  });

program.parse();
