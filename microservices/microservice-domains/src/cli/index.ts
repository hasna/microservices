#!/usr/bin/env bun

import { Command } from "commander";
import { registerDomainCommands } from "./commands/domains.js";
import { registerDnsCommands } from "./commands/dns.js";
import { registerAlertCommands } from "./commands/alerts.js";
import { registerProviderCommands } from "./commands/providers.js";
import { registerBrandsightCommands } from "./commands/brandsight.js";

const program = new Command();

program
  .name("microservice-domains")
  .description("Domain portfolio and DNS management microservice")
  .version("0.0.1");

registerDomainCommands(program);
registerDnsCommands(program);
registerAlertCommands(program);
registerProviderCommands(program);
registerBrandsightCommands(program);

program.parse(process.argv);
