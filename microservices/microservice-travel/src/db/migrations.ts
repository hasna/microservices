export interface MigrationEntry {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: MigrationEntry[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS trips (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        destination TEXT,
        start_date TEXT,
        end_date TEXT,
        status TEXT NOT NULL DEFAULT 'planning' CHECK(status IN ('planning','booked','in_progress','completed','cancelled')),
        budget REAL,
        spent REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        notes TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('flight','hotel','car','train','activity')),
        provider TEXT,
        confirmation_code TEXT,
        status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','pending','cancelled')),
        check_in TEXT,
        check_out TEXT,
        cost REAL,
        details TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('passport','visa','insurance','ticket','voucher')),
        name TEXT NOT NULL,
        number TEXT,
        expires_at TEXT,
        file_path TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS loyalty_programs (
        id TEXT PRIMARY KEY,
        program_name TEXT NOT NULL,
        member_id TEXT,
        tier TEXT,
        points INTEGER NOT NULL DEFAULT 0,
        miles INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
      CREATE INDEX IF NOT EXISTS idx_trips_destination ON trips(destination);
      CREATE INDEX IF NOT EXISTS idx_trips_start_date ON trips(start_date);
      CREATE INDEX IF NOT EXISTS idx_bookings_trip ON bookings(trip_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_type ON bookings(type);
      CREATE INDEX IF NOT EXISTS idx_documents_trip ON documents(trip_id);
      CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
      CREATE INDEX IF NOT EXISTS idx_documents_expires ON documents(expires_at);
      CREATE INDEX IF NOT EXISTS idx_loyalty_program_name ON loyalty_programs(program_name);
    `,
  },
];
