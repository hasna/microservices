import { Command } from "commander";
import {
  createVendor,
  getVendor,
  listVendors,
  updateVendor,
  deleteVendor,
  searchVendors,
} from "../../db/company.js";

export function registerVendorCommands(program: Command): void {
  const vendorCmd = program.command("vendor").description("Vendor management");

  vendorCmd
    .command("add")
    .description("Add a vendor")
    .requiredOption("--org <id>", "Organization ID")
    .requiredOption("--name <name>", "Vendor name")
    .option("--email <email>", "Email")
    .option("--phone <phone>", "Phone")
    .option("--company <company>", "Company name")
    .option("--category <cat>", "Category (supplier/contractor/partner/agency)")
    .option("--payment-terms <terms>", "Payment terms")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const vendor = createVendor({
        org_id: opts.org,
        name: opts.name,
        email: opts.email,
        phone: opts.phone,
        company: opts.company,
        category: opts.category,
        payment_terms: opts.paymentTerms,
      });

      if (opts.json) {
        console.log(JSON.stringify(vendor, null, 2));
      } else {
        console.log(`Added vendor: ${vendor.name} (${vendor.id})`);
      }
    });

  vendorCmd
    .command("list")
    .description("List vendors")
    .option("--org <id>", "Filter by organization")
    .option("--category <cat>", "Filter by category")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const vendors = listVendors({
        org_id: opts.org,
        category: opts.category,
      });

      if (opts.json) {
        console.log(JSON.stringify(vendors, null, 2));
      } else {
        if (vendors.length === 0) {
          console.log("No vendors found.");
          return;
        }
        for (const v of vendors) {
          const cat = v.category ? ` [${v.category}]` : "";
          console.log(`  ${v.name}${cat}`);
        }
        console.log(`\n${vendors.length} vendor(s)`);
      }
    });

  vendorCmd
    .command("get")
    .description("Get a vendor by ID")
    .argument("<id>", "Vendor ID")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const vendor = getVendor(id);
      if (!vendor) {
        console.error(`Vendor '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(vendor, null, 2));
      } else {
        console.log(`${vendor.name}`);
        if (vendor.email) console.log(`  Email: ${vendor.email}`);
        if (vendor.phone) console.log(`  Phone: ${vendor.phone}`);
        if (vendor.category) console.log(`  Category: ${vendor.category}`);
        if (vendor.payment_terms) console.log(`  Payment Terms: ${vendor.payment_terms}`);
      }
    });

  vendorCmd
    .command("update")
    .description("Update a vendor")
    .argument("<id>", "Vendor ID")
    .option("--name <name>", "Name")
    .option("--email <email>", "Email")
    .option("--phone <phone>", "Phone")
    .option("--company <company>", "Company")
    .option("--category <cat>", "Category")
    .option("--payment-terms <terms>", "Payment terms")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const input: Record<string, unknown> = {};
      if (opts.name !== undefined) input.name = opts.name;
      if (opts.email !== undefined) input.email = opts.email;
      if (opts.phone !== undefined) input.phone = opts.phone;
      if (opts.company !== undefined) input.company = opts.company;
      if (opts.category !== undefined) input.category = opts.category;
      if (opts.paymentTerms !== undefined) input.payment_terms = opts.paymentTerms;

      const vendor = updateVendor(id, input);
      if (!vendor) {
        console.error(`Vendor '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(vendor, null, 2));
      } else {
        console.log(`Updated: ${vendor.name}`);
      }
    });

  vendorCmd
    .command("delete")
    .description("Delete a vendor")
    .argument("<id>", "Vendor ID")
    .action((id) => {
      const deleted = deleteVendor(id);
      if (deleted) {
        console.log(`Deleted vendor ${id}`);
      } else {
        console.error(`Vendor '${id}' not found.`);
        process.exit(1);
      }
    });

  vendorCmd
    .command("search")
    .description("Search vendors")
    .requiredOption("--org <id>", "Organization ID")
    .argument("<query>", "Search term")
    .option("--json", "Output as JSON", false)
    .action((query, opts) => {
      const results = searchVendors(opts.org, query);

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          console.log(`No vendors matching "${query}".`);
          return;
        }
        for (const v of results) {
          console.log(`  ${v.name} ${v.email ? `<${v.email}>` : ""}`);
        }
      }
    });
}
