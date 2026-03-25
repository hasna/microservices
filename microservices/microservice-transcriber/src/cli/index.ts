#!/usr/bin/env bun

import { Command } from "commander";
import { registerTranscribeCommands } from "./commands/transcribe.js";
import { registerMediaCommands } from "./commands/media.js";
import { registerManageCommands } from "./commands/manage.js";
import { registerExportCommands } from "./commands/export.js";
import { registerAiCommands } from "./commands/ai.js";
import { registerAnnotateCommands } from "./commands/annotate.js";
import { registerFeedCommands } from "./commands/feed.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerProofreadCommands } from "./commands/proofread.js";

const program = new Command();

program
  .name("microservice-transcriber")
  .description("Transcribe audio and video from files and URLs using ElevenLabs or OpenAI")
  .version("0.0.1");

registerTranscribeCommands(program);
registerMediaCommands(program);
registerManageCommands(program);
registerExportCommands(program);
registerAiCommands(program);
registerAnnotateCommands(program);
registerFeedCommands(program);
registerConfigCommands(program);
registerProofreadCommands(program);

program.parse();
