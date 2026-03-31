/**
 * microservice-NAME — core library (embed-first).
 *
 * Import this in your app to use NAME functionality directly
 * against your existing PostgreSQL connection.
 *
 * Example:
 *   import { createName, listNames } from '@hasna/microservice-name'
 *   await migrate(sql)
 *   const record = await createName(sql, { ... })
 */

export { migrate } from "../db/migrations.js";
export { getDb, closeDb } from "../db/client.js";

// Export your core functions here
// export { createRecord, getRecord, listRecords, updateRecord, deleteRecord } from './records.js'
