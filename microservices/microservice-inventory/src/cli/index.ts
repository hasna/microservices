#!/usr/bin/env bun

import { Command } from "commander";
import {
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
  deleteProduct,
  recordMovement,
  listMovements,
  getLowStockProducts,
  getInventoryValue,
  createLocation,
  listLocations,
} from "../db/inventory.js";

const program = new Command();

program
  .name("microservice-inventory")
  .description("Inventory management microservice")
  .version("0.0.1");

// --- Products ---

program
  .command("add")
  .description("Add a new product")
  .requiredOption("--sku <sku>", "Product SKU")
  .requiredOption("--name <name>", "Product name")
  .option("--description <text>", "Description")
  .option("--category <category>", "Category")
  .option("--unit-price <price>", "Unit price", "0")
  .option("--cost-price <price>", "Cost price", "0")
  .option("--unit <unit>", "Unit of measure", "each")
  .option("--quantity <n>", "Initial quantity on hand", "0")
  .option("--reorder-level <n>", "Reorder level", "0")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const product = createProduct({
      sku: opts.sku,
      name: opts.name,
      description: opts.description,
      category: opts.category,
      unit_price: parseFloat(opts.unitPrice),
      cost_price: parseFloat(opts.costPrice),
      unit: opts.unit,
      quantity_on_hand: parseFloat(opts.quantity),
      reorder_level: parseFloat(opts.reorderLevel),
    });

    if (opts.json) {
      console.log(JSON.stringify(product, null, 2));
    } else {
      console.log(`Created product: ${product.name} [${product.sku}] (${product.id})`);
    }
  });

program
  .command("get")
  .description("Get a product by ID or SKU")
  .argument("<id>", "Product ID or SKU")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const product = getProduct(id);
    if (!product) {
      console.error(`Product '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(product, null, 2));
    } else {
      console.log(`${product.name} [${product.sku}]`);
      if (product.description) console.log(`  Description: ${product.description}`);
      if (product.category) console.log(`  Category:    ${product.category}`);
      console.log(`  Unit Price:  ${product.unit_price}`);
      console.log(`  Cost Price:  ${product.cost_price}`);
      console.log(`  Unit:        ${product.unit}`);
      console.log(`  On Hand:     ${product.quantity_on_hand}`);
      console.log(`  Reorder At:  ${product.reorder_level}`);
    }
  });

program
  .command("list")
  .description("List products")
  .option("--category <category>", "Filter by category")
  .option("--low-stock", "Show only low stock products")
  .option("--search <query>", "Search by name, SKU, or description")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const products = listProducts({
      category: opts.category,
      low_stock: opts.lowStock,
      search: opts.search,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(products, null, 2));
    } else {
      if (products.length === 0) {
        console.log("No products found.");
        return;
      }
      for (const p of products) {
        const cat = p.category ? ` [${p.category}]` : "";
        console.log(`  ${p.sku}  ${p.name}${cat}  qty: ${p.quantity_on_hand} ${p.unit}`);
      }
      console.log(`\n${products.length} product(s)`);
    }
  });

program
  .command("update")
  .description("Update a product")
  .argument("<id>", "Product ID or SKU")
  .option("--sku <sku>", "SKU")
  .option("--name <name>", "Name")
  .option("--description <text>", "Description")
  .option("--category <category>", "Category")
  .option("--unit-price <price>", "Unit price")
  .option("--cost-price <price>", "Cost price")
  .option("--unit <unit>", "Unit of measure")
  .option("--reorder-level <n>", "Reorder level")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.sku !== undefined) input.sku = opts.sku;
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.description !== undefined) input.description = opts.description;
    if (opts.category !== undefined) input.category = opts.category;
    if (opts.unitPrice !== undefined) input.unit_price = parseFloat(opts.unitPrice);
    if (opts.costPrice !== undefined) input.cost_price = parseFloat(opts.costPrice);
    if (opts.unit !== undefined) input.unit = opts.unit;
    if (opts.reorderLevel !== undefined) input.reorder_level = parseFloat(opts.reorderLevel);

    const product = updateProduct(id, input);
    if (!product) {
      console.error(`Product '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(product, null, 2));
    } else {
      console.log(`Updated: ${product.name} [${product.sku}]`);
    }
  });

program
  .command("delete")
  .description("Delete a product")
  .argument("<id>", "Product ID or SKU")
  .action((id) => {
    const deleted = deleteProduct(id);
    if (deleted) {
      console.log(`Deleted product ${id}`);
    } else {
      console.error(`Product '${id}' not found.`);
      process.exit(1);
    }
  });

// --- Stock Movements ---

program
  .command("stock-in")
  .description("Record stock received")
  .requiredOption("--product <id>", "Product ID or SKU")
  .requiredOption("--quantity <n>", "Quantity received")
  .option("--reference <ref>", "Reference (PO number, etc.)")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const movement = recordMovement({
      product_id: opts.product,
      type: "in",
      quantity: parseFloat(opts.quantity),
      reference: opts.reference,
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(movement, null, 2));
    } else {
      console.log(`Stock in: +${movement.quantity} for product ${movement.product_id}`);
    }
  });

program
  .command("stock-out")
  .description("Record stock removed")
  .requiredOption("--product <id>", "Product ID or SKU")
  .requiredOption("--quantity <n>", "Quantity removed")
  .option("--reference <ref>", "Reference (order number, etc.)")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const movement = recordMovement({
      product_id: opts.product,
      type: "out",
      quantity: parseFloat(opts.quantity),
      reference: opts.reference,
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(movement, null, 2));
    } else {
      console.log(`Stock out: -${movement.quantity} for product ${movement.product_id}`);
    }
  });

program
  .command("adjust")
  .description("Record a stock adjustment")
  .requiredOption("--product <id>", "Product ID or SKU")
  .requiredOption("--quantity <n>", "Adjustment quantity (positive or negative)")
  .option("--reference <ref>", "Reference")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const movement = recordMovement({
      product_id: opts.product,
      type: "adjustment",
      quantity: parseFloat(opts.quantity),
      reference: opts.reference,
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(movement, null, 2));
    } else {
      console.log(`Adjustment: ${movement.quantity > 0 ? "+" : ""}${movement.quantity} for product ${movement.product_id}`);
    }
  });

program
  .command("movements")
  .description("List stock movements")
  .option("--product <id>", "Filter by product ID or SKU")
  .option("--type <type>", "Filter by type: in|out|adjustment")
  .option("--from <date>", "From date")
  .option("--to <date>", "To date")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const movements = listMovements({
      product_id: opts.product,
      type: opts.type,
      from_date: opts.from,
      to_date: opts.to,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(movements, null, 2));
    } else {
      if (movements.length === 0) {
        console.log("No movements found.");
        return;
      }
      for (const m of movements) {
        const sign = m.type === "out" ? "-" : m.type === "in" ? "+" : "";
        const ref = m.reference ? ` ref: ${m.reference}` : "";
        console.log(`  ${m.created_at}  ${m.type.padEnd(10)}  ${sign}${m.quantity}  ${m.product_id}${ref}`);
      }
      console.log(`\n${movements.length} movement(s)`);
    }
  });

// --- Low Stock ---

program
  .command("low-stock")
  .description("Show products at or below reorder level")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const products = getLowStockProducts();

    if (opts.json) {
      console.log(JSON.stringify(products, null, 2));
    } else {
      if (products.length === 0) {
        console.log("No low stock products.");
        return;
      }
      for (const p of products) {
        console.log(`  ${p.sku}  ${p.name}  on_hand: ${p.quantity_on_hand}  reorder_at: ${p.reorder_level}`);
      }
      console.log(`\n${products.length} product(s) at or below reorder level`);
    }
  });

// --- Inventory Value ---

program
  .command("value")
  .description("Show total inventory value")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const value = getInventoryValue();

    if (opts.json) {
      console.log(JSON.stringify(value, null, 2));
    } else {
      console.log("\n  Inventory Value");
      console.log(`  Products:     ${value.total_products}`);
      console.log(`  Total Qty:    ${value.total_quantity}`);
      console.log(`  Cost Value:   $${value.total_cost_value.toFixed(2)}`);
      console.log(`  Retail Value: $${value.total_retail_value.toFixed(2)}`);
      console.log();
    }
  });

// --- Locations ---

const locationCmd = program.command("location").description("Location management");

locationCmd
  .command("add")
  .description("Add a location")
  .requiredOption("--name <name>", "Location name")
  .option("--description <text>", "Description")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const location = createLocation({
      name: opts.name,
      description: opts.description,
    });

    if (opts.json) {
      console.log(JSON.stringify(location, null, 2));
    } else {
      console.log(`Created location: ${location.name} (${location.id})`);
    }
  });

locationCmd
  .command("list")
  .description("List locations")
  .option("--search <query>", "Search")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const locations = listLocations(opts.search);

    if (opts.json) {
      console.log(JSON.stringify(locations, null, 2));
    } else {
      if (locations.length === 0) {
        console.log("No locations found.");
        return;
      }
      for (const l of locations) {
        const desc = l.description ? ` — ${l.description}` : "";
        console.log(`  ${l.name}${desc}`);
      }
    }
  });

program.parse(process.argv);
