/**
 * microservice-travel — Travel management microservice
 */

export {
  createTrip,
  getTrip,
  listTrips,
  updateTrip,
  deleteTrip,
  type Trip,
  type CreateTripInput,
  type UpdateTripInput,
  type ListTripsOptions,
} from "./db/travel.js";

export {
  createBooking,
  getBooking,
  listBookings,
  cancelBooking,
  deleteBooking,
  type Booking,
  type CreateBookingInput,
  type ListBookingsOptions,
} from "./db/travel.js";

export {
  createDocument,
  getDocument,
  listDocuments,
  deleteDocument,
  type TravelDocument,
  type CreateDocumentInput,
  type ListDocumentsOptions,
} from "./db/travel.js";

export {
  createLoyaltyProgram,
  getLoyaltyProgram,
  listLoyaltyPrograms,
  updateLoyaltyProgram,
  deleteLoyaltyProgram,
  type LoyaltyProgram,
  type CreateLoyaltyInput,
  type UpdateLoyaltyInput,
} from "./db/travel.js";

export {
  getUpcomingTrips,
  getTripBudgetVsActual,
  getExpiringDocuments,
  getLoyaltyPointsSummary,
  getTravelStats,
  type BudgetVsActual,
  type LoyaltyPointsSummary,
  type TravelStats,
} from "./db/travel.js";

export { getDatabase, closeDatabase } from "./db/database.js";
