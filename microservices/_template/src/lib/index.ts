/**
 * microservice-__name__ — core library (embed-first).
 *
 * Import this in your app to use __Name__ functionality directly
 * against your existing PostgreSQL connection.
 *
 * Example:
 *   import { create__Name__, list__Name__s } from '@hasna/microservice-__name__'
 *   await migrate(sql)
 *   const record = await create__Name__(sql, { ... })
 */

export { closeDb, getDb } from "../db/client.js";
export { migrate } from "../db/migrations.js";

// Export your core functions here
// export { createRecord, getRecord, listRecords, updateRecord, deleteRecord } from './records.js'
