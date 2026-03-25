import { Command } from "commander";
import {
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
  deleteCustomer,
  searchCustomers,
  mergeCustomers,
} from "../../db/company.js";

export function registerCustomerCommands(program: Command): void {
  const customerCmd = program.command("customer").description("Customer management");

  customerCmd
    .command("create")
    .description("Create a customer")
    .requiredOption("--org <id>", "Organization ID")
    .requiredOption("--name <name>", "Customer name")
    .option("--email <email>", "Email")
    .option("--phone <phone>", "Phone")
    .option("--company <company>", "Company name")
    .option("--source <source>", "Lead source")
    .option("--tags <tags>", "Comma-separated tags")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const customer = createCustomer({
        org_id: opts.org,
        name: opts.name,
        email: opts.email,
        phone: opts.phone,
        company: opts.company,
        source: opts.source,
        tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify(customer, null, 2));
      } else {
        console.log(`Created customer: ${customer.name} (${customer.id})`);
      }
    });

  customerCmd
    .command("list")
    .description("List customers")
    .option("--org <id>", "Filter by organization")
    .option("--search <query>", "Search")
    .option("--limit <n>", "Limit results")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const customers = listCustomers({
        org_id: opts.org,
        search: opts.search,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify(customers, null, 2));
      } else {
        if (customers.length === 0) {
          console.log("No customers found.");
          return;
        }
        for (const c of customers) {
          const email = c.email ? ` <${c.email}>` : "";
          console.log(`  ${c.name}${email}`);
        }
        console.log(`\n${customers.length} customer(s)`);
      }
    });

  customerCmd
    .command("get")
    .description("Get a customer by ID")
    .argument("<id>", "Customer ID")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const customer = getCustomer(id);
      if (!customer) {
        console.error(`Customer '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(customer, null, 2));
      } else {
        console.log(`${customer.name}`);
        if (customer.email) console.log(`  Email: ${customer.email}`);
        if (customer.phone) console.log(`  Phone: ${customer.phone}`);
        if (customer.company) console.log(`  Company: ${customer.company}`);
        if (customer.tags.length) console.log(`  Tags: ${customer.tags.join(", ")}`);
        console.log(`  Lifetime Value: ${customer.lifetime_value}`);
      }
    });

  customerCmd
    .command("update")
    .description("Update a customer")
    .argument("<id>", "Customer ID")
    .option("--name <name>", "Name")
    .option("--email <email>", "Email")
    .option("--phone <phone>", "Phone")
    .option("--company <company>", "Company")
    .option("--source <source>", "Source")
    .option("--tags <tags>", "Comma-separated tags")
    .option("--lifetime-value <value>", "Lifetime value")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const input: Record<string, unknown> = {};
      if (opts.name !== undefined) input.name = opts.name;
      if (opts.email !== undefined) input.email = opts.email;
      if (opts.phone !== undefined) input.phone = opts.phone;
      if (opts.company !== undefined) input.company = opts.company;
      if (opts.source !== undefined) input.source = opts.source;
      if (opts.tags !== undefined) input.tags = opts.tags.split(",").map((t: string) => t.trim());
      if (opts.lifetimeValue !== undefined) input.lifetime_value = parseFloat(opts.lifetimeValue);

      const customer = updateCustomer(id, input);
      if (!customer) {
        console.error(`Customer '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(customer, null, 2));
      } else {
        console.log(`Updated: ${customer.name}`);
      }
    });

  customerCmd
    .command("delete")
    .description("Delete a customer")
    .argument("<id>", "Customer ID")
    .action((id) => {
      const deleted = deleteCustomer(id);
      if (deleted) {
        console.log(`Deleted customer ${id}`);
      } else {
        console.error(`Customer '${id}' not found.`);
        process.exit(1);
      }
    });

  customerCmd
    .command("search")
    .description("Search customers")
    .requiredOption("--org <id>", "Organization ID")
    .argument("<query>", "Search term")
    .option("--json", "Output as JSON", false)
    .action((query, opts) => {
      const results = searchCustomers(opts.org, query);

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          console.log(`No customers matching "${query}".`);
          return;
        }
        for (const c of results) {
          console.log(`  ${c.name} ${c.email ? `<${c.email}>` : ""}`);
        }
      }
    });

  customerCmd
    .command("merge")
    .description("Merge two customers (keep first, merge data from second)")
    .argument("<id1>", "Primary customer ID")
    .argument("<id2>", "Secondary customer ID (will be deleted)")
    .option("--json", "Output as JSON", false)
    .action((id1, id2, opts) => {
      const merged = mergeCustomers(id1, id2);
      if (!merged) {
        console.error("One or both customers not found.");
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(merged, null, 2));
      } else {
        console.log(`Merged into: ${merged.name} (${merged.id})`);
      }
    });
}
