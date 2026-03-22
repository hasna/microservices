/**
 * microservice-analytics — Business analytics microservice
 */

export {
  recordKpi,
  getKpiById,
  getKpi,
  getKpiTrend,
  listKpis,
  getLatestKpis,
  deleteKpi,
  createDashboard,
  getDashboard,
  listDashboards,
  updateDashboard,
  deleteDashboard,
  generateReport,
  getReport,
  listReports,
  deleteReport,
  getBusinessHealth,
  generateExecutiveSummary,
  type Kpi,
  type RecordKpiInput,
  type ListKpisOptions,
  type Dashboard,
  type CreateDashboardInput,
  type UpdateDashboardInput,
  type Report,
  type ReportType,
  type GenerateReportInput,
  type ListReportsOptions,
  type BusinessHealth,
} from "./db/analytics.js";

export { getDatabase, closeDatabase } from "./db/database.js";
