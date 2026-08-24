/**
 * @aee/domain — Multi-tenancy types (Phase 16).
 *
 * Organization, Membership, SubscriptionPlan, Subscription, UsageCredits, ApiKey.
 * Mirrors migrations/004_multi_tenancy.sql.
 */

// ── Enumerasi tenancy ────────────────────────────────────────────────────────

export const PLAN_TIERS = ["FREE", "STARTER", "GROWTH", "ENTERPRISE"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const MEMBERSHIP_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const SUBSCRIPTION_STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE", "CANCELLED"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

// ── Row shapes ────────────────────────────────────────────────────────────────

export interface Organization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly planTier: PlanTier;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Membership {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly role: MembershipRole;
  readonly invitedBy: string | null;
  readonly joinedAt: string;
}

export interface SubscriptionPlan {
  readonly id: string;
  readonly tier: PlanTier;
  readonly name: string;
  readonly priceMonthly: string;           // NUMERIC(20,2) as string
  readonly priceYearly: string;            // NUMERIC(20,2) as string
  readonly maxObjectives: number | null;  // null = unlimited
  readonly maxBusinesses: number | null;   // null = unlimited
  readonly maxAiCreditsMonthly: number | null; // null = unlimited
  readonly features: Record<string, unknown>;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface Subscription {
  readonly id: string;
  readonly organizationId: string;
  readonly planId: string;
  readonly status: SubscriptionStatus;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly currentPeriodStart: string | null;
  readonly currentPeriodEnd: string | null;
  readonly cancelAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UsageCredits {
  readonly id: string;
  readonly organizationId: string;
  readonly monthYear: string;              // 'YYYY-MM'
  readonly creditsUsed: number;
  readonly creditsLimit: number;
  readonly creditsPurchased: number;
  readonly resetAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiKey {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly keyHash: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
}

// ── Helper: plan limit check ────────────────────────────────────────────────

/**
 * Returns true if the given count is within the plan limit.
 * null limit = unlimited → always true.
 */
export function withinLimit(limit: number | null, count: number): boolean {
  return limit === null || count < limit;
}
