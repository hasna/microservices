#!/usr/bin/env bun

import { Command } from "commander";
import {
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
  deleteProduct,
  searchProducts,
  getProductWithTiers,
  bulkImportProducts,
  exportProducts,
  getProductStats,
} from "../db/products.js";
import {
  createCategory,
  listCategories,
  getCategoryTree,
} from "../db/categories.js";
import {
  createPricingTier,
  listPricingTiers,
  deletePricingTier,
} from "../db/pricing-tiers.js";

const program = new Command();

program
  .name("microservice-products")
  .description("Product catalog microservice")
  .version("0.0.1");

// --- Products ---

program
  .command("create")
  .description("Create a new product")
  .requiredOption("--name <name>", "Product name")
  .option("--description <desc>", "Description")
  .option("--type <type>", "Type (product/service/subscription/digital)", "product")
  .option("--sku <sku>", "SKU")
  .option("--price <price>", "Price")
  .option("--currency <currency>", "Currency", "USD")
  .option("--unit <unit>", "Unit of measure")
  .option("--category <category>", "Category name")
  .option("--status <status>", "Status (active/draft/archived)", "draft")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const product = createProduct({
      name: opts.name,
      description: opts.description,
      type: opts.type,
      sku: opts.sku,
      price: opts.price ? parseFloat(opts.price) : undefined,
      currency: opts.currency,
      unit: opts.unit,
      category: opts.category,
      status: opts.status,
    });

    if (opts.json) {
      console.log(JSON.stringify(product, null, 2));
    } else {
      console.log(`Created product: ${product.name} (${product.id})`);
    }
  });

program
  .command("get")
  .description("Get a product by ID")
  .argument("<id>", "Product ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const product = getProductWithTiers(id);
    if (!product) {
      console.error(`Product '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(product, null, 2));
    } else {
      console.log(`${product.name}`);
      if (product.sku) console.log(`  SKU: ${product.sku}`);
      console.log(`  Type: ${product.type}`);
      console.log(`  Status: ${product.status}`);
      if (product.price !== null) console.log(`  Price: ${product.price} ${product.currency}`);
      if (product.unit) console.log(`  Unit: ${product.unit}`);
      if (product.category) console.log(`  Category: ${product.category}`);
      if (product.description) console.log(`  Description: ${product.description}`);
      if (product.pricing_tiers.length > 0) {
        console.log(`  Pricing Tiers:`);
        for (const t of product.pricing_tiers) {
          console.log(`    - ${t.name}: ${t.price} ${t.currency} (min qty: ${t.min_quantity})`);
        }
      }
    }
  });

program
  .command("list")
  .description("List products")
  .option("--search <query>", "Search by name, description, or SKU")
  .option("--category <category>", "Filter by category")
  .option("--type <type>", "Filter by type")
  .option("--status <status>", "Filter by status")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const products = listProducts({
      search: opts.search,
      category: opts.category,
      type: opts.type,
      status: opts.status,
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
        const sku = p.sku ? ` [${p.sku}]` : "";
        const price = p.price !== null ? ` $${p.price}` : "";
        console.log(`  ${p.name}${sku}${price} (${p.status})`);
      }
      console.log(`\n${products.length} product(s)`);
    }
  });

program
  .command("update")
  .description("Update a product")
  .argument("<id>", "Product ID")
  .option("--name <name>", "Name")
  .option("--description <desc>", "Description")
  .option("--type <type>", "Type")
  .option("--sku <sku>", "SKU")
  .option("--price <price>", "Price")
  .option("--currency <currency>", "Currency")
  .option("--unit <unit>", "Unit")
  .option("--category <category>", "Category")
  .option("--status <status>", "Status")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.description !== undefined) input.description = opts.description;
    if (opts.type !== undefined) input.type = opts.type;
    if (opts.sku !== undefined) input.sku = opts.sku;
    if (opts.price !== undefined) input.price = parseFloat(opts.price);
    if (opts.currency !== undefined) input.currency = opts.currency;
    if (opts.unit !== undefined) input.unit = opts.unit;
    if (opts.category !== undefined) input.category = opts.category;
    if (opts.status !== undefined) input.status = opts.status;

    const product = updateProduct(id, input);
    if (!product) {
      console.error(`Product '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(product, null, 2));
    } else {
      console.log(`Updated: ${product.name}`);
    }
  });

program
  .command("delete")
  .description("Delete a product")
  .argument("<id>", "Product ID")
  .action((id) => {
    const deleted = deleteProduct(id);
    if (deleted) {
      console.log(`Deleted product ${id}`);
    } else {
      console.error(`Product '${id}' not found.`);
      process.exit(1);
    }
  });

program
  .command("search")
  .description("Search products")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .action((query, opts) => {
    const results = searchProducts(query);

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log(`No products matching "${query}".`);
        return;
      }
      for (const p of results) {
        const sku = p.sku ? ` [${p.sku}]` : "";
        console.log(`  ${p.name}${sku} (${p.status})`);
      }
    }
  });

// --- Categories ---

const categoryCmd = program
  .command("category")
  .description("Category management");

categoryCmd
  .command("create")
  .description("Create a category")
  .requiredOption("--name <name>", "Category name")
  .option("--parent <id>", "Parent category ID")
  .option("--description <desc>", "Description")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const category = createCategory({
      name: opts.name,
      parent_id: opts.parent,
      description: opts.description,
    });

    if (opts.json) {
      console.log(JSON.stringify(category, null, 2));
    } else {
      console.log(`Created category: ${category.name} (${category.id})`);
    }
  });

categoryCmd
  .command("list")
  .description("List categories")
  .option("--search <query>", "Search")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const categories = listCategories({
      search: opts.search,
    });

    if (opts.json) {
      console.log(JSON.stringify(categories, null, 2));
    } else {
      if (categories.length === 0) {
        console.log("No categories found.");
        return;
      }
      for (const c of categories) {
        const parent = c.parent_id ? ` (child of ${c.parent_id})` : "";
        console.log(`  ${c.name}${parent}`);
      }
    }
  });

categoryCmd
  .command("tree")
  .description("Display category tree")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const tree = getCategoryTree();

    if (opts.json) {
      console.log(JSON.stringify(tree, null, 2));
    } else {
      if (tree.length === 0) {
        console.log("No categories found.");
        return;
      }
      function printTree(nodes: typeof tree, indent = 0): void {
        for (const node of nodes) {
          console.log(`${"  ".repeat(indent)}${indent > 0 ? "|- " : ""}${node.name}`);
          if (node.children.length > 0) {
            printTree(node.children, indent + 1);
          }
        }
      }
      printTree(tree);
    }
  });

// --- Pricing Tiers ---

const tierCmd = program
  .command("tier")
  .description("Pricing tier management");

tierCmd
  .command("add")
  .description("Add a pricing tier to a product")
  .requiredOption("--product <id>", "Product ID")
  .requiredOption("--name <name>", "Tier name")
  .requiredOption("--min-quantity <n>", "Minimum quantity")
  .requiredOption("--price <price>", "Price")
  .option("--currency <currency>", "Currency", "USD")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const tier = createPricingTier({
      product_id: opts.product,
      name: opts.name,
      min_quantity: parseInt(opts.minQuantity),
      price: parseFloat(opts.price),
      currency: opts.currency,
    });

    if (opts.json) {
      console.log(JSON.stringify(tier, null, 2));
    } else {
      console.log(`Created tier: ${tier.name} (${tier.id})`);
    }
  });

tierCmd
  .command("list")
  .description("List pricing tiers for a product")
  .argument("<product-id>", "Product ID")
  .option("--json", "Output as JSON", false)
  .action((productId, opts) => {
    const tiers = listPricingTiers(productId);

    if (opts.json) {
      console.log(JSON.stringify(tiers, null, 2));
    } else {
      if (tiers.length === 0) {
        console.log("No pricing tiers found.");
        return;
      }
      for (const t of tiers) {
        console.log(`  ${t.name}: ${t.price} ${t.currency} (min qty: ${t.min_quantity})`);
      }
    }
  });

tierCmd
  .command("remove")
  .description("Remove a pricing tier")
  .argument("<id>", "Tier ID")
  .action((id) => {
    const deleted = deletePricingTier(id);
    if (deleted) {
      console.log(`Deleted tier ${id}`);
    } else {
      console.error(`Tier '${id}' not found.`);
      process.exit(1);
    }
  });

// --- Import/Export ---

program
  .command("import")
  .description("Bulk import products from CSV")
  .argument("<csv>", "CSV string")
  .option("--json", "Output as JSON", false)
  .action((csv, opts) => {
    const result = bulkImportProducts(csv);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Imported: ${result.imported}, Skipped: ${result.skipped}`);
      if (result.errors.length > 0) {
        console.log("Errors:");
        for (const e of result.errors) {
          console.log(`  - ${e}`);
        }
      }
    }
  });

program
  .command("export")
  .description("Export products")
  .option("--format <format>", "Output format (csv/json)", "json")
  .action((opts) => {
    const output = exportProducts(opts.format);
    console.log(output);
  });

// --- Stats ---

program
  .command("stats")
  .description("Show product statistics")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getProductStats();

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(`Total products: ${stats.total}`);
      console.log("\nBy status:");
      for (const [k, v] of Object.entries(stats.by_status)) {
        console.log(`  ${k}: ${v}`);
      }
      console.log("\nBy type:");
      for (const [k, v] of Object.entries(stats.by_type)) {
        console.log(`  ${k}: ${v}`);
      }
      console.log("\nBy category:");
      for (const [k, v] of Object.entries(stats.by_category)) {
        console.log(`  ${k}: ${v}`);
      }
      if (stats.avg_price !== null) {
        console.log(`\nPrice range: ${stats.min_price} - ${stats.max_price} (avg: ${stats.avg_price?.toFixed(2)})`);
      }
    }
  });

program.parse(process.argv);
