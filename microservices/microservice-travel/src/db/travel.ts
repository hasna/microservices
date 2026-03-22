/**
 * Travel CRUD operations — trips, bookings, documents, loyalty programs
 */

import { getDatabase } from "./database.js";

// ==================== TRIPS ====================

export interface Trip {
  id: string;
  name: string;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  budget: number | null;
  spent: number;
  currency: string;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface TripRow {
  id: string;
  name: string;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  budget: number | null;
  spent: number;
  currency: string;
  notes: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToTrip(row: TripRow): Trip {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreateTripInput {
  name: string;
  destination?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  budget?: number;
  currency?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export function createTrip(input: CreateTripInput): Trip {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO trips (id, name, destination, start_date, end_date, status, budget, currency, notes, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.destination || null,
    input.start_date || null,
    input.end_date || null,
    input.status || "planning",
    input.budget ?? null,
    input.currency || "USD",
    input.notes || null,
    metadata
  );

  return getTrip(id)!;
}

export function getTrip(id: string): Trip | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM trips WHERE id = ?").get(id) as TripRow | null;
  return row ? rowToTrip(row) : null;
}

export interface ListTripsOptions {
  search?: string;
  status?: string;
  destination?: string;
  limit?: number;
  offset?: number;
}

export function listTrips(options: ListTripsOptions = {}): Trip[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    conditions.push("(name LIKE ? OR destination LIKE ? OR notes LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q);
  }

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  if (options.destination) {
    conditions.push("destination LIKE ?");
    params.push(`%${options.destination}%`);
  }

  let sql = "SELECT * FROM trips";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY start_date DESC, created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  if (options.offset) {
    sql += " OFFSET ?";
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as TripRow[];
  return rows.map(rowToTrip);
}

export interface UpdateTripInput {
  name?: string;
  destination?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  budget?: number;
  spent?: number;
  currency?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export function updateTrip(id: string, input: UpdateTripInput): Trip | null {
  const db = getDatabase();
  const existing = getTrip(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.destination !== undefined) {
    sets.push("destination = ?");
    params.push(input.destination);
  }
  if (input.start_date !== undefined) {
    sets.push("start_date = ?");
    params.push(input.start_date);
  }
  if (input.end_date !== undefined) {
    sets.push("end_date = ?");
    params.push(input.end_date);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    params.push(input.status);
  }
  if (input.budget !== undefined) {
    sets.push("budget = ?");
    params.push(input.budget);
  }
  if (input.spent !== undefined) {
    sets.push("spent = ?");
    params.push(input.spent);
  }
  if (input.currency !== undefined) {
    sets.push("currency = ?");
    params.push(input.currency);
  }
  if (input.notes !== undefined) {
    sets.push("notes = ?");
    params.push(input.notes);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE trips SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getTrip(id);
}

export function deleteTrip(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM trips WHERE id = ?").run(id);
  return result.changes > 0;
}

// ==================== BOOKINGS ====================

export interface Booking {
  id: string;
  trip_id: string;
  type: string;
  provider: string | null;
  confirmation_code: string | null;
  status: string;
  check_in: string | null;
  check_out: string | null;
  cost: number | null;
  details: Record<string, unknown>;
  created_at: string;
}

interface BookingRow {
  id: string;
  trip_id: string;
  type: string;
  provider: string | null;
  confirmation_code: string | null;
  status: string;
  check_in: string | null;
  check_out: string | null;
  cost: number | null;
  details: string;
  created_at: string;
}

function rowToBooking(row: BookingRow): Booking {
  return {
    ...row,
    details: JSON.parse(row.details || "{}"),
  };
}

export interface CreateBookingInput {
  trip_id: string;
  type: string;
  provider?: string;
  confirmation_code?: string;
  status?: string;
  check_in?: string;
  check_out?: string;
  cost?: number;
  details?: Record<string, unknown>;
}

export function createBooking(input: CreateBookingInput): Booking {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const details = JSON.stringify(input.details || {});

  db.prepare(
    `INSERT INTO bookings (id, trip_id, type, provider, confirmation_code, status, check_in, check_out, cost, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.trip_id,
    input.type,
    input.provider || null,
    input.confirmation_code || null,
    input.status || "confirmed",
    input.check_in || null,
    input.check_out || null,
    input.cost ?? null,
    details
  );

  // Update trip spent
  if (input.cost && input.cost > 0) {
    db.prepare(
      "UPDATE trips SET spent = spent + ?, updated_at = datetime('now') WHERE id = ?"
    ).run(input.cost, input.trip_id);
  }

  return getBooking(id)!;
}

export function getBooking(id: string): Booking | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as BookingRow | null;
  return row ? rowToBooking(row) : null;
}

export interface ListBookingsOptions {
  trip_id?: string;
  type?: string;
  status?: string;
  limit?: number;
}

export function listBookings(options: ListBookingsOptions = {}): Booking[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.trip_id) {
    conditions.push("trip_id = ?");
    params.push(options.trip_id);
  }
  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }
  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }

  let sql = "SELECT * FROM bookings";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY check_in ASC, created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  const rows = db.prepare(sql).all(...params) as BookingRow[];
  return rows.map(rowToBooking);
}

export function cancelBooking(id: string): Booking | null {
  const db = getDatabase();
  const existing = getBooking(id);
  if (!existing) return null;

  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id);

  // Subtract cost from trip spent if booking had a cost
  if (existing.cost && existing.cost > 0 && existing.status !== "cancelled") {
    db.prepare(
      "UPDATE trips SET spent = MAX(0, spent - ?), updated_at = datetime('now') WHERE id = ?"
    ).run(existing.cost, existing.trip_id);
  }

  return getBooking(id);
}

export function deleteBooking(id: string): boolean {
  const db = getDatabase();
  const existing = getBooking(id);
  if (!existing) return false;

  // Subtract cost from trip spent if booking was not cancelled
  if (existing.cost && existing.cost > 0 && existing.status !== "cancelled") {
    db.prepare(
      "UPDATE trips SET spent = MAX(0, spent - ?), updated_at = datetime('now') WHERE id = ?"
    ).run(existing.cost, existing.trip_id);
  }

  const result = db.prepare("DELETE FROM bookings WHERE id = ?").run(id);
  return result.changes > 0;
}

// ==================== DOCUMENTS ====================

export interface TravelDocument {
  id: string;
  trip_id: string;
  type: string;
  name: string;
  number: string | null;
  expires_at: string | null;
  file_path: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface TravelDocumentRow {
  id: string;
  trip_id: string;
  type: string;
  name: string;
  number: string | null;
  expires_at: string | null;
  file_path: string | null;
  metadata: string;
  created_at: string;
}

function rowToDocument(row: TravelDocumentRow): TravelDocument {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreateDocumentInput {
  trip_id: string;
  type: string;
  name: string;
  number?: string;
  expires_at?: string;
  file_path?: string;
  metadata?: Record<string, unknown>;
}

export function createDocument(input: CreateDocumentInput): TravelDocument {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO documents (id, trip_id, type, name, number, expires_at, file_path, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.trip_id,
    input.type,
    input.name,
    input.number || null,
    input.expires_at || null,
    input.file_path || null,
    metadata
  );

  return getDocument(id)!;
}

export function getDocument(id: string): TravelDocument | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as TravelDocumentRow | null;
  return row ? rowToDocument(row) : null;
}

export interface ListDocumentsOptions {
  trip_id?: string;
  type?: string;
  limit?: number;
}

export function listDocuments(options: ListDocumentsOptions = {}): TravelDocument[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.trip_id) {
    conditions.push("trip_id = ?");
    params.push(options.trip_id);
  }
  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }

  let sql = "SELECT * FROM documents";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY expires_at ASC, created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  const rows = db.prepare(sql).all(...params) as TravelDocumentRow[];
  return rows.map(rowToDocument);
}

export function deleteDocument(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  return result.changes > 0;
}

// ==================== LOYALTY PROGRAMS ====================

export interface LoyaltyProgram {
  id: string;
  program_name: string;
  member_id: string | null;
  tier: string | null;
  points: number;
  miles: number;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface LoyaltyProgramRow {
  id: string;
  program_name: string;
  member_id: string | null;
  tier: string | null;
  points: number;
  miles: number;
  expires_at: string | null;
  metadata: string;
  created_at: string;
}

function rowToLoyalty(row: LoyaltyProgramRow): LoyaltyProgram {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreateLoyaltyInput {
  program_name: string;
  member_id?: string;
  tier?: string;
  points?: number;
  miles?: number;
  expires_at?: string;
  metadata?: Record<string, unknown>;
}

export function createLoyaltyProgram(input: CreateLoyaltyInput): LoyaltyProgram {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO loyalty_programs (id, program_name, member_id, tier, points, miles, expires_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.program_name,
    input.member_id || null,
    input.tier || null,
    input.points ?? 0,
    input.miles ?? 0,
    input.expires_at || null,
    metadata
  );

  return getLoyaltyProgram(id)!;
}

export function getLoyaltyProgram(id: string): LoyaltyProgram | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM loyalty_programs WHERE id = ?").get(id) as LoyaltyProgramRow | null;
  return row ? rowToLoyalty(row) : null;
}

export function listLoyaltyPrograms(): LoyaltyProgram[] {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM loyalty_programs ORDER BY program_name").all() as LoyaltyProgramRow[];
  return rows.map(rowToLoyalty);
}

export interface UpdateLoyaltyInput {
  program_name?: string;
  member_id?: string;
  tier?: string;
  points?: number;
  miles?: number;
  expires_at?: string;
  metadata?: Record<string, unknown>;
}

export function updateLoyaltyProgram(id: string, input: UpdateLoyaltyInput): LoyaltyProgram | null {
  const db = getDatabase();
  const existing = getLoyaltyProgram(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.program_name !== undefined) {
    sets.push("program_name = ?");
    params.push(input.program_name);
  }
  if (input.member_id !== undefined) {
    sets.push("member_id = ?");
    params.push(input.member_id);
  }
  if (input.tier !== undefined) {
    sets.push("tier = ?");
    params.push(input.tier);
  }
  if (input.points !== undefined) {
    sets.push("points = ?");
    params.push(input.points);
  }
  if (input.miles !== undefined) {
    sets.push("miles = ?");
    params.push(input.miles);
  }
  if (input.expires_at !== undefined) {
    sets.push("expires_at = ?");
    params.push(input.expires_at);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  params.push(id);
  db.prepare(
    `UPDATE loyalty_programs SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);

  return getLoyaltyProgram(id);
}

export function deleteLoyaltyProgram(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM loyalty_programs WHERE id = ?").run(id);
  return result.changes > 0;
}

// ==================== SPECIAL QUERIES ====================

export function getUpcomingTrips(days: number = 30): Trip[] {
  const db = getDatabase();
  const rows = db.prepare(
    `SELECT * FROM trips
     WHERE start_date IS NOT NULL
       AND start_date >= date('now')
       AND start_date <= date('now', '+' || ? || ' days')
       AND status NOT IN ('completed', 'cancelled')
     ORDER BY start_date ASC`
  ).all(days) as TripRow[];
  return rows.map(rowToTrip);
}

export interface BudgetVsActual {
  trip_id: string;
  trip_name: string;
  budget: number | null;
  spent: number;
  currency: string;
  remaining: number | null;
  over_budget: boolean;
  bookings_by_type: Record<string, number>;
}

export function getTripBudgetVsActual(tripId: string): BudgetVsActual | null {
  const db = getDatabase();
  const trip = getTrip(tripId);
  if (!trip) return null;

  const bookingCosts = db.prepare(
    `SELECT type, SUM(cost) as total_cost
     FROM bookings
     WHERE trip_id = ? AND status != 'cancelled'
     GROUP BY type`
  ).all(tripId) as { type: string; total_cost: number }[];

  const bookings_by_type: Record<string, number> = {};
  for (const row of bookingCosts) {
    bookings_by_type[row.type] = row.total_cost;
  }

  return {
    trip_id: trip.id,
    trip_name: trip.name,
    budget: trip.budget,
    spent: trip.spent,
    currency: trip.currency,
    remaining: trip.budget !== null ? trip.budget - trip.spent : null,
    over_budget: trip.budget !== null ? trip.spent > trip.budget : false,
    bookings_by_type,
  };
}

export function getExpiringDocuments(days: number = 90): TravelDocument[] {
  const db = getDatabase();
  const rows = db.prepare(
    `SELECT * FROM documents
     WHERE expires_at IS NOT NULL
       AND expires_at >= date('now')
       AND expires_at <= date('now', '+' || ? || ' days')
     ORDER BY expires_at ASC`
  ).all(days) as TravelDocumentRow[];
  return rows.map(rowToDocument);
}

export interface LoyaltyPointsSummary {
  total_points: number;
  total_miles: number;
  programs: Array<{
    program_name: string;
    member_id: string | null;
    tier: string | null;
    points: number;
    miles: number;
    expires_at: string | null;
  }>;
}

export function getLoyaltyPointsSummary(): LoyaltyPointsSummary {
  const db = getDatabase();
  const rows = db.prepare(
    "SELECT program_name, member_id, tier, points, miles, expires_at FROM loyalty_programs ORDER BY program_name"
  ).all() as Array<{
    program_name: string;
    member_id: string | null;
    tier: string | null;
    points: number;
    miles: number;
    expires_at: string | null;
  }>;

  let total_points = 0;
  let total_miles = 0;
  for (const r of rows) {
    total_points += r.points;
    total_miles += r.miles;
  }

  return {
    total_points,
    total_miles,
    programs: rows,
  };
}

export interface TravelStats {
  trips_taken: number;
  total_spent: number;
  by_destination: Record<string, number>;
  by_booking_type: Record<string, number>;
}

export function getTravelStats(year?: number): TravelStats {
  const db = getDatabase();

  let tripCondition = "status = 'completed'";
  const tripParams: unknown[] = [];
  if (year) {
    tripCondition += " AND strftime('%Y', start_date) = ?";
    tripParams.push(String(year));
  }

  const tripCount = db.prepare(
    `SELECT COUNT(*) as count FROM trips WHERE ${tripCondition}`
  ).get(...tripParams) as { count: number };

  const totalSpent = db.prepare(
    `SELECT COALESCE(SUM(spent), 0) as total FROM trips WHERE ${tripCondition}`
  ).get(...tripParams) as { total: number };

  // By destination
  const destRows = db.prepare(
    `SELECT destination, COUNT(*) as count FROM trips
     WHERE ${tripCondition} AND destination IS NOT NULL
     GROUP BY destination ORDER BY count DESC`
  ).all(...tripParams) as { destination: string; count: number }[];

  const by_destination: Record<string, number> = {};
  for (const row of destRows) {
    by_destination[row.destination] = row.count;
  }

  // By booking type — join with trips for year filter
  let bookingQuery: string;
  const bookingParams: unknown[] = [];
  if (year) {
    bookingQuery = `SELECT b.type, COUNT(*) as count FROM bookings b
      JOIN trips t ON b.trip_id = t.id
      WHERE t.status = 'completed' AND strftime('%Y', t.start_date) = ? AND b.status != 'cancelled'
      GROUP BY b.type ORDER BY count DESC`;
    bookingParams.push(String(year));
  } else {
    bookingQuery = `SELECT b.type, COUNT(*) as count FROM bookings b
      JOIN trips t ON b.trip_id = t.id
      WHERE t.status = 'completed' AND b.status != 'cancelled'
      GROUP BY b.type ORDER BY count DESC`;
  }

  const bookingRows = db.prepare(bookingQuery).all(...bookingParams) as { type: string; count: number }[];

  const by_booking_type: Record<string, number> = {};
  for (const row of bookingRows) {
    by_booking_type[row.type] = row.count;
  }

  return {
    trips_taken: tripCount.count,
    total_spent: totalSpent.total,
    by_destination,
    by_booking_type,
  };
}
