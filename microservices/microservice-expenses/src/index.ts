/**
 * microservice-expenses — Expense management microservice
 */

export {
  createExpense,
  getExpense,
  listExpenses,
  updateExpense,
  deleteExpense,
  getExpenseSummary,
  createCategory,
  listCategories,
  deleteCategory,
  type Expense,
  type CreateExpenseInput,
  type UpdateExpenseInput,
  type ListExpensesOptions,
  type ExpenseCategory,
  type CreateCategoryInput,
  type ExpenseSummaryByCategory,
  type ExpenseSummaryByMonth,
} from "./db/expenses.js";

export { getDatabase, closeDatabase } from "./db/database.js";
