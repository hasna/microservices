import { Command } from "commander";
import { createOrg, getOrg, updateOrg } from "../../db/company.js";

export function registerOrgCommands(program: Command): void {
  const orgCmd = program.command("org").description("Organization management");

  orgCmd
    .command("create")
    .description("Create an organization")
    .requiredOption("--name <name>", "Organization name")
    .option("--legal-name <name>", "Legal name")
    .option("--tax-id <id>", "Tax ID")
    .option("--phone <phone>", "Phone")
    .option("--email <email>", "Email")
    .option("--website <url>", "Website")
    .option("--industry <industry>", "Industry")
    .option("--currency <code>", "Currency code", "USD")
    .option("--timezone <tz>", "Timezone", "UTC")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const org = createOrg({
        name: opts.name,
        legal_name: opts.legalName,
        tax_id: opts.taxId,
        phone: opts.phone,
        email: opts.email,
        website: opts.website,
        industry: opts.industry,
        currency: opts.currency,
        timezone: opts.timezone,
      });

      if (opts.json) {
        console.log(JSON.stringify(org, null, 2));
      } else {
        console.log(`Created organization: ${org.name} (${org.id})`);
      }
    });

  orgCmd
    .command("get")
    .description("Get an organization by ID")
    .argument("<id>", "Organization ID")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const org = getOrg(id);
      if (!org) {
        console.error(`Organization '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(org, null, 2));
      } else {
        console.log(`${org.name}`);
        if (org.legal_name) console.log(`  Legal: ${org.legal_name}`);
        if (org.email) console.log(`  Email: ${org.email}`);
        if (org.phone) console.log(`  Phone: ${org.phone}`);
        if (org.website) console.log(`  Website: ${org.website}`);
        if (org.industry) console.log(`  Industry: ${org.industry}`);
        console.log(`  Currency: ${org.currency}`);
        console.log(`  Timezone: ${org.timezone}`);
      }
    });

  orgCmd
    .command("update")
    .description("Update an organization")
    .argument("<id>", "Organization ID")
    .option("--name <name>", "Name")
    .option("--legal-name <name>", "Legal name")
    .option("--tax-id <id>", "Tax ID")
    .option("--phone <phone>", "Phone")
    .option("--email <email>", "Email")
    .option("--website <url>", "Website")
    .option("--industry <industry>", "Industry")
    .option("--currency <code>", "Currency")
    .option("--timezone <tz>", "Timezone")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const input: Record<string, unknown> = {};
      if (opts.name !== undefined) input.name = opts.name;
      if (opts.legalName !== undefined) input.legal_name = opts.legalName;
      if (opts.taxId !== undefined) input.tax_id = opts.taxId;
      if (opts.phone !== undefined) input.phone = opts.phone;
      if (opts.email !== undefined) input.email = opts.email;
      if (opts.website !== undefined) input.website = opts.website;
      if (opts.industry !== undefined) input.industry = opts.industry;
      if (opts.currency !== undefined) input.currency = opts.currency;
      if (opts.timezone !== undefined) input.timezone = opts.timezone;

      const org = updateOrg(id, input);
      if (!org) {
        console.error(`Organization '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(org, null, 2));
      } else {
        console.log(`Updated: ${org.name}`);
      }
    });
}
