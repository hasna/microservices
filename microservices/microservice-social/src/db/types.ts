/**
 * Shared types and constants for social media operations
 */

export type Platform = "x" | "linkedin" | "instagram" | "threads" | "bluesky";
export type PostStatus = "draft" | "scheduled" | "published" | "failed" | "pending_review";
export type Recurrence = "daily" | "weekly" | "biweekly" | "monthly";

/**
 * Platform character limits for post content validation
 */
export const PLATFORM_LIMITS: Record<Platform, number> = {
  x: 280,
  linkedin: 3000,
  instagram: 2200,
  threads: 500,
  bluesky: 300,
};

export interface PlatformLimitWarning {
  platform: Platform;
  limit: number;
  content_length: number;
  over_by: number;
}
