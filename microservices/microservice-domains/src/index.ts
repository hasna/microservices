/**
 * microservice-domains — Domain portfolio and DNS management microservice
 */

export {
  createDomain,
  getDomain,
  listDomains,
  updateDomain,
  deleteDomain,
  countDomains,
  searchDomains,
  getByRegistrar,
  listExpiring,
  listSslExpiring,
  getDomainStats,
  type Domain,
  type CreateDomainInput,
  type UpdateDomainInput,
  type ListDomainsOptions,
  type DomainStats,
} from "./db/domains.js";

export {
  createDnsRecord,
  getDnsRecord,
  listDnsRecords,
  updateDnsRecord,
  deleteDnsRecord,
  type DnsRecord,
  type CreateDnsRecordInput,
  type UpdateDnsRecordInput,
} from "./db/domains.js";

export {
  createAlert,
  getAlert,
  listAlerts,
  deleteAlert,
  type Alert,
  type CreateAlertInput,
} from "./db/domains.js";

export { getDatabase, closeDatabase } from "./db/database.js";
