import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateId,
  getMicroservicesDir,
  getServiceDataDir,
  getServiceDbPath,
  getHubAdapter,
  now,
  openServiceDatabase,
  type MigrationEntry,
} from "./database.js";

let tempDir: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "open-microservices-db-"));
  savedEnv = {
    HASNA_MICROSERVICES_DIR: process.env["HASNA_MICROSERVICES_DIR"],
    MICROSERVICES_DIR: process.env["MICROSERVICES_DIR"],
  };
  process.env["HASNA_MICROSERVICES_DIR"] = tempDir;
  delete process.env["MICROSERVICES_DIR"];
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("getMicroservicesDir", () => {
  test("returns HASNA_MICROSERVICES_DIR when set", () => {
    expect(getMicroservicesDir()).toBe(tempDir);
  });

  test("returns MICROSERVICES_DIR when HASNA_MICROSERVICES_DIR is unset", () => {
    delete process.env["HASNA_MICROSERVICES_DIR"];
    process.env["MICROSERVICES_DIR"] = tempDir;
    expect(getMicroservicesDir()).toBe(tempDir);
  });

  test("HASNA_MICROSERVICES_DIR takes precedence over MICROSERVICES_DIR", () => {
    const otherDir = mkdtempSync(join(tmpdir(), "other-"));
    try {
      process.env["MICROSERVICES_DIR"] = otherDir;
      expect(getMicroservicesDir()).toBe(tempDir);
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });

  test("finds nearest .microservices dir when no env var set", () => {
    delete process.env["HASNA_MICROSERVICES_DIR"];
    delete process.env["MICROSERVICES_DIR"];
    const projectDir = mkdtempSync(join(tmpdir(), "project-"));
    try {
      const msDir = join(projectDir, ".microservices");
      mkdirSync(msDir);
      const savedCwd = process.cwd();
      process.chdir(projectDir);
      try {
        expect(getMicroservicesDir()).toBe(msDir);
      } finally {
        process.chdir(savedCwd);
      }
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe("getServiceDataDir", () => {
  test("returns correct path with microservice- prefix", () => {
    const dir = getServiceDataDir("contacts");
    expect(dir).toBe(join(tempDir, "microservice-contacts"));
  });

  test("does not double-prefix if name already starts with microservice-", () => {
    const dir = getServiceDataDir("microservice-contacts");
    expect(dir).toBe(join(tempDir, "microservice-contacts"));
  });
});

describe("getServiceDbPath", () => {
  test("returns data.db inside service data dir", () => {
    const dbPath = getServiceDbPath("invoices");
    expect(dbPath).toBe(join(tempDir, "microservice-invoices", "data.db"));
  });
});

describe("openServiceDatabase", () => {
  const migrations: MigrationEntry[] = [
    {
      id: 1,
      name: "create_items",
      sql: "CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
    },
    {
      id: 2,
      name: "add_color",
      sql: "ALTER TABLE items ADD COLUMN color TEXT",
    },
  ];

  test("creates database file and runs migrations", () => {
    const db = openServiceDatabase("test-svc", migrations);
    const dbPath = getServiceDbPath("test-svc");
    expect(existsSync(dbPath)).toBe(true);

    // Migrations table should exist
    const rows = db.query("SELECT id, name FROM _migrations ORDER BY id").all() as {
      id: number;
      name: string;
    }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.name).toBe("create_items");
    expect(rows[1]!.name).toBe("add_color");

    // User table should exist
    db.exec("INSERT INTO items (id, name) VALUES ('1', 'apple')");
    const items = db.query("SELECT * FROM items").all() as { id: string; name: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("apple");
  });

  test("does not re-apply already-applied migrations", () => {
    openServiceDatabase("test-svc", migrations);
    // Open again — should not fail or duplicate
    const db2 = openServiceDatabase("test-svc", migrations);
    const rows = db2.query("SELECT COUNT(*) as c FROM _migrations").all() as { c: number }[];
    expect(rows[0]!.c).toBe(2);
  });

  test("throws on invalid migration SQL", () => {
    const bad: MigrationEntry[] = [{ id: 1, name: "bad", sql: "NOT VALID SQL !!!" }];
    expect(() => openServiceDatabase("bad-svc", bad)).toThrow();
  });

  test("empty migrations array creates only _migrations table", () => {
    const db = openServiceDatabase("empty-svc", []);
    const rows = db.query("SELECT COUNT(*) as c FROM _migrations").all() as { c: number }[];
    expect(rows[0]!.c).toBe(0);
  });
});

describe("getHubAdapter", () => {
  test("returns an adapter with feedback table", () => {
    const adapter = getHubAdapter();
    // Should be able to insert feedback
    adapter.run(
      "INSERT INTO feedback (id, message, category, version) VALUES (?, ?, ?, ?)",
      "test-id-" + Date.now(),
      "test message",
      "general",
      "0.0.1"
    );
    const rows = adapter.all("SELECT message FROM feedback WHERE message = 'test message'") as {
      message: string;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.message).toBe("test message");
  });
});

describe("generateId", () => {
  test("returns a non-empty string", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  test("returns unique values on each call", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateId()));
    expect(ids.size).toBe(20);
  });

  test("matches UUID format", () => {
    const id = generateId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});

describe("now", () => {
  test("returns an ISO datetime string", () => {
    const ts = now();
    expect(typeof ts).toBe("string");
    expect(() => new Date(ts)).not.toThrow();
    expect(new Date(ts).toISOString()).toBeTruthy();
  });

  test("is close to current time", () => {
    const before = Date.now();
    const ts = now();
    const after = Date.now();
    const parsed = new Date(ts).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after + 1000);
  });
});
