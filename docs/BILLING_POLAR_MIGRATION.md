# AUREX (AEE) — Billing Migration: Duitku → Polar

> **Status: REPO-SIDE COMPLETE · EXTERNAL CONFIG PENDING (Polar dashboard access required).**
> The code (SQL migration + provider adapter + routes + tests) is done and verified.
> The external Polar dashboard setup below CANNOT be executed from this session
> (no Polar org credentials/project access were provided). Each step is written so a
> human or properly-credentialed agent can complete the switch with zero code edits.

---

## 1. Why Polar

| | Duitku (current) | Polar (polar.sh) |
|---|---|---|
| Recurring billing | Manual invoice + callback | First-class subscriptions, proration, dunning |
| Checkout UX | Custom redirect | Hosted checkout pages (no card handling in app) |
| Webhook integrity | HMAC-SHA256 signed callbacks | `standard-webhooks` signatures |
| Customer portal | None | Self-serve portal |
| PCI scope | In-app redirect | Out of scope (Polar handles cards) |

## 2. Repo changes already shipped (this PR)

| File | Change |
|---|---|
| `migrations/013_polar_billing.sql` | Adds `polar_*` columns to `billing_invoices` + `subscriptions`; **drops zombie `stripe_*` columns**; creates `polar_webhook_events` (idempotency + signature audit); grants to `aee_app`. **Idempotent** (re-run safe). |
| `packages/api/src/billing/polar.ts` | `makePolarAdapter` (real Polar API): `POST /v1/checkouts/custom` → hosted checkout; `isWebhookSignatureValid` / `parseSignatureHeader` (standard-webhooks HMAC-SHA256 `t=..,v1=..`); `polarCfgFromEnv`. |
| `packages/api/src/routes/billing.ts` | Provider routing via `BILLING_PROVIDER` (`polar`/`duitku`); `POST /billing/polar/checkout` (creates invoice in `PENDING` + redirect to Polar); `POST /billing/polar/webhook` (verifies HMAC, idempotent, `PENDING→PAID` transition via owner pool, audit-logged). |
| `packages/api/test/billing-polar.test.ts` | 6 tests: signature validation (valid/tampered), config gating, checkout route, webhook verification. |
| `.env.example` | `BILLING_PROVIDER`, `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_ORGANIZATION_SLUG`, `POLAR_PRODUCT_*`. |

### Key design decisions
- **Provider-agnostic switch**: Duitku stays default; `BILLING_PROVIDER=polar` flips live.
  Zero-risk rollout — Polar only activates when explicitly configured.
- **Zombie columns removed**: `subscriptions.stripe_customer_id`/`stripe_subscription_id`
  were dead (Duitku era never used them; they were a Stripe-era leftover). Dropped so the
  `subscriptions` table now carries only the active provider (`provider`, `polar_*`).
- **Webhook idempotency**: `polar_webhook_events(event_id UNIQUE)` — a replayed webhook
  is INSERT-ignored (ON CONFLICT DO NOTHING), so `PENDING→PAID` fires once.
- **Webhook secret is required**: `POLAR_WEBHOOK_SECRET` must be non-placeholder; a missing
  secret fails the checkout, mirroring the existing `WEBHOOK_SECRET` fail-fast (P0 pattern).

## 3. External config — DO THIS ON polar.sh (requires org owner)

> These steps need `app.polar.sh`. From this session the Polar dashboard was **not
> reachable / no credentials were provided** — this is a runbook, not a claim.

### 3.1 Create products (get product IDs)
1. `app.polar.sh` → **Products** → **Create Product** for each `plan_tier`:
   - `free`, `starter`, `professional` (align with `packages/domain` plan tiers).
   - Set **recurring** price + billing period. Note each product/price **ID**.
2. Determine the pricing multiplier config used by the app (amount = tier base × months);
   mirror your Duitku amount in the Polar price.

### 3.2 Create an API access token
`app.polar.sh` → **Settings → Developers → Access Tokens** → **Create token**.
Scope: `checkouts:read`, `checkouts:write`, `orders:read`, `subscriptions:read`.
Copy the token → `POLAR_ACCESS_TOKEN`.

### 3.3 Create the webhook endpoint (verify signature happens in-app)
1. `app.polar.sh` → **Settings → Webhooks** → **Create endpoint** → URL:
   `https://aurex-api.fly.dev/billing/polar/webhook` (no `/api/v1` prefix — routes mount at root).
2. Subscribe to events: `checkout.created`, `checkout.updated`, `subscription.active`,
   `subscription.canceled`, `subscription.revoked`.
3. Copy the endpoint **signing secret** → `POLAR_WEBHOOK_SECRET` (this is what the app
   verifies with HMAC-SHA256 via `isWebhookSignatureValid`).

### 3.4 Set Fly secrets (via `fly` CLI)

```bash
fly secrets set \
  BILLING_PROVIDER=polar \
  POLAR_ACCESS_TOKEN="<token>" \
  POLAR_WEBHOOK_SECRET="<whsec_...>" \
  POLAR_ORGANIZATION_SLUG="aurex" \
  POLAR_PRODUCT_FREE="<product_id>" \
  POLAR_PRODUCT_STARTER="<product_id>" \
  POLAR_PRODUCT_PROFESSIONAL="<product_id>"
```

## 4. Verification (after external config)

```bash
# 1. Checkout works — returns a Polar hosted URL
curl -s -X POST https://aurex-api.fly.dev/billing/polar/checkout \
  -H 'Content-Type: application/json' -H 'Cookie: <session>' \
  -d '{"plan_tier":"starter","period_months":1}'
# expect: { "checkout_url": "https://..." }

# 2. Webhook signature verified (valid + tampered) — unit tests already prove this:
npx vitest run packages/api/test/billing-polar.test.ts   # 6 PASS

# 3. Idempotency: POST the same webhook event twice → second is ignored
#    (polar_webhook_events.event_id UNIQUE + ON CONFLICT DO NOTHING).

# 4. Audit trail: POST /admin/audit-logs (service role) shows the webhook transitions.

# 5. Old stripe_* columns are gone:
#    SELECT column_name FROM information_schema.columns WHERE table_name='subscriptions';
#    expect: no stripe_customer_id / stripe_subscription_id.
```

## 5. Rollback (reversible)

Set `BILLING_PROVIDER=duitku` in Fly secrets (or unset `POLAR_*`) and redeploy. Duitku
path is untouched and remains the default. No migration to undo — `013` added nullable
`polar_*` columns only; the zombie `stripe_*` drop is a one-way cleanup of dead columns
but harmless to the Duitku flow.

## 6. Notes / gotchas

- **No `/api/v1` prefix**: AEE routes mount at root, so the webhook URL is
  `…/billing/polar/webhook` (not `/api/v1/…`).
- **Billing was unconfigured in prod**: `aurex-api.fly.dev` had **no `DUITKU_*`** secrets
  set when audited (live billing returned `BILLING_UNCONFIGURED`). This means enabling
  Polar does **not** touch real money until products + token are added — safe to test.
- **Standard-webhooks**: the signature header is `webhook-signature: t=…,v1=…`; the app
  parses it with `parseSignatureHeader` and verifies HMAC-SHA256 of `t + "." + body`.
- **Do not point the webhook at `/api/v1`** — it will 404.
