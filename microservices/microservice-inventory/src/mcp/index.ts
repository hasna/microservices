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
  recordMovement,
  listMovements,
  getLowStockProducts,
  getInventoryValue,
  createLocation,
  listLocations,
} from "../db/inventory.js";

const server = new McpServer({
  name: "microservice-inventory",
  version: "0.0.1",
});

// --- Products ---

server.registerTool(
  "create_product",
  {
    title: "Create Product",
    description: "Create a new product in inventory.",
    inputSchema: {
      sku: z.string(),
      name: z.string(),
      description: z.string().optional(),
      category: z.string().optional(),
      unit_price: z.number().optional(),
      cost_price: z.number().optional(),
      unit: z.string().optional(),
      quantity_on_hand: z.number().optional(),
      reorder_level: z.number().optional(),
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
    description: "Get a product by ID or SKU.",
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
      category: z.string().optional(),
      low_stock: z.boolean().optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const products = listProducts(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ products, count: products.length }, null, 2) },
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
      sku: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      unit_price: z.number().optional(),
      cost_price: z.number().optional(),
      unit: z.string().optional(),
      reorder_level: z.number().optional(),
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
    description: "Delete a product by ID or SKU.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteProduct(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Stock Movements ---

server.registerTool(
  "record_movement",
  {
    title: "Record Stock Movement",
    description: "Record a stock movement (in, out, or adjustment). Automatically adjusts quantity on hand.",
    inputSchema: {
      product_id: z.string(),
      type: z.enum(["in", "out", "adjustment"]),
      quantity: z.number(),
      reference: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    const movement = recordMovement(params);
    return { content: [{ type: "text", text: JSON.stringify(movement, null, 2) }] };
  }
);

server.registerTool(
  "list_movements",
  {
    title: "List Stock Movements",
    description: "List stock movements with optional filters.",
    inputSchema: {
      product_id: z.string().optional(),
      type: z.enum(["in", "out", "adjustment"]).optional(),
      from_date: z.string().optional(),
      to_date: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const movements = listMovements(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ movements, count: movements.length }, null, 2) },
      ],
    };
  }
);

// --- Low Stock ---

server.registerTool(
  "low_stock_products",
  {
    title: "Low Stock Products",
    description: "Get all products at or below their reorder level.",
    inputSchema: {},
  },
  async () => {
    const products = getLowStockProducts();
    return {
      content: [
        { type: "text", text: JSON.stringify({ products, count: products.length }, null, 2) },
      ],
    };
  }
);

// --- Inventory Value ---

server.registerTool(
  "inventory_value",
  {
    title: "Inventory Value",
    description: "Get total inventory value (cost and retail).",
    inputSchema: {},
  },
  async () => {
    const value = getInventoryValue();
    return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
  }
);

// --- Locations ---

server.registerTool(
  "create_location",
  {
    title: "Create Location",
    description: "Create a new inventory location.",
    inputSchema: {
      name: z.string(),
      description: z.string().optional(),
    },
  },
  async (params) => {
    const location = createLocation(params);
    return { content: [{ type: "text", text: JSON.stringify(location, null, 2) }] };
  }
);

server.registerTool(
  "list_locations",
  {
    title: "List Locations",
    description: "List all inventory locations.",
    inputSchema: { search: z.string().optional() },
  },
  async ({ search }) => {
    const locations = listLocations(search);
    return {
      content: [
        { type: "text", text: JSON.stringify({ locations, count: locations.length }, null, 2) },
      ],
    };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-inventory MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
