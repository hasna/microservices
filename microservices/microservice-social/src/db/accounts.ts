/**
 * Account CRUD operations
 */

import { getDatabase } from "./database.js";
import { PLATFORM_LIMITS } from "./types.js";
import type { Platform, PlatformLimitWarning } from "./types.js";

export interface Account {
  id: string;
  platform: Platform;
  handle: string;
  display_name: string | null;
  connected: boolean;
  access_token_env: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface AccountRow {
  id: string;
  platform: string;
  handle: string;
  display_name: string | null;
  connected: number;
  access_token_env: string | null;
  metadata: string;
  created_at: string;
}

function rowToAccount(row: AccountRow): Account {
  return {
    ...row,
    platform: row.platform as Platform,
    connected: row.connected === 1,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface CreateAccountInput {
  platform: Platform;
  handle: string;
  display_name?: string;
  connected?: boolean;
  access_token_env?: string;
  metadata?: Record<string, unknown>;
}

export function createAccount(input: CreateAccountInput): Account {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const metadata = JSON.stringify(input.metadata || {});

  db.prepare(
    `INSERT INTO accounts (id, platform, handle, display_name, connected, access_token_env, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.platform,
    input.handle,
    input.display_name || null,
    input.connected ? 1 : 0,
    input.access_token_env || null,
    metadata
  );

  return getAccount(id)!;
}

export function getAccount(id: string): Account | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | null;
  return row ? rowToAccount(row) : null;
}

export interface ListAccountsOptions {
  platform?: Platform;
  connected?: boolean;
  limit?: number;
}

export function listAccounts(options: ListAccountsOptions = {}): Account[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.platform) {
    conditions.push("platform = ?");
    params.push(options.platform);
  }

  if (options.connected !== undefined) {
    conditions.push("connected = ?");
    params.push(options.connected ? 1 : 0);
  }

  let sql = "SELECT * FROM accounts";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  const rows = db.prepare(sql).all(...params) as AccountRow[];
  return rows.map(rowToAccount);
}

export interface UpdateAccountInput {
  platform?: Platform;
  handle?: string;
  display_name?: string;
  connected?: boolean;
  access_token_env?: string;
  metadata?: Record<string, unknown>;
}

export function updateAccount(id: string, input: UpdateAccountInput): Account | null {
  const db = getDatabase();
  const existing = getAccount(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.platform !== undefined) {
    sets.push("platform = ?");
    params.push(input.platform);
  }
  if (input.handle !== undefined) {
    sets.push("handle = ?");
    params.push(input.handle);
  }
  if (input.display_name !== undefined) {
    sets.push("display_name = ?");
    params.push(input.display_name);
  }
  if (input.connected !== undefined) {
    sets.push("connected = ?");
    params.push(input.connected ? 1 : 0);
  }
  if (input.access_token_env !== undefined) {
    sets.push("access_token_env = ?");
    params.push(input.access_token_env);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) return existing;

  params.push(id);
  db.prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getAccount(id);
}

export function deleteAccount(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  return result.changes > 0;
}

export function countAccounts(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as count FROM accounts").get() as { count: number };
  return row.count;
}

/**
 * Check if content exceeds platform character limit for a given account
 */
export function checkPlatformLimit(content: string, accountId: string): PlatformLimitWarning | null {
  const account = getAccount(accountId);
  if (!account) return null;

  const limit = PLATFORM_LIMITS[account.platform];
  if (content.length > limit) {
    return {
      platform: account.platform,
      limit,
      content_length: content.length,
      over_by: content.length - limit,
    };
  }
  return null;
}
