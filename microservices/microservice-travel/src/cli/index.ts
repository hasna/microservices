#!/usr/bin/env bun

import { Command } from "commander";
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
  listBookings,
  cancelBooking,
} from "../db/travel.js";
import {
  createDocument,
  listDocuments,
  getExpiringDocuments,
} from "../db/travel.js";
import {
  createLoyaltyProgram,
  listLoyaltyPrograms,
  getLoyaltyPointsSummary,
} from "../db/travel.js";

const program = new Command();

program
  .name("microservice-travel")
  .description("Travel management microservice")
  .version("0.0.1");

// --- Trips ---

const tripCmd = program
  .command("trip")
  .description("Trip management");

tripCmd
  .command("create")
  .description("Create a new trip")
  .requiredOption("--name <name>", "Trip name")
  .option("--destination <destination>", "Destination")
  .option("--start-date <date>", "Start date (YYYY-MM-DD)")
  .option("--end-date <date>", "End date (YYYY-MM-DD)")
  .option("--status <status>", "Status (planning|booked|in_progress|completed|cancelled)")
  .option("--budget <amount>", "Budget amount")
  .option("--currency <code>", "Currency code (default: USD)")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const trip = createTrip({
      name: opts.name,
      destination: opts.destination,
      start_date: opts.startDate,
      end_date: opts.endDate,
      status: opts.status,
      budget: opts.budget ? parseFloat(opts.budget) : undefined,
      currency: opts.currency,
      notes: opts.notes,
    });

    if (opts.json) {
      console.log(JSON.stringify(trip, null, 2));
    } else {
      console.log(`Created trip: ${trip.name} (${trip.id})`);
    }
  });

tripCmd
  .command("list")
  .description("List trips")
  .option("--search <query>", "Search by name, destination, or notes")
  .option("--status <status>", "Filter by status")
  .option("--destination <dest>", "Filter by destination")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const trips = listTrips({
      search: opts.search,
      status: opts.status,
      destination: opts.destination,
      limit: opts.limit ? parseInt(opts.limit) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(trips, null, 2));
    } else {
      if (trips.length === 0) {
        console.log("No trips found.");
        return;
      }
      for (const t of trips) {
        const dest = t.destination ? ` -> ${t.destination}` : "";
        const dates = t.start_date ? ` (${t.start_date}${t.end_date ? ` to ${t.end_date}` : ""})` : "";
        console.log(`  [${t.status}] ${t.name}${dest}${dates}`);
      }
      console.log(`\n${trips.length} trip(s)`);
    }
  });

tripCmd
  .command("get")
  .description("Get a trip by ID")
  .argument("<id>", "Trip ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const trip = getTrip(id);
    if (!trip) {
      console.error(`Trip '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(trip, null, 2));
    } else {
      console.log(`${trip.name} [${trip.status}]`);
      if (trip.destination) console.log(`  Destination: ${trip.destination}`);
      if (trip.start_date) console.log(`  Dates: ${trip.start_date}${trip.end_date ? ` to ${trip.end_date}` : ""}`);
      if (trip.budget !== null) console.log(`  Budget: ${trip.currency} ${trip.budget} (spent: ${trip.spent})`);
      if (trip.notes) console.log(`  Notes: ${trip.notes}`);
    }
  });

tripCmd
  .command("update")
  .description("Update a trip")
  .argument("<id>", "Trip ID")
  .option("--name <name>", "Trip name")
  .option("--destination <destination>", "Destination")
  .option("--start-date <date>", "Start date")
  .option("--end-date <date>", "End date")
  .option("--status <status>", "Status")
  .option("--budget <amount>", "Budget")
  .option("--currency <code>", "Currency")
  .option("--notes <notes>", "Notes")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const input: Record<string, unknown> = {};
    if (opts.name !== undefined) input.name = opts.name;
    if (opts.destination !== undefined) input.destination = opts.destination;
    if (opts.startDate !== undefined) input.start_date = opts.startDate;
    if (opts.endDate !== undefined) input.end_date = opts.endDate;
    if (opts.status !== undefined) input.status = opts.status;
    if (opts.budget !== undefined) input.budget = parseFloat(opts.budget);
    if (opts.currency !== undefined) input.currency = opts.currency;
    if (opts.notes !== undefined) input.notes = opts.notes;

    const trip = updateTrip(id, input);
    if (!trip) {
      console.error(`Trip '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(trip, null, 2));
    } else {
      console.log(`Updated: ${trip.name}`);
    }
  });

tripCmd
  .command("delete")
  .description("Delete a trip")
  .argument("<id>", "Trip ID")
  .action((id) => {
    const deleted = deleteTrip(id);
    if (deleted) {
      console.log(`Deleted trip ${id}`);
    } else {
      console.error(`Trip '${id}' not found.`);
      process.exit(1);
    }
  });

// --- Bookings ---

const bookingCmd = program
  .command("booking")
  .description("Booking management");

bookingCmd
  .command("add")
  .description("Add a booking to a trip")
  .requiredOption("--trip <id>", "Trip ID")
  .requiredOption("--type <type>", "Type (flight|hotel|car|train|activity)")
  .option("--provider <provider>", "Provider name")
  .option("--confirmation <code>", "Confirmation code")
  .option("--check-in <date>", "Check-in date")
  .option("--check-out <date>", "Check-out date")
  .option("--cost <amount>", "Cost")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const booking = createBooking({
      trip_id: opts.trip,
      type: opts.type,
      provider: opts.provider,
      confirmation_code: opts.confirmation,
      check_in: opts.checkIn,
      check_out: opts.checkOut,
      cost: opts.cost ? parseFloat(opts.cost) : undefined,
    });

    if (opts.json) {
      console.log(JSON.stringify(booking, null, 2));
    } else {
      console.log(`Added ${booking.type} booking (${booking.id})`);
    }
  });

bookingCmd
  .command("list")
  .description("List bookings")
  .option("--trip <id>", "Filter by trip")
  .option("--type <type>", "Filter by type")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const bookings = listBookings({
      trip_id: opts.trip,
      type: opts.type,
    });

    if (opts.json) {
      console.log(JSON.stringify(bookings, null, 2));
    } else {
      if (bookings.length === 0) {
        console.log("No bookings found.");
        return;
      }
      for (const b of bookings) {
        const provider = b.provider ? ` via ${b.provider}` : "";
        const cost = b.cost !== null ? ` ($${b.cost})` : "";
        console.log(`  [${b.status}] ${b.type}${provider}${cost}`);
      }
      console.log(`\n${bookings.length} booking(s)`);
    }
  });

bookingCmd
  .command("cancel")
  .description("Cancel a booking")
  .argument("<id>", "Booking ID")
  .option("--json", "Output as JSON", false)
  .action((id, opts) => {
    const booking = cancelBooking(id);
    if (!booking) {
      console.error(`Booking '${id}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(booking, null, 2));
    } else {
      console.log(`Cancelled booking ${id}`);
    }
  });

// --- Documents ---

const docCmd = program
  .command("document")
  .alias("doc")
  .description("Travel document management");

docCmd
  .command("add")
  .description("Add a travel document")
  .requiredOption("--trip <id>", "Trip ID")
  .requiredOption("--type <type>", "Type (passport|visa|insurance|ticket|voucher)")
  .requiredOption("--name <name>", "Document name")
  .option("--number <number>", "Document number")
  .option("--expires <date>", "Expiry date (YYYY-MM-DD)")
  .option("--file <path>", "File path")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const doc = createDocument({
      trip_id: opts.trip,
      type: opts.type,
      name: opts.name,
      number: opts.number,
      expires_at: opts.expires,
      file_path: opts.file,
    });

    if (opts.json) {
      console.log(JSON.stringify(doc, null, 2));
    } else {
      console.log(`Added document: ${doc.name} (${doc.id})`);
    }
  });

docCmd
  .command("list")
  .description("List documents")
  .option("--trip <id>", "Filter by trip")
  .option("--type <type>", "Filter by type")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const docs = listDocuments({
      trip_id: opts.trip,
      type: opts.type,
    });

    if (opts.json) {
      console.log(JSON.stringify(docs, null, 2));
    } else {
      if (docs.length === 0) {
        console.log("No documents found.");
        return;
      }
      for (const d of docs) {
        const expires = d.expires_at ? ` (expires: ${d.expires_at})` : "";
        console.log(`  [${d.type}] ${d.name}${expires}`);
      }
      console.log(`\n${docs.length} document(s)`);
    }
  });

docCmd
  .command("expiring")
  .description("List documents expiring soon")
  .option("--days <n>", "Days ahead to check", "90")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const docs = getExpiringDocuments(parseInt(opts.days));

    if (opts.json) {
      console.log(JSON.stringify(docs, null, 2));
    } else {
      if (docs.length === 0) {
        console.log(`No documents expiring in the next ${opts.days} days.`);
        return;
      }
      for (const d of docs) {
        console.log(`  [${d.type}] ${d.name} — expires ${d.expires_at}`);
      }
    }
  });

// --- Loyalty Programs ---

const loyaltyCmd = program
  .command("loyalty")
  .description("Loyalty program management");

loyaltyCmd
  .command("add")
  .description("Add a loyalty program")
  .requiredOption("--program <name>", "Program name")
  .option("--member-id <id>", "Member ID")
  .option("--tier <tier>", "Tier level")
  .option("--points <n>", "Points")
  .option("--miles <n>", "Miles")
  .option("--expires <date>", "Expiry date")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const loyalty = createLoyaltyProgram({
      program_name: opts.program,
      member_id: opts.memberId,
      tier: opts.tier,
      points: opts.points ? parseInt(opts.points) : undefined,
      miles: opts.miles ? parseInt(opts.miles) : undefined,
      expires_at: opts.expires,
    });

    if (opts.json) {
      console.log(JSON.stringify(loyalty, null, 2));
    } else {
      console.log(`Added loyalty program: ${loyalty.program_name} (${loyalty.id})`);
    }
  });

loyaltyCmd
  .command("list")
  .description("List loyalty programs")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const programs = listLoyaltyPrograms();

    if (opts.json) {
      console.log(JSON.stringify(programs, null, 2));
    } else {
      if (programs.length === 0) {
        console.log("No loyalty programs found.");
        return;
      }
      for (const p of programs) {
        const tier = p.tier ? ` [${p.tier}]` : "";
        const pts = p.points > 0 ? ` ${p.points} pts` : "";
        const mi = p.miles > 0 ? ` ${p.miles} mi` : "";
        console.log(`  ${p.program_name}${tier}${pts}${mi}`);
      }
    }
  });

loyaltyCmd
  .command("summary")
  .description("Show loyalty points summary")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const summary = getLoyaltyPointsSummary();

    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`Total points: ${summary.total_points}`);
      console.log(`Total miles: ${summary.total_miles}`);
      if (summary.programs.length > 0) {
        console.log("\nPrograms:");
        for (const p of summary.programs) {
          const tier = p.tier ? ` [${p.tier}]` : "";
          console.log(`  ${p.program_name}${tier}: ${p.points} pts, ${p.miles} mi`);
        }
      }
    }
  });

// --- Special Commands ---

program
  .command("upcoming")
  .description("Show upcoming trips")
  .option("--days <n>", "Days ahead to check", "30")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const trips = getUpcomingTrips(parseInt(opts.days));

    if (opts.json) {
      console.log(JSON.stringify(trips, null, 2));
    } else {
      if (trips.length === 0) {
        console.log(`No upcoming trips in the next ${opts.days} days.`);
        return;
      }
      for (const t of trips) {
        const dest = t.destination ? ` -> ${t.destination}` : "";
        console.log(`  ${t.start_date}: ${t.name}${dest} [${t.status}]`);
      }
    }
  });

program
  .command("budget")
  .description("Show budget vs actual for a trip")
  .argument("<trip-id>", "Trip ID")
  .option("--json", "Output as JSON", false)
  .action((tripId, opts) => {
    const budget = getTripBudgetVsActual(tripId);
    if (!budget) {
      console.error(`Trip '${tripId}' not found.`);
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(budget, null, 2));
    } else {
      console.log(`${budget.trip_name}`);
      console.log(`  Budget: ${budget.currency} ${budget.budget ?? "N/A"}`);
      console.log(`  Spent: ${budget.currency} ${budget.spent}`);
      if (budget.remaining !== null) {
        console.log(`  Remaining: ${budget.currency} ${budget.remaining}`);
        if (budget.over_budget) console.log(`  ** OVER BUDGET **`);
      }
      if (Object.keys(budget.bookings_by_type).length > 0) {
        console.log("\n  By type:");
        for (const [type, cost] of Object.entries(budget.bookings_by_type)) {
          console.log(`    ${type}: ${budget.currency} ${cost}`);
        }
      }
    }
  });

program
  .command("stats")
  .description("Show travel statistics")
  .option("--year <year>", "Filter by year")
  .option("--json", "Output as JSON", false)
  .action((opts) => {
    const stats = getTravelStats(opts.year ? parseInt(opts.year) : undefined);

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(`Trips taken: ${stats.trips_taken}`);
      console.log(`Total spent: $${stats.total_spent}`);
      if (Object.keys(stats.by_destination).length > 0) {
        console.log("\nBy destination:");
        for (const [dest, count] of Object.entries(stats.by_destination)) {
          console.log(`  ${dest}: ${count} trip(s)`);
        }
      }
      if (Object.keys(stats.by_booking_type).length > 0) {
        console.log("\nBy booking type:");
        for (const [type, count] of Object.entries(stats.by_booking_type)) {
          console.log(`  ${type}: ${count}`);
        }
      }
    }
  });

program.parse(process.argv);
