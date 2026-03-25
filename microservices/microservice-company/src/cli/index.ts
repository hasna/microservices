#!/usr/bin/env bun

import { Command } from "commander";
import { registerOrgCommands } from "./commands/org.js";
import { registerTeamCommands } from "./commands/team.js";
import { registerMemberCommands } from "./commands/member.js";
import { registerCustomerCommands } from "./commands/customer.js";
import { registerVendorCommands } from "./commands/vendor.js";
import { registerAuditCommands } from "./commands/audit.js";
import { registerSettingsCommands } from "./commands/settings.js";
import { registerFinanceCommands } from "./commands/finance.js";

const program = new Command();

program
  .name("microservice-company")
  .description("AI agent control plane for autonomous company operations")
  .version("0.0.1");

registerOrgCommands(program);
registerTeamCommands(program);
registerMemberCommands(program);
registerCustomerCommands(program);
registerVendorCommands(program);
registerAuditCommands(program);
registerSettingsCommands(program);
registerFinanceCommands(program);

program.parse(process.argv);
