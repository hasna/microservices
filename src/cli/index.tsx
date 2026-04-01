#!/usr/bin/env bun

/**
 * @hasna/microservices hub CLI
 * Manages all @hasna/microservice-* packages.
 */

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import {
  getMicroserviceStatus,
  installMicroservices,
  microserviceExists,
  removeMicroservice,
} from "../lib/installer.js";
import { getPackageVersion } from "../lib/package-info.js";
import {
  getMicroservice,
  MICROSERVICES,
  searchMicroservices,
} from "../lib/registry.js";
import { runMicroserviceCommand } from "../lib/runner.js";

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
      const status = installed
        ? chalk.green("✓ installed")
        : chalk.gray("  available");
      console.log(
        `  ${status}  ${chalk.cyan(m.binary.padEnd(22))}  ${m.description.slice(0, 60)}`,
      );
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

    console.log(
      chalk.bold(`\nInstalling ${targets.length} microservice(s)...\n`),
    );
    const results = installMicroservices(targets, { force: opts.force });

    for (const r of results) {
      if (r.success) {
        console.log(
          `  ${chalk.green("✓")} ${r.microservice}${r.version ? ` (${r.version})` : ""}`,
        );
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
    else
      console.log(chalk.red(`✗ Failed to remove ${name} — is it installed?`));
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
      console.log(
        `  ${icon} ${n.padEnd(20)} ${ver.padEnd(12)} ${env ? chalk.gray(`needs: ${env}`) : ""}`,
      );
    }
    console.log();
  });

// Run a command on an installed microservice
program
  .command("run <name> [args...]")
  .description("Run a command on an installed microservice")
  .action(async (name: string, args: string[]) => {
    const result = await runMicroserviceCommand(name, args);
    if (result.stdout) process.stdout.write(`${result.stdout}\n`);
    if (result.stderr) process.stderr.write(`${result.stderr}\n`);
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
  .description("Run database migrations for all installed microservices")
  .option("--db <url>", "PostgreSQL connection URL (overrides DATABASE_URL)")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const installed = MICROSERVICES.filter((m) => microserviceExists(m.name));
    if (installed.length === 0) {
      console.log(chalk.yellow("No microservices installed to migrate."));
      return;
    }

    console.log(
      chalk.bold(
        `\nMigrating ${installed.length} installed microservices...\n`,
      ),
    );
    let hasErrors = false;
    for (const m of installed) {
      console.log(chalk.blue(`Migrating ${m.name}...`));
      const result = await runMicroserviceCommand(m.name, ["migrate"]);
      if (result.success) {
        console.log(
          `  ${chalk.green("✓")} ${result.stdout.trim() || "Success"}`,
        );
      } else {
        console.log(
          `  ${chalk.red("✗")} ${result.stderr.trim() || result.stdout.trim() || "Failed"}`,
        );
        hasErrors = true;
      }
    }
    console.log();
    if (hasErrors) {
      console.error(
        chalk.red("Some migrations failed. Please check the logs above."),
      );
      process.exit(1);
    } else {
      console.log(chalk.green("✓ All migrations completed successfully."));
    }
  });

// Serve all installed microservices concurrently
program
  .command("serve-all")
  .description(
    "Start HTTP servers for all installed microservices concurrently",
  )
  .option("--db <url>", "PostgreSQL connection URL (overrides DATABASE_URL)")
  .action(async (opts) => {
    if (opts.db) process.env.DATABASE_URL = opts.db;
    const installed = MICROSERVICES.filter((m) => microserviceExists(m.name));
    if (installed.length === 0) {
      console.log(chalk.yellow("No microservices installed to serve."));
      return;
    }

    console.log(
      chalk.bold(`\nStarting ${installed.length} installed microservices...\n`),
    );

    const { spawn } = await import("node:child_process");
    const procs: ReturnType<typeof spawn>[] = [];

    // Colors for prefixing logs
    const colors = [
      chalk.cyan,
      chalk.magenta,
      chalk.green,
      chalk.yellow,
      chalk.blue,
    ];

    for (let i = 0; i < installed.length; i++) {
      const m = installed[i];
      const color = colors[i % colors.length];
      const prefix = color(`[${m.name.padEnd(10)}] `);

      const proc = spawn(m.binary, ["serve"], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stdout.on("data", (data: Buffer) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines) if (line) console.log(`${prefix}${line}`);
      });

      proc.stderr.on("data", (data: Buffer) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines)
          if (line) console.error(`${prefix}${chalk.red(line)}`);
      });

      proc.on("error", (err) => {
        console.error(
          `${prefix}${chalk.red("Failed to start:")} ${err.message}`,
        );
      });

      procs.push(proc);
    }

    process.on("SIGINT", () => {
      console.log(chalk.yellow("\nStopping all microservices..."));
      for (const p of procs) p.kill("SIGINT");
      process.exit(0);
    });
  });

// Init all installed microservices
program
  .command("init-all")
  .description("Run init (migrations) for all installed microservices")
  .option("--db <url>", "PostgreSQL connection URL")
  .action(async (opts) => {
    const installed = MICROSERVICES.filter((m) => microserviceExists(m.name));
    if (installed.length === 0) {
      console.log(chalk.yellow("No microservices installed to init."));
      return;
    }
    if (!opts.db) {
      console.error(chalk.red("--db <url> is required. Example: microservices init-all --db postgres://localhost/myapp"));
      process.exit(1);
    }
    process.env.DATABASE_URL = opts.db;

    console.log(
      chalk.bold(
        `\nInitializing ${installed.length} installed microservices...\n`,
      ),
    );
    let hasErrors = false;
    for (const m of installed) {
      console.log(chalk.blue(`Initializing ${m.name}...`));
      const result = await runMicroserviceCommand(m.name, [
        "init",
        "--db",
        opts.db,
      ]);
      if (result.success) {
        console.log(
          `  ${chalk.green("✓")} ${result.stdout.trim().split("\n").join("\n  ") || "Success"}`,
        );
      } else {
        console.log(
          `  ${chalk.red("✗")} ${result.stderr.trim() || result.stdout.trim() || "Failed"}`,
        );
        hasErrors = true;
      }
    }
    console.log();
    if (hasErrors) {
      console.error(
        chalk.red("Some inits failed. Please check the logs above."),
      );
      process.exit(1);
    } else {
      console.log(chalk.green("✓ All services initialized successfully."));
      console.log(
        chalk.gray(
          "  You can now run 'microservices serve-all' to start them.",
        ),
      );
    }
  });

// Info about a microservice
program
  .command("info <name>")
  .description("Show detailed info about a microservice")
  .action((name: string) => {
    const m = getMicroservice(name);
    if (!m) {
      console.error(chalk.red(`Unknown microservice: ${name}`));
      process.exit(1);
    }
    const installed = microserviceExists(name);
    console.log(chalk.bold(`\n${m.displayName}`));
    console.log(`  Package:     ${chalk.cyan(m.package)}`);
    console.log(`  Binary:      ${m.binary}`);
    console.log(`  Schema:      ${m.schemaPrefix}.*`);
    console.log(`  Category:    ${m.category}`);
    console.log(
      `  Status:      ${installed ? chalk.green("installed") : chalk.gray("not installed")}`,
    );
    console.log(`  Description: ${m.description}`);
    console.log(`  Required env: ${m.requiredEnv.join(", ")}`);
    if (m.optionalEnv?.length)
      console.log(`  Optional env: ${m.optionalEnv.join(", ")}`);
    console.log(`  Tags:        ${m.tags.join(", ")}`);
    console.log();
  });

// Check environment variables for all installed microservices
program
  .command("check-env")
  .description("Verify environment variables for all installed microservices")
  .action(() => {
    const installed = MICROSERVICES.filter((m) => microserviceExists(m.name));
    if (installed.length === 0) {
      console.log(chalk.yellow("No microservices installed to check."));
      return;
    }

    console.log(
      chalk.bold(
        `\nChecking environment for ${installed.length} microservices...\n`,
      ),
    );

    let totalMissing = 0;
    for (const m of installed) {
      const missingRequired = m.requiredEnv.filter((env) => !process.env[env]);
      const missingOptional = (m.optionalEnv ?? []).filter(
        (env) => !process.env[env],
      );

      const status =
        missingRequired.length > 0
          ? chalk.red("✗ Critical Missing")
          : missingOptional.length > 0
            ? chalk.yellow("⚠ Warning")
            : chalk.green("✓ OK");

      console.log(`${chalk.bold(m.name.padEnd(12))} [${status}]`);

      if (missingRequired.length > 0) {
        console.log(
          chalk.red(`  Required missing: ${missingRequired.join(", ")}`),
        );
        totalMissing += missingRequired.length;
      }
      if (missingOptional.length > 0) {
        console.log(
          chalk.gray(`  Optional missing: ${missingOptional.join(", ")}`),
        );
      }
      if (missingRequired.length === 0 && missingOptional.length === 0) {
        console.log(chalk.gray("  All variables set."));
      }
      console.log();
    }

    if (totalMissing > 0) {
      console.log(
        chalk.red(
          `Found ${totalMissing} missing required environment variables.`,
        ),
      );
      console.log(chalk.gray("Refer to .env.example for guidance.\n"));
      process.exit(1);
    } else {
      console.log(
        chalk.green(
          "✓ All required environment variables are set across all installed services.\n",
        ),
      );
    }
  });

// Scaffold a new microservice from the template
program
  .command("scaffold <name>")
  .description("Scaffold a new microservice from the _template directory")
  .action((name: string) => {
    // Validate name format
    if (!/^[a-z0-9-]+$/.test(name)) {
      console.error(
        chalk.red(
          "Error: Name can only contain lowercase letters, numbers, and dashes.",
        ),
      );
      process.exit(1);
    }

    const cwd = process.cwd();
    const templateDir = path.join(cwd, "microservices", "_template");
    const targetDir = path.join(cwd, "microservices", `microservice-${name}`);

    if (!fs.existsSync(templateDir)) {
      console.error(
        chalk.red(
          `Template directory not found at ${templateDir}. Make sure you are running this from the monorepo root.`,
        ),
      );
      process.exit(1);
    }

    if (fs.existsSync(targetDir)) {
      console.error(
        chalk.red(`Target directory already exists at ${targetDir}`),
      );
      process.exit(1);
    }

    console.log(chalk.bold(`\nScaffolding microservice-${name}...\n`));

    // Recursive copy
    fs.cpSync(templateDir, targetDir, { recursive: true });

    // String replace unambiguous placeholders in all files
    const replaceInFile = (filePath: string) => {
      const content = fs.readFileSync(filePath, "utf-8");
      let updated = content.replace(
        /__NAME__/g,
        name.toUpperCase().replace(/-/g, "_"),
      );
      updated = updated.replace(
        /__Name__/g,
        name.charAt(0).toUpperCase() + name.slice(1),
      );
      updated = updated.replace(/__name__/g, name);
      fs.writeFileSync(filePath, updated, "utf-8");
    };

    const walkAndReplace = (dir: string) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
          walkAndReplace(filePath);
        } else {
          replaceInFile(filePath);
        }
      }
    };

    walkAndReplace(targetDir);

    console.log(
      `  ${chalk.green("✓")} Created microservices/microservice-${name}`,
    );
    console.log(
      chalk.gray(`\n  Next steps:
  1. Add entry to src/lib/registry.ts
  2. Implement schema, core logic, HTTP API, MCP, and CLI
  3. Run 'bun install' to link the workspace
  4. Run 'bun run build'
    `),
    );
  });

program.parse();
