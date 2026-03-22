#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createTrip,
  getTrip,
  listTrips,
  updateTrip,
  deleteTrip,
  getUpcomingTrips,
  getTripBudgetVsActual,
  getTravelStats,
} from "../db/travel.js";
import {
  createBooking,
  getBooking,
  listBookings,
  cancelBooking,
  deleteBooking,
} from "../db/travel.js";
import {
  createDocument,
  getDocument,
  listDocuments,
  deleteDocument,
  getExpiringDocuments,
} from "../db/travel.js";
import {
  createLoyaltyProgram,
  getLoyaltyProgram,
  listLoyaltyPrograms,
  updateLoyaltyProgram,
  deleteLoyaltyProgram,
  getLoyaltyPointsSummary,
} from "../db/travel.js";

const server = new McpServer({
  name: "microservice-travel",
  version: "0.0.1",
});

// --- Trips ---

server.registerTool(
  "create_trip",
  {
    title: "Create Trip",
    description: "Create a new trip.",
    inputSchema: {
      name: z.string(),
      destination: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      status: z.enum(["planning", "booked", "in_progress", "completed", "cancelled"]).optional(),
      budget: z.number().optional(),
      currency: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async (params) => {
    const trip = createTrip(params);
    return { content: [{ type: "text", text: JSON.stringify(trip, null, 2) }] };
  }
);

server.registerTool(
  "get_trip",
  {
    title: "Get Trip",
    description: "Get a trip by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const trip = getTrip(id);
    if (!trip) {
      return { content: [{ type: "text", text: `Trip '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(trip, null, 2) }] };
  }
);

server.registerTool(
  "list_trips",
  {
    title: "List Trips",
    description: "List trips with optional filters.",
    inputSchema: {
      search: z.string().optional(),
      status: z.string().optional(),
      destination: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const trips = listTrips(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ trips, count: trips.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_trip",
  {
    title: "Update Trip",
    description: "Update an existing trip.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      destination: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      status: z.enum(["planning", "booked", "in_progress", "completed", "cancelled"]).optional(),
      budget: z.number().optional(),
      spent: z.number().optional(),
      currency: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const trip = updateTrip(id, input);
    if (!trip) {
      return { content: [{ type: "text", text: `Trip '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(trip, null, 2) }] };
  }
);

server.registerTool(
  "delete_trip",
  {
    title: "Delete Trip",
    description: "Delete a trip by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteTrip(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Bookings ---

server.registerTool(
  "create_booking",
  {
    title: "Create Booking",
    description: "Add a booking to a trip.",
    inputSchema: {
      trip_id: z.string(),
      type: z.enum(["flight", "hotel", "car", "train", "activity"]),
      provider: z.string().optional(),
      confirmation_code: z.string().optional(),
      status: z.enum(["confirmed", "pending", "cancelled"]).optional(),
      check_in: z.string().optional(),
      check_out: z.string().optional(),
      cost: z.number().optional(),
    },
  },
  async (params) => {
    const booking = createBooking(params);
    return { content: [{ type: "text", text: JSON.stringify(booking, null, 2) }] };
  }
);

server.registerTool(
  "get_booking",
  {
    title: "Get Booking",
    description: "Get a booking by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const booking = getBooking(id);
    if (!booking) {
      return { content: [{ type: "text", text: `Booking '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(booking, null, 2) }] };
  }
);

server.registerTool(
  "list_bookings",
  {
    title: "List Bookings",
    description: "List bookings with optional filters.",
    inputSchema: {
      trip_id: z.string().optional(),
      type: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const bookings = listBookings(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ bookings, count: bookings.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "cancel_booking",
  {
    title: "Cancel Booking",
    description: "Cancel a booking by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const booking = cancelBooking(id);
    if (!booking) {
      return { content: [{ type: "text", text: `Booking '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(booking, null, 2) }] };
  }
);

server.registerTool(
  "delete_booking",
  {
    title: "Delete Booking",
    description: "Delete a booking by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteBooking(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

// --- Documents ---

server.registerTool(
  "create_document",
  {
    title: "Create Travel Document",
    description: "Add a travel document to a trip.",
    inputSchema: {
      trip_id: z.string(),
      type: z.enum(["passport", "visa", "insurance", "ticket", "voucher"]),
      name: z.string(),
      number: z.string().optional(),
      expires_at: z.string().optional(),
      file_path: z.string().optional(),
    },
  },
  async (params) => {
    const doc = createDocument(params);
    return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
  }
);

server.registerTool(
  "get_document",
  {
    title: "Get Travel Document",
    description: "Get a travel document by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const doc = getDocument(id);
    if (!doc) {
      return { content: [{ type: "text", text: `Document '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
  }
);

server.registerTool(
  "list_documents",
  {
    title: "List Travel Documents",
    description: "List travel documents with optional filters.",
    inputSchema: {
      trip_id: z.string().optional(),
      type: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  async (params) => {
    const docs = listDocuments(params);
    return {
      content: [
        { type: "text", text: JSON.stringify({ documents: docs, count: docs.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "delete_document",
  {
    title: "Delete Travel Document",
    description: "Delete a travel document by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteDocument(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "get_expiring_documents",
  {
    title: "Get Expiring Documents",
    description: "Get travel documents expiring within a given number of days.",
    inputSchema: {
      days: z.number().optional(),
    },
  },
  async ({ days }) => {
    const docs = getExpiringDocuments(days ?? 90);
    return {
      content: [
        { type: "text", text: JSON.stringify({ documents: docs, count: docs.length }, null, 2) },
      ],
    };
  }
);

// --- Loyalty Programs ---

server.registerTool(
  "create_loyalty_program",
  {
    title: "Create Loyalty Program",
    description: "Add a loyalty program.",
    inputSchema: {
      program_name: z.string(),
      member_id: z.string().optional(),
      tier: z.string().optional(),
      points: z.number().optional(),
      miles: z.number().optional(),
      expires_at: z.string().optional(),
    },
  },
  async (params) => {
    const program = createLoyaltyProgram(params);
    return { content: [{ type: "text", text: JSON.stringify(program, null, 2) }] };
  }
);

server.registerTool(
  "get_loyalty_program",
  {
    title: "Get Loyalty Program",
    description: "Get a loyalty program by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const program = getLoyaltyProgram(id);
    if (!program) {
      return { content: [{ type: "text", text: `Loyalty program '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(program, null, 2) }] };
  }
);

server.registerTool(
  "list_loyalty_programs",
  {
    title: "List Loyalty Programs",
    description: "List all loyalty programs.",
    inputSchema: {},
  },
  async () => {
    const programs = listLoyaltyPrograms();
    return {
      content: [
        { type: "text", text: JSON.stringify({ programs, count: programs.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "update_loyalty_program",
  {
    title: "Update Loyalty Program",
    description: "Update a loyalty program.",
    inputSchema: {
      id: z.string(),
      program_name: z.string().optional(),
      member_id: z.string().optional(),
      tier: z.string().optional(),
      points: z.number().optional(),
      miles: z.number().optional(),
      expires_at: z.string().optional(),
    },
  },
  async ({ id, ...input }) => {
    const program = updateLoyaltyProgram(id, input);
    if (!program) {
      return { content: [{ type: "text", text: `Loyalty program '${id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(program, null, 2) }] };
  }
);

server.registerTool(
  "delete_loyalty_program",
  {
    title: "Delete Loyalty Program",
    description: "Delete a loyalty program by ID.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const deleted = deleteLoyaltyProgram(id);
    return { content: [{ type: "text", text: JSON.stringify({ id, deleted }) }] };
  }
);

server.registerTool(
  "get_loyalty_summary",
  {
    title: "Get Loyalty Points Summary",
    description: "Get a summary of all loyalty points and miles.",
    inputSchema: {},
  },
  async () => {
    const summary = getLoyaltyPointsSummary();
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

// --- Special Queries ---

server.registerTool(
  "get_upcoming_trips",
  {
    title: "Get Upcoming Trips",
    description: "Get trips starting within a given number of days.",
    inputSchema: {
      days: z.number().optional(),
    },
  },
  async ({ days }) => {
    const trips = getUpcomingTrips(days ?? 30);
    return {
      content: [
        { type: "text", text: JSON.stringify({ trips, count: trips.length }, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_trip_budget",
  {
    title: "Get Trip Budget vs Actual",
    description: "Get budget vs actual spending for a trip.",
    inputSchema: { trip_id: z.string() },
  },
  async ({ trip_id }) => {
    const budget = getTripBudgetVsActual(trip_id);
    if (!budget) {
      return { content: [{ type: "text", text: `Trip '${trip_id}' not found.` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(budget, null, 2) }] };
  }
);

server.registerTool(
  "get_travel_stats",
  {
    title: "Get Travel Statistics",
    description: "Get travel statistics, optionally filtered by year.",
    inputSchema: {
      year: z.number().optional(),
    },
  },
  async ({ year }) => {
    const stats = getTravelStats(year);
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("microservice-travel MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
