/**
 * microservice-health — Health tracking microservice
 */

export {
  createMetric,
  getMetric,
  listMetrics,
  deleteMetric,
  getMetricTrend,
  type Metric,
  type CreateMetricInput,
  type ListMetricsOptions,
  type MetricTrendPoint,
} from "./db/health.js";

export {
  createMedication,
  getMedication,
  listMedications,
  updateMedication,
  deactivateMedication,
  deleteMedication,
  getMedicationSchedule,
  type Medication,
  type CreateMedicationInput,
  type UpdateMedicationInput,
  type ListMedicationsOptions,
} from "./db/health.js";

export {
  createAppointment,
  getAppointment,
  listAppointments,
  updateAppointment,
  completeAppointment,
  cancelAppointment,
  deleteAppointment,
  getUpcomingAppointments,
  type Appointment,
  type CreateAppointmentInput,
  type UpdateAppointmentInput,
  type ListAppointmentsOptions,
} from "./db/health.js";

export {
  createFitnessLog,
  getFitnessLog,
  listFitnessLogs,
  deleteFitnessLog,
  getFitnessStats,
  type FitnessLog,
  type CreateFitnessLogInput,
  type ListFitnessLogsOptions,
  type FitnessStats,
} from "./db/health.js";

export {
  getHealthSummary,
  type HealthSummary,
} from "./db/health.js";

export { getDatabase, closeDatabase } from "./db/database.js";
