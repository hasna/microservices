/**
 * microservice-ads — Ad campaign management microservice
 */

export {
  createCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
  deleteCampaign,
  pauseCampaign,
  resumeCampaign,
  countCampaigns,
  getCampaignStats,
  getSpendByPlatform,
  getPlatforms,
  createAdGroup,
  getAdGroup,
  listAdGroups,
  deleteAdGroup,
  createAd,
  getAd,
  listAds,
  deleteAd,
  type Campaign,
  type CreateCampaignInput,
  type UpdateCampaignInput,
  type ListCampaignsOptions,
  type Platform,
  type CampaignStatus,
  type AdGroup,
  type CreateAdGroupInput,
  type Ad,
  type CreateAdInput,
  type CampaignStats,
  type SpendByPlatform,
} from "./db/campaigns.js";

export { getDatabase, closeDatabase } from "./db/database.js";
