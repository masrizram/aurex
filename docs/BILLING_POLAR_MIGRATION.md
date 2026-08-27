# AUREX — Polar.sh Billing Configuration & Webhook Verification

> **Source-derived environment variables. No values invented.**
> This runbook supersedes any earlier draft. Every variable name was verified against
> the actual implementation (`packages/api/src/billing/polar.ts`, `routes/billing.ts`,
> `.env.example`) on commit `7d03c6d`. Plan tiers and prices are read from
> `PLAN_PRICES` in `routes/billing.ts:24-28`.

---

## 0. Prerequisite reality check (verified 2026-08-27)

Before you begin, **honestly confirm** you have:

- [ ] A Polar.sh organization account at `polar.sh` (sandbox or production)
- [ ] Permission to create **products** and **access tokens** in that organization
- [ ] Permission to configure **webhook endpoints** for that organization
- [ ] The ability to receive an HTTPS POST from Polar at `https://aurex-api.fly.dev/billing/polar/webhook`
- [ ] A plan-tier → product-id mapping ready (see §1)

If any item is missing, **STOP**. Do not proceed with guessed or assumed identifiers —
the `polarCfgFromEnv()` function in `polar.ts:170` returns `null` (forcing
`BILLING_UNCONFIGURED` 503) when any required variable is missing.

---

## 1. Plan tier → Polar product matrix (source-verified)

The AEE backend has three priced plans (`PLAN_PRICES` in `routes/billing.ts:24-28`):

| Plan tier (server) | Price (Rp) | Env var (Polar product id) | Polar product to create |
|---|---|---|---|
| `STARTER` | 499.000 / bulan | `POLAR_PRODUCT_STARTER` | "AUREX Starter" — 499.000 IDR / month recurring |
| `GROWTH` | 2.500.000 / bulan | `POLAR_PRODUCT_GROWTH` | "AUREX Growth" — 2.500.000 IDR / month recurring |
| `ENTERPRISE` | 100.000.000 / bulan | `POLAR_PRODUCT_ENTERPRISE` | "AUREX Enterprise" — 100.000.000 IDR / month recurring |

Period multipliers (3-bulan −5%, 12-bulan −15%) are applied **on the AEE side** before
the amount is sent to Polar via `metadata.aee_amount_idr` (`polar.ts:131`). The discount
is a **display/informational** field — Polar's product price is the monthly recurring
amount; the period is communicated via `metadata.aee_period_months`.

---

## 2. Polar dashboard — exact configuration steps

### 2.1 Create the three products
For each plan tier above, in Polar:
1. **Products → New product**
2. **Name:** `AUREX Starter` / `AUREX Growth` / `AUREX Enterprise`
3. **Recurring:** monthly
4. **Price:** the IDR amount from the table (499000, 2500000, 100000000) — **in IDR**
5. After save, copy the product id (format `prod_…`) and note it for §3.

### 2.2 Create the org access token
1. **Settings → Developers → Access tokens → New token**
2. **Scopes:** at minimum `checkouts:write`, `checkouts:read`, `customers:read`,
   `subscriptions:read`, `webhooks:read`. If Polar scopes are coarser, the **organization
   read+write** scope is the safe minimum.
3. Copy the token (format `pol_…`). Treat it like a database password.

### 2.3 Create the webhook endpoint
1. **Settings → Webhooks → New endpoint**
2. **URL:** `https://aurex-api.fly.dev/billing/polar/webhook` (use the value of
   `AEE_PUBLIC_URL` in prod — it defaults to `https://aurex-api.fly.dev`)
3. **Events:** subscribe to at minimum
   - `checkout.created`
   - `checkout.updated`
4. After save, Polar shows a **signing secret** (format `whsec_…`). Copy it. This is
   the value of `POLAR_WEBHOOK_SECRET`.
5. **Verify the signature format is `webhook-signature: t=<unix>,v1=<hex-hmac>`** —
   this is the standard-webhooks spec. The AEE code (`polar.ts:62-78`) parses exactly
   that format; Polar uses it by default.

### 2.4 Get the organization slug
Polar Settings → General → Organization slug (e.g. `aurex`). This is the value of
`POLAR_ORGANIZATION_SLUG`.

---

## 3. Fly secrets — exact executable commands (Phase 6)

These are the **required** secrets for the Polar path. Names are source-derived; values
are placeholders. Do not paste real tokens into the repo, the docs, or your shell history
without using the `flyctl secrets set` prompt that masks the value.

```bash
# 1. Set the provider switch (this REPLACES the unconfigured / Duitku state).
flyctl secrets set \
  -a aurex-api \
  BILLING_PROVIDER=polar

# 2. Set Polar credentials (the value prompts mask the secret).
flyctl secrets set \
  -a aurex-api \
  POLAR_ACCESS_TOKEN=pol_REPLACE_WITH_REAL \
  POLAR_WEBHOOK_SECRET=whsec_REPLACE_WITH_REAL \
  POLAR_ORGANIZATION_SLUG=aurex \
  POLAR_PRODUCT_STARTER=prod_REPLACE_STARTER \
  POLAR_PRODUCT_GROWTH=prod_REPLACE_GROWTH \
  POLAR_PRODUCT_ENTERPRISE=prod_REPLACE_ENTERPRISE \
  POLAR_SANDBOX=false
```

> `POLAR_SANDBOX=false` is **required** for production. The default in the source is
> `true` (`polar.ts:174`), which would send `X-Polar-Sandbox: true` and prevent real
> payments from settling.

**Verification (no values leaked):**
```bash
flyctl secrets list -a aurex-api
# All eight names above must be present.
```

---

## 4. Phase 5 — Webhook verification (what must pass before declaring live)

These are the assertions the AEE code is designed to enforce. Each must be exercised
against the real Polar test environment before you flip `POLAR_SANDBOX=false`.

| # | Assertion | How the code enforces it | How you test it |
|---|---|---|---|
| W1 | **Valid webhook accepted** | `isWebhookSignatureValid` matches HMAC-SHA256 of `${t}.${rawBody}` against the secret (`polar.ts:82-98`), then `INSERT ... ON CONFLICT (event_id) DO NOTHING` records the event. | Send a real `checkout.updated` from Polar dashboard "Send test event" with `status: paid`. Expect HTTP 200 and `billing_invoices` row flipped `PENDING → PAID` for the matching `polar_checkout_id`. |
| W2 | **Invalid signature rejected** | `isWebhookSignatureValid` returns false (length-mismatch, timingSafeEqual fail, or expired `t`). Route throws `ApiError(403, "FORBIDDEN", …)` (`routes/billing.ts:222-224`). | Curl with a wrong `webhook-signature` header → expect HTTP 403. |
| W3 | **Duplicate event idempotent** | The `INSERT … ON CONFLICT (event_id) DO NOTHING RETURNING id` returns 0 rows on the second delivery; the code commits and returns `{ received: true, dedup: true }` with 200 (`routes/billing.ts:240-243`). | Replay W1 — expect 200, no second `billing_invoices` UPDATE, no double activation. |
| W4 | **Unknown event safely handled** | Code processes only `checkout.created` / `checkout.updated` with status `paid`/`completed`/`confirmed`; everything else is recorded but no `billing_invoices` UPDATE happens (`routes/billing.ts:246-261`). | Send `subscription.created` from Polar — expect 200, no DB mutation on `billing_invoices`. |
| W5 | **Subscription creation persisted** | `activateSubscription` + `setSubscriptionProvider` run in the **same transaction** as the `billing_invoices` UPDATE (`routes/billing.ts:233-271`). On commit, `organizations.plan_tier` and `subscriptions` row reflect the new plan. | After W1, query prod DB: `SELECT plan_tier FROM organizations WHERE id=<org>` and `SELECT status, provider, polar_customer_id FROM subscriptions WHERE organization_id=<org>`. |
| W6 | **Subscription update persisted** | A second `checkout.updated` for the same `polar_checkout_id` with `status: paid` and the same `metadata` is idempotent (W3). With **different** `metadata.aee_plan_tier`, the path still re-activates (`activateSubscription`). | Run the cycle again for `GROWTH` after `STARTER`; expect `organizations.plan_tier='GROWTH'`. |
| W7 | **Subscription cancellation persisted** | **NOT YET IMPLEMENTED.** The webhook handler only processes `checkout.created` / `checkout.updated` with paid statuses. A `subscription.canceled` event is recorded in `polar_webhook_events` but does **not** update the org or subscription. | Send `subscription.canceled` from Polar — expect 200, but `subscriptions.status` will NOT change. **This is a known gap (see §6).** |
| W8 | **Entitlement updated** | `activateSubscription` sets `organizations.plan_tier` AND `subscriptions.status='ACTIVE'` plus `current_period_end` (`routes/billing.ts:50-62`). The entitlement boundary is the org's `plan_tier` — used by `checkObjectiveQuota` in `context.ts`. | After W1, attempt to create an objective with a quota that exceeds the FREE plan; expect the `requireRole` + `checkObjectiveQuota` to gate based on the new `plan_tier`. |
| W9 | **Database transaction atomic** | The whole webhook handler runs `BEGIN / COMMIT / ROLLBACK` (`routes/billing.ts:234,270,273`). If the `billing_invoices` UPDATE succeeds but `activateSubscription` throws, both roll back. | Force a failure (e.g. temporarily revoke EXECUTE on a function) — expect a 500 from Polar's perspective AND no partial state. |
| W10 | **Retry does not double-apply** | Same mechanism as W3 — the `ON CONFLICT (event_id) DO NOTHING` is the single source of truth. The `UPDATE billing_invoices ... WHERE status='PENDING'` guard means a second paid event hits no row. | Replay W1 five times — count of PAID rows stays at 1. |

**Critical:** the browser redirect from the hosted checkout (the URL the customer sees
after paying) is **NOT** what grants entitlement. Only the **server-side verified
webhook** that hits `/billing/polar/webhook` with a valid HMAC and matches a `PENDING`
invoice flips state. This is enforced by the transaction above — there is no client-side
trust path.

---

## 5. Phase 5 test script (executable)

A test that exercises W1–W6 + W8 without touching real money. Requires `POLAR_SANDBOX=true`
and a Polar **sandbox** test product.

```bash
# From repo root, against the live prod API (the cookies are NOT used here — we
# need the session of the org that owns the PENDING invoice).

# 1. Login as any user
COOKIE=$(curl -s -i -X POST -H "content-type: application/json" \
  -d '{"email":"<email>","password":"<pass>"}' \
  https://aurex-api.fly.dev/auth/login \
  | grep -i '^set-cookie:' | sed -E 's/.*(aee_session=[^;]+).*/\1/')

# 2. Create a checkout (with BILLING_PROVIDER=polar live)
ORDER=$(curl -s -X POST \
  -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -H "Idempotency-Key: probe-$(date +%s%N)" \
  -d '{"plan_tier":"STARTER","period_months":1}' \
  https://aurex-api.fly.dev/billing/polar/checkout \
  | python -c "import sys,json;print(json.load(sys.stdin)['order_id'])")
echo "order=$ORDER"

# 3. Use Polar sandbox UI to "pay" the hosted checkout (or use the Polar sandbox
#    test card). Polar then POSTs checkout.updated to /billing/polar/webhook.

# 4. Verify
psql "$DATABASE_URL" -c \
  "SELECT status, polar_checkout_id, updated_at FROM billing_invoices WHERE merchant_order_id='$ORDER'"
# Expect: status = PAID

psql "$DATABASE_URL" -c \
  "SELECT plan_tier FROM organizations o JOIN users u ON u.id=o.owner_user_id WHERE u.email='<email>'"
# Expect: plan_tier = STARTER
```

For W2 (invalid signature) and W3 (idempotency) and W10 (retry):
```bash
# W2: bad signature
curl -i -X POST -H "webhook-signature: t=1,v1=deadbeef" \
  -H "content-type: application/json" \
  -d '{"id":"evt_test","type":"checkout.updated","data":{"id":"chk_test","status":"paid"}}' \
  https://aurex-api.fly.dev/billing/polar/webhook
# Expect: 403 FORBIDDEN

# W3/W10: replay a real event 5x
for i in 1 2 3 4 5; do
  curl -i -X POST -H "webhook-signature: $SIG" -H "content-type: application/json" \
    -d "$PAYLOAD" https://aurex-api.fly.dev/billing/polar/webhook
done
# Expect: 200 each time, but only 1 PAID row in DB.
```

---

## 6. Known gaps (do not paper over)

| Gap | Severity | What to do |
|---|---|---|
| `subscription.canceled` / `subscription.updated` events are recorded but do **not** flip `subscriptions.status` back to `CANCELED` or update plan. | **P2** | Add a `switch (evt.type)` branch in `registerPolarWebhook` for `subscription.canceled` + `subscription.updated` — flip `subscriptions.status` accordingly. **Do this before going fully live**; until then, customers who cancel via Polar's UI will not see the change in AEE. |
| `setSubscriptionProvider` runs **after** `activateSubscription` in a separate-but-same-transaction block (`routes/billing.ts:263-265`). If `setSubscriptionProvider` throws, the invoice UPDATE has already been committed in spirit (same tx, so it rolls back too — but the failure point is brittle). | **P3** | Move both into one helper for clarity. |
| `rawBody` is recovered from `ctx.rawBodies.get(req)` which depends on a `content-type: application/json` parser plugin storing the raw bytes (`routes/billing.ts:217`). If a future change adds a parser that doesn't populate the WeakMap, the signature verify will silently fall back to the parsed body — a **replay attack vector** (the parsed body is canonicalized by JSON.stringify, not the raw bytes). | **P2** | Add an assertion: if `ctx.rawBodies.get(req)` is undefined, throw 400 "raw body unavailable". |
