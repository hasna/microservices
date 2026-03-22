/**
 * microservice-wiki — Wiki microservice
 */

export {
  createPage,
  getPage,
  getPageBySlug,
  updatePage,
  deletePage,
  listPages,
  searchPages,
  getPageTree,
  getRecentlyUpdated,
  getByCategory,
  getByTag,
  getPageHistory,
  revertToVersion,
  addLink,
  removeLink,
  getLinksFrom,
  getLinksTo,
  type Page,
  type CreatePageInput,
  type UpdatePageInput,
  type ListPagesOptions,
  type PageTreeNode,
  type PageVersion,
  type PageLink,
} from "./db/wiki.js";

export { getDatabase, closeDatabase } from "./db/database.js";
