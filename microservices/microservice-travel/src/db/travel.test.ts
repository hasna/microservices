import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "microservice-travel-test-"));
process.env["MICROSERVICES_DIR"] = tempDir;

import {
  createTrip,
  getTrip,
  listTrips,
  updateTrip,
  deleteTrip,
  getUpcomingTrips,
  getTripBudgetVsActual,
  getTravelStats,
} from "./travel";
import {
  createBooking,
  getBooking,
  listBookings,
  cancelBooking,
  deleteBooking,
} from "./travel";
import {
  createDocument,
  getDocument,
  listDocuments,
  deleteDocument,
  getExpiringDocuments,
} from "./travel";
import {
  createLoyaltyProgram,
  getLoyaltyProgram,
  listLoyaltyPrograms,
  updateLoyaltyProgram,
  deleteLoyaltyProgram,
  getLoyaltyPointsSummary,
} from "./travel";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ==================== TRIPS ====================

describe("Trips", () => {
  test("create and get trip", () => {
    const trip = createTrip({
      name: "Paris Vacation",
      destination: "Paris, France",
      start_date: "2026-06-01",
      end_date: "2026-06-10",
      budget: 3000,
      currency: "EUR",
      notes: "Summer trip",
    });

    expect(trip.id).toBeTruthy();
    expect(trip.name).toBe("Paris Vacation");
    expect(trip.destination).toBe("Paris, France");
    expect(trip.status).toBe("planning");
    expect(trip.budget).toBe(3000);
    expect(trip.spent).toBe(0);
    expect(trip.currency).toBe("EUR");

    const fetched = getTrip(trip.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(trip.id);
    expect(fetched!.name).toBe("Paris Vacation");
  });

  test("create trip with minimal fields", () => {
    const trip = createTrip({ name: "Quick Trip" });
    expect(trip.name).toBe("Quick Trip");
    expect(trip.destination).toBeNull();
    expect(trip.status).toBe("planning");
    expect(trip.currency).toBe("USD");
    expect(trip.spent).toBe(0);
  });

  test("list trips", () => {
    const all = listTrips();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("list trips with status filter", () => {
    createTrip({ name: "Booked Trip", status: "booked" });
    const booked = listTrips({ status: "booked" });
    expect(booked.length).toBeGreaterThanOrEqual(1);
    expect(booked.every((t) => t.status === "booked")).toBe(true);
  });

  test("list trips with search", () => {
    const results = listTrips({ search: "Paris" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toContain("Paris");
  });

  test("list trips with destination filter", () => {
    const results = listTrips({ destination: "France" });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("update trip", () => {
    const trip = createTrip({ name: "Update Me" });
    const updated = updateTrip(trip.id, {
      name: "Updated Trip",
      destination: "London",
      status: "booked",
      budget: 2000,
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("Updated Trip");
    expect(updated!.destination).toBe("London");
    expect(updated!.status).toBe("booked");
    expect(updated!.budget).toBe(2000);
  });

  test("update non-existent trip returns null", () => {
    const result = updateTrip("non-existent-id", { name: "Nope" });
    expect(result).toBeNull();
  });

  test("delete trip", () => {
    const trip = createTrip({ name: "Delete Me" });
    expect(deleteTrip(trip.id)).toBe(true);
    expect(getTrip(trip.id)).toBeNull();
  });

  test("delete non-existent trip returns false", () => {
    expect(deleteTrip("non-existent-id")).toBe(false);
  });

  test("get non-existent trip returns null", () => {
    expect(getTrip("non-existent-id")).toBeNull();
  });
});

// ==================== BOOKINGS ====================

describe("Bookings", () => {
  test("create and get booking", () => {
    const trip = createTrip({ name: "Booking Trip", budget: 5000 });
    const booking = createBooking({
      trip_id: trip.id,
      type: "flight",
      provider: "Delta Airlines",
      confirmation_code: "ABC123",
      check_in: "2026-07-01",
      check_out: "2026-07-01",
      cost: 500,
    });

    expect(booking.id).toBeTruthy();
    expect(booking.trip_id).toBe(trip.id);
    expect(booking.type).toBe("flight");
    expect(booking.provider).toBe("Delta Airlines");
    expect(booking.confirmation_code).toBe("ABC123");
    expect(booking.status).toBe("confirmed");
    expect(booking.cost).toBe(500);

    const fetched = getBooking(booking.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(booking.id);

    // Trip spent should be updated
    const updatedTrip = getTrip(trip.id);
    expect(updatedTrip!.spent).toBe(500);
  });

  test("list bookings by trip", () => {
    const trip = createTrip({ name: "List Booking Trip" });
    createBooking({ trip_id: trip.id, type: "hotel", cost: 200 });
    createBooking({ trip_id: trip.id, type: "car", cost: 100 });

    const bookings = listBookings({ trip_id: trip.id });
    expect(bookings.length).toBe(2);
  });

  test("list bookings by type", () => {
    const all = listBookings({ type: "flight" });
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.every((b) => b.type === "flight")).toBe(true);
  });

  test("cancel booking restores trip spent", () => {
    const trip = createTrip({ name: "Cancel Trip", budget: 1000 });
    const booking = createBooking({
      trip_id: trip.id,
      type: "hotel",
      cost: 300,
    });

    expect(getTrip(trip.id)!.spent).toBe(300);

    const cancelled = cancelBooking(booking.id);
    expect(cancelled).toBeDefined();
    expect(cancelled!.status).toBe("cancelled");

    // Trip spent should be reduced
    expect(getTrip(trip.id)!.spent).toBe(0);
  });

  test("cancel non-existent booking returns null", () => {
    expect(cancelBooking("non-existent-id")).toBeNull();
  });

  test("delete booking restores trip spent", () => {
    const trip = createTrip({ name: "Delete Booking Trip" });
    const booking = createBooking({
      trip_id: trip.id,
      type: "train",
      cost: 150,
    });

    expect(getTrip(trip.id)!.spent).toBe(150);
    expect(deleteBooking(booking.id)).toBe(true);
    expect(getTrip(trip.id)!.spent).toBe(0);
  });

  test("delete non-existent booking returns false", () => {
    expect(deleteBooking("non-existent-id")).toBe(false);
  });
});

// ==================== DOCUMENTS ====================

describe("Documents", () => {
  test("create and get document", () => {
    const trip = createTrip({ name: "Doc Trip" });
    const doc = createDocument({
      trip_id: trip.id,
      type: "passport",
      name: "US Passport",
      number: "123456789",
      expires_at: "2030-01-15",
    });

    expect(doc.id).toBeTruthy();
    expect(doc.type).toBe("passport");
    expect(doc.name).toBe("US Passport");
    expect(doc.number).toBe("123456789");
    expect(doc.expires_at).toBe("2030-01-15");

    const fetched = getDocument(doc.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("US Passport");
  });

  test("list documents by trip", () => {
    const trip = createTrip({ name: "List Doc Trip" });
    createDocument({ trip_id: trip.id, type: "visa", name: "France Visa" });
    createDocument({ trip_id: trip.id, type: "insurance", name: "Travel Insurance" });

    const docs = listDocuments({ trip_id: trip.id });
    expect(docs.length).toBe(2);
  });

  test("list documents by type", () => {
    const all = listDocuments({ type: "passport" });
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.every((d) => d.type === "passport")).toBe(true);
  });

  test("delete document", () => {
    const trip = createTrip({ name: "Del Doc Trip" });
    const doc = createDocument({
      trip_id: trip.id,
      type: "ticket",
      name: "Delete Me",
    });

    expect(deleteDocument(doc.id)).toBe(true);
    expect(getDocument(doc.id)).toBeNull();
  });

  test("delete non-existent document returns false", () => {
    expect(deleteDocument("non-existent-id")).toBe(false);
  });

  test("get non-existent document returns null", () => {
    expect(getDocument("non-existent-id")).toBeNull();
  });
});

// ==================== LOYALTY PROGRAMS ====================

describe("Loyalty Programs", () => {
  test("create and get loyalty program", () => {
    const lp = createLoyaltyProgram({
      program_name: "Delta SkyMiles",
      member_id: "SKY123",
      tier: "Gold",
      points: 5000,
      miles: 25000,
    });

    expect(lp.id).toBeTruthy();
    expect(lp.program_name).toBe("Delta SkyMiles");
    expect(lp.member_id).toBe("SKY123");
    expect(lp.tier).toBe("Gold");
    expect(lp.points).toBe(5000);
    expect(lp.miles).toBe(25000);

    const fetched = getLoyaltyProgram(lp.id);
    expect(fetched).toBeDefined();
    expect(fetched!.program_name).toBe("Delta SkyMiles");
  });

  test("list loyalty programs", () => {
    createLoyaltyProgram({ program_name: "Hilton Honors", points: 10000 });
    const all = listLoyaltyPrograms();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  test("update loyalty program", () => {
    const lp = createLoyaltyProgram({ program_name: "Update Program" });
    const updated = updateLoyaltyProgram(lp.id, {
      tier: "Platinum",
      points: 50000,
      miles: 100000,
    });

    expect(updated).toBeDefined();
    expect(updated!.tier).toBe("Platinum");
    expect(updated!.points).toBe(50000);
    expect(updated!.miles).toBe(100000);
  });

  test("update non-existent loyalty program returns null", () => {
    expect(updateLoyaltyProgram("non-existent", { tier: "x" })).toBeNull();
  });

  test("delete loyalty program", () => {
    const lp = createLoyaltyProgram({ program_name: "Delete Program" });
    expect(deleteLoyaltyProgram(lp.id)).toBe(true);
    expect(getLoyaltyProgram(lp.id)).toBeNull();
  });

  test("delete non-existent loyalty program returns false", () => {
    expect(deleteLoyaltyProgram("non-existent")).toBe(false);
  });

  test("get non-existent loyalty program returns null", () => {
    expect(getLoyaltyProgram("non-existent")).toBeNull();
  });
});

// ==================== SPECIAL QUERIES ====================

describe("Special Queries", () => {
  test("get upcoming trips", () => {
    // Create a trip starting tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    createTrip({
      name: "Tomorrow Trip",
      start_date: tomorrowStr,
      status: "booked",
    });

    const upcoming = getUpcomingTrips(7);
    expect(upcoming.length).toBeGreaterThanOrEqual(1);
    expect(upcoming.some((t) => t.name === "Tomorrow Trip")).toBe(true);
  });

  test("get upcoming trips excludes completed", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const dateStr = tomorrow.toISOString().split("T")[0];

    createTrip({
      name: "Completed Trip",
      start_date: dateStr,
      status: "completed",
    });

    const upcoming = getUpcomingTrips(7);
    expect(upcoming.every((t) => t.name !== "Completed Trip")).toBe(true);
  });

  test("get trip budget vs actual", () => {
    const trip = createTrip({ name: "Budget Trip", budget: 5000, currency: "USD" });
    createBooking({ trip_id: trip.id, type: "flight", cost: 800 });
    createBooking({ trip_id: trip.id, type: "hotel", cost: 1200 });

    const budget = getTripBudgetVsActual(trip.id);
    expect(budget).toBeDefined();
    expect(budget!.trip_name).toBe("Budget Trip");
    expect(budget!.budget).toBe(5000);
    expect(budget!.spent).toBe(2000);
    expect(budget!.remaining).toBe(3000);
    expect(budget!.over_budget).toBe(false);
    expect(budget!.bookings_by_type["flight"]).toBe(800);
    expect(budget!.bookings_by_type["hotel"]).toBe(1200);
  });

  test("get trip budget vs actual returns null for non-existent trip", () => {
    expect(getTripBudgetVsActual("non-existent")).toBeNull();
  });

  test("get expiring documents", () => {
    const trip = createTrip({ name: "Expiring Doc Trip" });

    // Create a document expiring in 30 days
    const in30Days = new Date();
    in30Days.setDate(in30Days.getDate() + 30);
    const expiryStr = in30Days.toISOString().split("T")[0];

    createDocument({
      trip_id: trip.id,
      type: "passport",
      name: "Expiring Passport",
      expires_at: expiryStr,
    });

    const expiring = getExpiringDocuments(60);
    expect(expiring.length).toBeGreaterThanOrEqual(1);
    expect(expiring.some((d) => d.name === "Expiring Passport")).toBe(true);
  });

  test("get loyalty points summary", () => {
    const summary = getLoyaltyPointsSummary();
    expect(summary.total_points).toBeGreaterThanOrEqual(0);
    expect(summary.total_miles).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(summary.programs)).toBe(true);
  });

  test("get travel stats", () => {
    // Create a completed trip
    const trip = createTrip({
      name: "Stats Trip",
      destination: "Tokyo",
      start_date: "2026-01-15",
      status: "completed",
    });
    updateTrip(trip.id, { spent: 2500 });
    createBooking({ trip_id: trip.id, type: "flight", cost: 0 }); // cost already counted in spent

    const stats = getTravelStats();
    expect(stats.trips_taken).toBeGreaterThanOrEqual(1);
    expect(stats.total_spent).toBeGreaterThanOrEqual(0);
    expect(typeof stats.by_destination).toBe("object");
    expect(typeof stats.by_booking_type).toBe("object");
  });

  test("get travel stats filtered by year", () => {
    const stats = getTravelStats(2026);
    expect(stats.trips_taken).toBeGreaterThanOrEqual(0);
    expect(typeof stats.by_destination).toBe("object");
  });

  test("cascade delete removes bookings and documents", () => {
    const trip = createTrip({ name: "Cascade Trip" });
    const booking = createBooking({ trip_id: trip.id, type: "hotel", cost: 100 });
    const doc = createDocument({ trip_id: trip.id, type: "ticket", name: "Ticket" });

    deleteTrip(trip.id);

    expect(getBooking(booking.id)).toBeNull();
    expect(getDocument(doc.id)).toBeNull();
  });
});
