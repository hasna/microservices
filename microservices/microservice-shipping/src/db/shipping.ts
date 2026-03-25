/**
 * Shipping CRUD operations — barrel re-export
 *
 * All exports are preserved for backward compatibility.
 * Implementation is split across:
 *   - orders.ts    — Order types, CRUD, bulk import/export, timeline
 *   - shipments.ts — Shipment types, CRUD, overdue alerts
 *   - returns.ts   — Return types, CRUD
 *   - analytics.ts — Stats, carrier performance, cost optimizer, customer history
 */

export * from "./orders.js";
export * from "./shipments.js";
export * from "./returns.js";
export * from "./analytics.js";
