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
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        department TEXT,
        location TEXT,
        type TEXT NOT NULL DEFAULT 'full-time' CHECK (type IN ('full-time', 'part-time', 'contract')),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'paused')),
        description TEXT,
        requirements TEXT NOT NULL DEFAULT '[]',
        salary_range TEXT,
        posted_at TEXT,
        closed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS applicants (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        resume_url TEXT,
        status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'screening', 'interviewing', 'offered', 'hired', 'rejected')),
        stage TEXT,
        rating INTEGER,
        notes TEXT,
        source TEXT,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')),
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS interviews (
        id TEXT PRIMARY KEY,
        applicant_id TEXT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
        interviewer TEXT,
        scheduled_at TEXT,
        duration_min INTEGER,
        type TEXT NOT NULL DEFAULT 'phone' CHECK (type IN ('phone', 'video', 'onsite')),
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'canceled')),
        feedback TEXT,
        rating INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_department ON jobs(department);
      CREATE INDEX IF NOT EXISTS idx_applicants_job_id ON applicants(job_id);
      CREATE INDEX IF NOT EXISTS idx_applicants_status ON applicants(status);
      CREATE INDEX IF NOT EXISTS idx_applicants_email ON applicants(email);
      CREATE INDEX IF NOT EXISTS idx_interviews_applicant_id ON interviews(applicant_id);
      CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status);
    `,
  },
];
