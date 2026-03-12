/**
 * microservice-bookkeeping — Double-entry bookkeeping microservice
 */

export {
  createAccount,
  getAccount,
  listAccounts,
  updateAccount,
  deleteAccount,
  createTransaction,
  getTransaction,
  listTransactions,
  deleteTransaction,
  getTrialBalance,
  getAccountBalance,
  getIncomeStatement,
  type Account,
  type AccountType,
  type CreateAccountInput,
  type UpdateAccountInput,
  type ListAccountsOptions,
  type Transaction,
  type TransactionEntry,
  type TransactionWithEntries,
  type TransactionEntryInput,
  type CreateTransactionInput,
  type ListTransactionsOptions,
  type TrialBalanceEntry,
} from "./db/bookkeeping.js";

export { getDatabase, closeDatabase } from "./db/database.js";
