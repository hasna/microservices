#!/usr/bin/env bun

import { Command } from "commander";
import { registerPostCommands } from "./commands/posts.js";
import { registerAccountCommands } from "./commands/accounts.js";
import { registerAnalyticsCommands } from "./commands/analytics.js";
import { registerTemplateCommands } from "./commands/templates.js";
import { registerSchedulerCommands, registerMediaCommands, registerMetricsCommands } from "./commands/scheduler.js";
import { registerMentionCommands } from "./commands/mentions.js";
import { registerAiCommands } from "./commands/ai.js";
import { registerAudienceCommands } from "./commands/audience.js";
import { registerSentimentCommands } from "./commands/sentiment.js";

const program = new Command();

program
  .name("microservice-social")
  .description("Social media management microservice")
  .version("0.0.1");

registerPostCommands(program);
registerAccountCommands(program);
registerAnalyticsCommands(program);
registerTemplateCommands(program);
registerSchedulerCommands(program);
registerMediaCommands(program);
registerMetricsCommands(program);
registerMentionCommands(program);
registerAiCommands(program);
registerAudienceCommands(program);
registerSentimentCommands(program);

// --- Serve ---

program
  .command("serve")
  .description("Start REST API server with web dashboard")
  .option("--port <port>", "Port to listen on", "19650")
  .action(async (opts) => {
    process.env["PORT"] = opts.port;
    await import("../server/index.js");
  });

program.parse(process.argv);
