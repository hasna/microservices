/**
 * microservice-shipping — Shipping and order management microservice
 */

export {
  createOrder,
  getOrder,
  listOrders,
  updateOrder,
  deleteOrder,
  searchOrders,
  listByStatus,
  type Order,
  type OrderItem,
  type Address,
  type CreateOrderInput,
  type UpdateOrderInput,
  type ListOrdersOptions,
} from "./db/shipping.js";

export {
  createShipment,
  getShipment,
  getShipmentByTracking,
  listShipments,
  updateShipment,
  deleteShipment,
  type Shipment,
  type CreateShipmentInput,
  type UpdateShipmentInput,
  type ListShipmentsOptions,
} from "./db/shipping.js";

export {
  createReturn,
  getReturn,
  listReturns,
  updateReturn,
  deleteReturn,
  type Return,
  type CreateReturnInput,
  type UpdateReturnInput,
  type ListReturnsOptions,
} from "./db/shipping.js";

export {
  getShippingStats,
  getCostsByCarrier,
  type ShippingStats,
  type CarrierCosts,
} from "./db/shipping.js";

export { getDatabase, closeDatabase } from "./db/database.js";
