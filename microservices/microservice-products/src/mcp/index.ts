#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
  deleteProduct,
  countProducts,
  searchProducts,
  listByCategory,
  listByType,
  listByStatus,
  getProductWithTiers,
  bulkImportProducts,
  exportProducts,
  getProductStats,
} from "../db/products.js";
import {
  createCategory,
  getCategory,
  listCategories,
  updateCategory,
  deleteCategory,
  getCategoryTree,
} from "../db/categories.js";
import {
  createPricingTier,
  listPricingTiers,
  deletePricingTier,
} from "../db/pricing-tiers.js";

const server = new McpServer({
  name: "microservice-products",
  version: "0.0.1",
});

// --- Products ---

server.registerTool(
  "create_product",
  {
    title: "Create Product",
    description: "Create a new product.",
    inputSchema: {
      name: z.string(),
      description: z.string().optional(),
      type: z.enum(["product", "service", "subscription", "digital"]).optional(),
      sku: z.string().optional(),
      price: z.number().optional(),
      currency: z.string().optional(),
      unit: z.string().optional(),
      category: z.string().optional(),
      status: z.enum(["active", "draft", "archived"]).optional(),
      images: z.array(z.string()).optional(),
      variants: z.array(z.record(z.unknown())).optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async (params) => {
    const product = createProduct(params);
    return { content: [{ type: "text", text: JSON.stringify(product, null, 2) }] };
  }
);

server.registerTool(
  "get_product",
  {
    title: "Get Product",
    description: "Get a product by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const product = getProduct(id);
    if (!product) {
      return { content: [{ type: "text", text: `Product '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(product, null, 2) }] };
  }
);

server.registerTool(
  "list_products",
  {
    title: "List Products",
    description: "List products with optional filters.",
    inputSchema: {
      search: z.string().optional(),
      category: z.string().optional(),
      type: z.enum(["product", "service", "subscription", "digital"]).optional(),
      status: z.enum(["active", "draft", "archived"]).optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
  },
  async (params) => {
    const products = listProducts(params);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ products, count: products.length }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "update_product",
  {
    title: "Update Product",
    description: "Update an existing product.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      type: z.enum(["product", "service", "subscription", "digital"]).optional(),
      sku: z.string().optional(),
      price: z.number().optional(),
      currency: z.string().optional(),
      unit: z.string().optional(),
      category: z.string().optional(),
      status: z.enum(["active", "draft", "archived"]).optional(),
      images: z.array(z.string()).optional(),
      variants: z.array(z.record(z.unknown())).optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async ({ id, ...input }) => {
    const product = updateProduct(id, input);
    if (!product) {
      return { content: [{ type: "text", text: `Product '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(product, null, 2) }] };
  }
);

server.registerTool(
  "delete_product",
  {
    title: "Delete Product",
    description: "Delete a product by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteProduct(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "search_products",
  {
    title: "Search Products",
    description: "Search products by name, description, or SKU.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchProducts(query);
    return {
      content: [
        { type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "count_products",
  {
    title: "Count Products",
    description: "Get the total number of products.",
    inputSchema: {},
  },
  async () => {
    const count = countProducts();
    return { content: [{ type: "text", text: JSON.stringify({ count }) }] };
  }
);

server.registerTool(
  "list_products_by_category",
  {
    title: "List Products by Category",
    description: "List all products in a given category.",
    inputSchema: { category: z.string() },
  },
  async ({ category }) => {
    const products = listByCategory(category);
    return {
      content: [
        { type: "text", text: JSON.stringify({ products, count: products.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "list_products_by_type",
  {
    title: "List Products by Type",
    description: "List all products of a given type.",
    inputSchema: { type: z.enum(["product", "service", "subscription", "digital"]) },
  },
  async ({ type }) => {
    const products = listByType(type);
    return {
      content: [
        { type: "text", text: JSON.stringify({ products, count: products.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "list_products_by_status",
  {
    title: "List Products by Status",
    description: "List all products with a given status.",
    inputSchema: { status: z.enum(["active", "draft", "archived"]) },
  },
  async ({ status }) => {
    const products = listByStatus(status);
    return {
      content: [
        { type: "text", text: JSON.stringify({ products, count: products.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_product_with_tiers",
  {
    title: "Get Product with Pricing Tiers",
    description: "Get a product along with all its pricing tiers.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const product = getProductWithTiers(id);
    if (!product) {
      return { content: [{ type: "text", text: `Product '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(product, null, 2) }] };
  }
);

server.registerTool(
  "bulk_import_products",
  {
    title: "Bulk Import Products",
    description: "Import products from a CSV string. CSV must have a header row with at least a 'name' column.",
    inputSchema: { csv: z.string() },
  },
  async ({ csv }) => {
    const result = bulkImportProducts(csv);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "export_products",
  {
    title: "Export Products",
    description: "Export all products in CSV or JSON format.",
    inputSchema: { format: z.enum(["csv", "json"]).optional() },
  },
  async ({ format }) => {
    const output = exportProducts(format || "json");
    return { content: [{ type: "text", text: output }] };
  }
);

server.registerTool(
  "get_product_stats",
  {
    title: "Get Product Statistics",
    description: "Get aggregate statistics about products (counts by status, type, category, and price range).",
    inputSchema: {},
  },
  async () => {
    const stats = getProductStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// --- Categories ---

server.registerTool(
  "create_category",
  {
    title: "Create Category",
    description: "Create a new product category.",
    inputSchema: {
      name: z.string(),
      parent_id: z.string().optional(),
      description: z.string().optional(),
    },
  },
  async (params) => {
    const category = createCategory(params);
    return { content: [{ type: "text", text: JSON.stringify(category, null, 2) }] };
  }
);

server.registerTool(
  "get_category",
  {
    title: "Get Category",
    description: "Get a category by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const category = getCategory(id);
    if (!category) {
      return { content: [{ type: "text", text: `Category '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(category, null, 2) }] };
  }
);

server.registerTool(
  "list_categories",
  {
    title: "List Categories",
    description: "List all product categories.",
    inputSchema: {
      search: z.string().optional(),
    },
  },
  async (params) => {
    const categories = listCategories(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ categories, count: categories.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_category",
  {
    title: "Update Category",
    description: "Update an existing category.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      parent_id: z.string().optional(),
      description: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const category = updateCategory(id, input);
    if (!category) {
      return { content: [{ type: "text", text: `Category '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(category, null, 2) }] };
  }
);

server.registerTool(
  "delete_category",
  {
    title: "Delete Category",
    description: "Delete a category by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteCategory(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "get_category_tree",
  {
    title: "Get Category Tree",
    description: "Get the full category hierarchy as a tree structure.",
    inputSchema: {},
  },
  async () => {
    const tree = getCategoryTree();
    return { content: [{ type: "text", text: JSON.stringify(tree, null, 2) }] };
  }
);

// --- Pricing Tiers ---

server.registerTool(
  "create_pricing_tier",
  {
    title: "Create Pricing Tier",
    description: "Add a pricing tier to a product.",
    inputSchema: {
      product_id: z.string(),
      name: z.string(),
      min_quantity: z.number(),
      price: z.number(),
      currency: z.string().optional(),
    },
  },
  async (params) => {
    const tier = createPricingTier(params);
    return { content: [{ type: "text", text: JSON.stringify(tier, null, 2) }] };
  }
);

server.registerTool(
  "list_pricing_tiers",
  {
    title: "List Pricing Tiers",
    description: "List all pricing tiers for a product.",
    inputSchema: { product_id: z.string() },
  },
  async ({ product_id }) => {
    const tiers = listPricingTiers(product_id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ tiers, count: tiers.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "delete_pricing_tier",
  {
    title: "Delete Pricing Tier",
    description: "Delete a pricing tier by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deletePricingTier(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-products MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
