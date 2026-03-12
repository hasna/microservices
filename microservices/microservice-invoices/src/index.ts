/**
 * microservice-invoices — Invoice management microservice
 */

export {
  createInvoice,
  getInvoice,
  getInvoiceWithItems,
  listInvoices,
  updateInvoiceStatus,
  deleteInvoice,
  addLineItem,
  removeLineItem,
  recordPayment,
  getInvoiceSummary,
  type Invoice,
  type InvoiceWithItems,
  type LineItem,
  type Payment,
  type CreateInvoiceInput,
  type AddLineItemInput,
  type RecordPaymentInput,
  type ListInvoicesOptions,
} from "./db/invoices.js";

export {
  createClient,
  getClient,
  listClients,
  updateClient,
  deleteClient,
  type Client,
  type CreateClientInput,
} from "./db/clients.js";

export { getDatabase, closeDatabase } from "./db/database.js";
