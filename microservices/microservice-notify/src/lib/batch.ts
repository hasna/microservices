import type { Sql } from "postgres";

export interface BatchNotification {
  userId: string;
  workspaceId?: string;
  channel: "email" | "sms" | "in_app" | "webhook";
  type: string;
  title?: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface BatchResult {
  index: number;
  userId: string;
  success: boolean;
  error?: string;
}

export async function sendBatch(sql: Sql, notifications: BatchNotification[]): Promise<BatchResult[]> {
  const { sendNotification } = await import("./send.js");
  const results: BatchResult[] = [];
  await Promise.allSettled(
    notifications.map(async (n, i) => {
      try {
        await sendNotification(sql, n);
        results[i] = { index: i, userId: n.userId, success: true };
      } catch (e) {
        results[i] = { index: i, userId: n.userId, success: false, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );
  return results.filter(Boolean);
}
