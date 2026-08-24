/**
 * @aee/api — Tenancy middleware (Phase 16).
 *
 * Extracts the active organization from the X-Organization-Id header, or
 * derives it from the user's first membership if the header is absent.
 * Loads the org's active subscription + plan and the current month's usage
 * credits, attaching them to the request context (req.tenant).
 *
 * Also provides rate-limit helpers:
 *   - checkObjectiveLimit  — reject if org already has >= plan.maxObjectives
 *   - checkAiCredits       — reject if org has exhausted monthly AI credits
 *
 * Usage in buildApp:
 *   app.addHook("onRequest", createTenancyHook(opts.pool));
 *   // then inside a route:
 *   checkObjectiveLimit(req.tenant);
 */
import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import type { Pool, PoolClient } from "pg";
import type {
  Organization,
  SubscriptionPlan,
  Subscription,
  UsageCredits,
  PlanTier,
} from "@aee/domain";
import { withinLimit } from "@aee/domain";

// ── Request context shape ─────────────────────────────────────────────────────

export interface TenantContext {
  readonly organization: Organization;
  readonly plan: SubscriptionPlan;
  readonly subscription: Subscription | null;
  readonly usage: UsageCredits | null;
}

// Augment FastifyRequest with .tenant (optional — only present after hook runs).
declare module "fastify" {
  interface FastifyRequest {
    tenant?: TenantContext;
  }
}

// ── Errors ─────────────────────────────────────────────────────────────────────

export class TenancyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function header(req: FastifyRequest, name: string): string | null {
  const h = req.headers[name];
  if (Array.isArray(h)) return h[0] ?? null;
  return h ?? null;
}

function currentMonthYear(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  plan_tier: PlanTier;
  created_at: Date;
  updated_at: Date;
}

interface MembershipRow {
  organization_id: string;
}

interface PlanRow {
  id: string;
  tier: PlanTier;
  name: string;
  price_monthly: string;
  price_yearly: string;
  max_objectives: number | null;
  max_businesses: number | null;
  max_ai_credits_monthly: number | null;
  features: Record<string, unknown>;
  is_active: boolean;
  created_at: Date;
}

interface SubscriptionRow {
  id: string;
  organization_id: string;
  plan_id: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface UsageRow {
  id: string;
  organization_id: string;
  month_year: string;
  credits_used: number;
  credits_limit: number;
  credits_purchased: number;
  reset_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapOrg(r: OrgRow): Organization {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    planTier: r.plan_tier,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

function mapPlan(r: PlanRow): SubscriptionPlan {
  return {
    id: r.id,
    tier: r.tier,
    name: r.name,
    priceMonthly: r.price_monthly,
    priceYearly: r.price_yearly,
    maxObjectives: r.max_objectives,
    maxBusinesses: r.max_businesses,
    maxAiCreditsMonthly: r.max_ai_credits_monthly,
    features: r.features,
    isActive: r.is_active,
    createdAt: r.created_at.toISOString(),
  };
}

function mapSubscription(r: SubscriptionRow): Subscription {
  return {
    id: r.id,
    organizationId: r.organization_id,
    planId: r.plan_id,
    status: r.status as Subscription["status"],
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    currentPeriodStart: r.current_period_start?.toISOString() ?? null,
    currentPeriodEnd: r.current_period_end?.toISOString() ?? null,
    cancelAt: r.cancel_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

function mapUsage(r: UsageRow): UsageCredits {
  return {
    id: r.id,
    organizationId: r.organization_id,
    monthYear: r.month_year,
    creditsUsed: r.credits_used,
    creditsLimit: r.credits_limit,
    creditsPurchased: r.credits_purchased,
    resetAt: r.reset_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

/**
 * Load the full tenant context for a given user + optional org id.
 * Falls back to the user's first membership if no org id is provided.
 * Throws TenancyError if no org/membership is found.
 */
export async function loadTenantContext(
  client: PoolClient,
  userId: string,
  orgId: string | null,
): Promise<TenantContext> {
  let resolvedOrgId = orgId;

  // If no header, derive from user's first membership
  if (!resolvedOrgId) {
    const m = await client.query<MembershipRow>(
      `SELECT organization_id FROM memberships WHERE user_id = $1 ORDER BY joined_at LIMIT 1`,
      [userId],
    );
    const mrow = m.rows[0];
    if (!mrow) {
      throw new TenancyError(403, "NO_ORGANIZATION", "user has no organization membership");
    }
    resolvedOrgId = mrow.organization_id;
  }

  // Load org
  const org = await client.query<OrgRow>(
    `SELECT id, name, slug, plan_tier, created_at, updated_at FROM organizations WHERE id = $1`,
    [resolvedOrgId],
  );
  const orgRow = org.rows[0];
  if (!orgRow) {
    throw new TenancyError(404, "ORG_NOT_FOUND", `organization ${resolvedOrgId} not found`);
  }

  // Load active subscription (or most recent) to get the plan
  const sub = await client.query<SubscriptionRow>(
    `SELECT id, organization_id, plan_id, status, stripe_customer_id, stripe_subscription_id,
            current_period_start, current_period_end, cancel_at, created_at, updated_at
     FROM subscriptions WHERE organization_id = $1
     ORDER BY (status = 'ACTIVE') DESC, created_at DESC LIMIT 1`,
    [resolvedOrgId],
  );
  const subRow = sub.rows[0] ?? null;

  // Get plan — from subscription if present, else from org.plan_tier fallback
  let planRow: PlanRow | null;
  if (subRow) {
    const p = await client.query<PlanRow>(
      `SELECT id, tier, name, price_monthly::text, price_yearly::text,
              max_objectives, max_businesses, max_ai_credits_monthly,
              features, is_active, created_at
       FROM subscription_plans WHERE id = $1`,
      [subRow.plan_id],
    );
    planRow = p.rows[0] ?? null;
  } else {
    const p = await client.query<PlanRow>(
      `SELECT id, tier, name, price_monthly::text, price_yearly::text,
              max_objectives, max_businesses, max_ai_credits_monthly,
              features, is_active, created_at
       FROM subscription_plans WHERE tier = $1 AND is_active = true LIMIT 1`,
      [orgRow.plan_tier],
    );
    planRow = p.rows[0] ?? null;
  }

  // Load current month usage
  const monthYear = currentMonthYear();
  const usage = await client.query<UsageRow>(
    `SELECT id, organization_id, month_year, credits_used, credits_limit,
            credits_purchased, reset_at, created_at, updated_at
     FROM usage_credits WHERE organization_id = $1 AND month_year = $2`,
    [resolvedOrgId, monthYear],
  );
  const usageRow = usage.rows[0] ?? null;

  return {
    organization: mapOrg(orgRow),
    plan: planRow ? mapPlan(planRow) : mapFreePlan(orgRow.id),
    subscription: subRow ? mapSubscription(subRow) : null,
    usage: usageRow ? mapUsage(usageRow) : null,
  };
}

/** Fallback plan row if no subscription_plans row exists (defensive). */
function mapFreePlan(_orgId: string): SubscriptionPlan {
  return {
    id: "",
    tier: "FREE",
    name: "Free",
    priceMonthly: "0",
    priceYearly: "0",
    maxObjectives: 1,
    maxBusinesses: 1,
    maxAiCreditsMonthly: 100,
    features: {},
    isActive: true,
    createdAt: new Date().toISOString(),
  };
}

// ── Fastify hook factory ────────────────────────────────────────────────────

/**
 * Creates an onRequest hook that loads the tenant context.
 * Skips loading for requests without an X-User-Id (e.g. health, webhooks).
 *
 * The hook stores context on req.tenant. Callers can use req.tenant for
 * authorization and rate-limit checks.
 */
export function createTenancyHook(pool: Pool): (req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void {
  return (req, _reply, done) => {
    // Skip if no user context (health, webhooks, public routes)
    const userId = header(req, "x-user-id");
    if (!userId) {
      done();
      return;
    }

    const orgId = header(req, "x-organization-id");

    // Async work — resolve and call done
    void (async () => {
      const client = await pool.connect();
      try {
        const ctx = await loadTenantContext(client, userId, orgId);
        // Attach to request (non-enumerable to avoid serialization in logs)
        Object.defineProperty(req, "tenant", { value: ctx, writable: true, enumerable: true });
        done();
      } catch (err) {
        const e = err instanceof TenancyError
          ? err
          : new TenancyError(500, "TENANCY_ERROR", err instanceof Error ? err.message : String(err));
        // Attach to request; error handler will pick it up
        (req as unknown as { __tenancyError?: TenancyError }).__tenancyError = e;
        done();
      } finally {
        client.release();
      }
    })();
  };
}

// ── Rate-limit helpers ───────────────────────────────────────────────────────

/**
 * Check if the organization can create a new objective.
 * Call before INSERT into objectives.
 * @param tenant - tenant context from the hook
 * @param currentCount - number of existing objectives for the org
 */
export function checkObjectiveLimit(tenant: TenantContext, currentCount: number): void {
  const limit = tenant.plan.maxObjectives;
  if (!withinLimit(limit, currentCount)) {
    throw new TenancyError(
      429,
      "RATE_LIMITED",
      `objective limit reached (${currentCount}/${limit === null ? "unlimited" : limit})`,
    );
  }
}

/**
 * Check if the organization can consume AI credits.
 * Call before making an LLM call for the org.
 * @param tenant - tenant context from the hook
 * @param creditsNeeded - number of credits to consume (default 1)
 */
export function checkAiCredits(tenant: TenantContext, creditsNeeded = 1): void {
  const limit = tenant.plan.maxAiCreditsMonthly;
  if (limit === null) return; // unlimited

  const used = tenant.usage?.creditsUsed ?? 0;
  const purchased = tenant.usage?.creditsPurchased ?? 0;
  const effectiveLimit = limit + purchased;

  if (used + creditsNeeded > effectiveLimit) {
    throw new TenancyError(
      429,
      "RATE_LIMITED",
      `AI credit limit reached (${used}/${effectiveLimit})`,
    );
  }
}

/**
 * Check if the organization can create a new business venture.
 * Call before INSERT into business_ventures.
 * @param tenant - tenant context from the hook
 * @param currentCount - number of existing ventures for the org
 */
export function checkBusinessLimit(tenant: TenantContext, currentCount: number): void {
  const limit = tenant.plan.maxBusinesses;
  if (!withinLimit(limit, currentCount)) {
    throw new TenancyError(
      429,
      "RATE_LIMITED",
      `business limit reached (${currentCount}/${limit === null ? "unlimited" : limit})`,
    );
  }
}
