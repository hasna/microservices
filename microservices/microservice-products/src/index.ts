/**
 * microservice-products — Product catalog microservice
 */

export {
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
  deleteProduct,
  countProducts,
  searchProducts,
  listByCategory,
  listByType,
  listByStatus,
  getProductWithTiers,
  bulkImportProducts,
  exportProducts,
  getProductStats,
  type Product,
  type ProductWithTiers,
  type CreateProductInput,
  type UpdateProductInput,
  type ListProductsOptions,
  type ProductStats,
  type BulkImportResult,
} from "./db/products.js";

export {
  createCategory,
  getCategory,
  listCategories,
  updateCategory,
  deleteCategory,
  getCategoryTree,
  type Category,
  type CreateCategoryInput,
  type UpdateCategoryInput,
  type ListCategoriesOptions,
  type CategoryTreeNode,
} from "./db/categories.js";

export {
  createPricingTier,
  getPricingTier,
  listPricingTiers,
  deletePricingTier,
  deletePricingTiersByProduct,
  type PricingTier,
  type CreatePricingTierInput,
} from "./db/pricing-tiers.js";

export { getDatabase, closeDatabase } from "./db/database.js";
