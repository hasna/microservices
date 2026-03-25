/**
 * Bulk import/export for subscribers
 */

import { createSubscriber, listSubscribers, Subscriber } from "./subscribers.js";

// --- Types ---

export interface BulkImportSubscriberInput {
  plan_id: string;
  customer_name: string;
  customer_email: string;
  status?: Subscriber["status"];
  trial_ends_at?: string;
  current_period_end?: string;
  metadata?: Record<string, unknown>;
}

// --- Bulk Operations ---

export function bulkImportSubscribers(data: BulkImportSubscriberInput[]): Subscriber[] {
  const results: Subscriber[] = [];
  for (const item of data) {
    const subscriber = createSubscriber(item);
    results.push(subscriber);
  }
  return results;
}

export function exportSubscribers(format: "csv" | "json" = "json"): string {
  const subscribers = listSubscribers();

  if (format === "json") {
    return JSON.stringify(subscribers, null, 2);
  }

  // CSV format
  if (subscribers.length === 0) return "";

  const headers = [
    "id", "plan_id", "customer_name", "customer_email", "status",
    "started_at", "trial_ends_at", "current_period_start", "current_period_end",
    "canceled_at", "resume_at", "created_at", "updated_at",
  ];

  const csvRows = [headers.join(",")];
  for (const sub of subscribers) {
    const row = headers.map((h) => {
      const val = sub[h as keyof Subscriber];
      if (val === null || val === undefined) return "";
      if (typeof val === "object") return JSON.stringify(val).replace(/,/g, ";");
      return String(val).includes(",") ? `"${String(val)}"` : String(val);
    });
    csvRows.push(row.join(","));
  }
  return csvRows.join("\n");
}

export function parseImportCsv(csvContent: string): BulkImportSubscriberInput[] {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  const results: BulkImportSubscriberInput[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const record: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j] || "";
    }

    if (!record["plan_id"] || !record["customer_name"] || !record["customer_email"]) continue;

    results.push({
      plan_id: record["plan_id"],
      customer_name: record["customer_name"],
      customer_email: record["customer_email"],
      status: (record["status"] as Subscriber["status"]) || undefined,
      trial_ends_at: record["trial_ends_at"] || undefined,
      current_period_end: record["current_period_end"] || undefined,
    });
  }

  return results;
}
