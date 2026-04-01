import postgres from "postgres";

let _client: ReturnType<typeof postgres> | null = null;
export function getDb(url?: string): ReturnType<typeof postgres> {
  if (_client) return _client;
  const conn = url ?? process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL required");
  _client = postgres(conn, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return _client;
}
export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end();
    _client = null;
  }
}
