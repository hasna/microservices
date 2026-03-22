/**
 * microservice-proposals — Proposal management microservice
 */

export {
  createProposal,
  getProposal,
  listProposals,
  updateProposal,
  deleteProposal,
  sendProposal,
  markViewed,
  acceptProposal,
  declineProposal,
  convertToInvoice,
  listExpiring,
  getProposalStats,
  searchProposals,
  countProposals,
  createTemplate,
  getTemplate,
  listTemplates,
  deleteTemplate,
  useTemplate,
  type Proposal,
  type ProposalItem,
  type ProposalStatus,
  type ProposalStats,
  type InvoiceData,
  type ProposalTemplate,
  type CreateProposalInput,
  type UpdateProposalInput,
  type ListProposalsOptions,
  type CreateTemplateInput,
} from "./db/proposals.js";

export { getDatabase, closeDatabase } from "./db/database.js";
