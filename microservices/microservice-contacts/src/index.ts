/**
 * microservice-contacts — Contact management microservice
 */

export {
  createContact,
  getContact,
  listContacts,
  updateContact,
  deleteContact,
  countContacts,
  searchContacts,
  getContactsByTag,
  type Contact,
  type CreateContactInput,
  type UpdateContactInput,
  type ListContactsOptions,
} from "./db/contacts.js";

export {
  createCompany,
  getCompany,
  listCompanies,
  updateCompany,
  deleteCompany,
  countCompanies,
  type Company,
  type CreateCompanyInput,
  type UpdateCompanyInput,
  type ListCompaniesOptions,
} from "./db/companies.js";

export {
  createRelationship,
  getRelationship,
  getContactRelationships,
  deleteRelationship,
  type Relationship,
  type CreateRelationshipInput,
} from "./db/relationships.js";

export { getDatabase, closeDatabase } from "./db/database.js";
