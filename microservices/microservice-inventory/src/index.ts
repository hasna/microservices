/**
 * microservice-inventory — Inventory management microservice
 */

export {
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
  deleteProduct,
  recordMovement,
  listMovements,
  getLowStockProducts,
  getInventoryValue,
  createLocation,
  listLocations,
  type Product,
  type CreateProductInput,
  type UpdateProductInput,
  type ListProductsOptions,
  type StockMovement,
  type RecordMovementInput,
  type ListMovementsOptions,
  type Location,
  type CreateLocationInput,
} from "./db/inventory.js";

export { getDatabase, closeDatabase } from "./db/database.js";
