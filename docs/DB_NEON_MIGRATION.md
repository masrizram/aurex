# AUREX — Neon Production Database Provisioning & Cutover

> **Source-derived environment variables. No values invented.**
> This runbook supersedes any earlier draft. Every variable name was verified against
> the actual implementation (`packages/db/src/neon.ts`, `scripts/serve-prod.ts`,
> `apps/worker/src/index.ts`, `Dockerfile`, `fly.toml`, `.env.example`) on commit `7d03c6d`.

---

## 0. Prerequisite reality check (verified 2026-08-27)

Before provisioning, **honestly confirm** you have:

- [ ] `neonctl` installed (`brew install neonctl` or download) **OR** browser access to `console.neon.tech`
- [ ] Neon API key (`NEON_API_KEY`) for CLI, **OR** a Neon account with project-create permission
- [ ] A region in the **same continent as Fly region `sin`** (Singapore). The AEE Fly app is in `sin` — choose Neon **AWS Singapore (`ap-southeast-1`)** for the lowest cross-region latency.
- [ ] A **second Neon role** (non-owner) for the application runtime — matching the dual-URL contract.

If any item is missing, **STOP**. Do not attempt provisioning with guessed credentials.

---

## 1. Source-derived environment variable matrix (no invention)

All variable names below were read from source. The "Used by" column tells you which
file fails closed if the variable is missing or wrong.

| Variable | Purpose | Required? | Used by | Secret? | Source line |
|---|---|---|---|---|---|
| `DATABASE_URL` | Owner connection for **migrations + pg-boss + worker** | Yes (prod) | `serve-prod.ts` (ownerPool, pg-boss, waitForDb); `worker` | **Yes** | `packages/db/src/index.ts` (ownerPool) |
| `DATABASE_APP_URL` | Least-privilege runtime connection (`aee_app`-style role) | Yes (prod, dual-role) | `serve-prod.ts` (appPool) | **Yes** | `packages/db/src/index.ts` (appPool) |
| `AEE_DEV_DB_PASSWORD` | Dev container Postgres password | **No** in prod (Fly uses machine-injected creds) | local dev tools | Yes | `packages/db/src/dev-password.ts` |
| `BILLING_PROVIDER` | `"polar"` \| `"duitku"` \| unset (auto) | Optional | `routes/billing.ts` `resolveProvider()` | No | `routes/billing.ts:89-93` |
| `POLAR_ACCESS_TOKEN` | Polar org access token (`pol_…`) | Required if `BILLING_PROVIDER=polar` | `routes/billing.ts`, `billing/polar.ts` | **Yes** | `polar.ts:171` |
| `POLAR_WEBHOOK_SECRET` | Polar webhook HMAC secret (`whsec_…`) | Required if Polar enabled | `polar.ts:172` (constant-time verify) | **Yes** | `polar.ts:82-98` |
| `POLAR_ORGANIZATION_SLUG` | Polar org slug (e.g. `aurex`) | Required if Polar enabled | `polar.ts:173` | No | `polar.ts:173` |
| `POLAR_PRODUCT_STARTER` | Polar product id for `STARTER` plan (Rp 499.000/bln) | Required if Polar enabled | `polar.ts:176`, `routes/billing.ts` `PLAN_PRICES.STARTER` | No | `polar.ts:176` |
| `POLAR_PRODUCT_GROWTH` | Polar product id for `GROWTH` plan (Rp 2.500.000/bln) | Required | `polar.ts:177`, `PLAN_PRICES.GROWTH` | No | `polar.ts:177` |
| `POLAR_PRODUCT_ENTERPRISE` | Polar product id for `ENTERPRISE` plan (Rp 100.000.000/bln) | Required | `polar.ts:178`, `PLAN_PRICES.ENTERPRISE` | No | `polar.ts:178` |
| `POLAR_SANDBOX` | `true` → `X-Polar-Sandbox: true` header. **Default `true`.** | **Required `false` for prod** | `polar.ts:174, 141` | No | `polar.ts:174` |
| `DUITKU_MERCHANT_CODE` | Duitku merchant code | Required if `BILLING_PROVIDER=duitku` | `routes/billing.ts:36` | **Yes** | legacy Duitku adapter |
| `DUITKU_API_KEY` | Duitku API key | Required if Duitku | `routes/billing.ts:37` | **Yes** | legacy Duitku adapter |
| `WEBHOOK_SECRET` | Generic HMAC for any non-Polar webhooks (legacy/Polar-mirror) | Optional | various | **Yes** | — |
| `AEE_APP_URL` | Frontend URL for Polar `success_url` | Recommended | `routes/billing.ts:188` (default `http://localhost:5173`) | No | `routes/billing.ts:147,188` |
| `AEE_PUBLIC_URL` | Public API base for Polar callback URL | Recommended | `routes/billing.ts:154` (default `https://aurex-api.fly.dev`) | No | `routes/billing.ts:154` |
| `AEE_FORCE_MOCK` | Force agents into MOCK mode. **Default false** | **Do NOT set to `true` in prod** unless intentional | `packages/agents/src/index.ts:479` | No | `agents/src/index.ts:479` |
| `AEE_DEV_MODE` | Enables `X-User-Id` header auth (dev fallback). **Keep empty in prod** | No (empty in prod) | `context.ts:130` | No | `context.ts:127-134` |
| `AEE_ADMIN_ENC_KEY` | AES-256-GCM key for AI-key encryption (admin only) | Required if admin stores AI keys | `crypto.ts` | **Yes** | — |
| `GLM_API_KEY` / `KIMI_API_KEY` | LLM provider keys | Required unless `AEE_FORCE_MOCK=true` | `agents/src/index.ts` | **Yes** | `agents/src/index.ts:469-478` |
| `GLM_MODEL` / `KIMI_MODEL` | Model names | Optional (defaults exist) | `agents/src/index.ts:470,476` | No | `agents/src/index.ts` |

---

## 2. Neon provisioning — exact steps

### 2.1 Create the Neon project (CLI)
```bash
# One-time: create API key at console.neon.tech → Settings → API Keys
export NEON_API_KEY=***        # do NOT echo or save to disk
export NEON_ORG=<your-org-id>  # find via `neonctl projects list`

neonctl projects create \
  --name aurex-prod \
  --region-id aws-ap-southeast-1 \
  --pg-version 16

# Note the returned project_id
PROJ_ID=***   # paste from output
```

### 2.2 Create the database
```bash
neonctl databases create \
  --project-id "$PROJ_ID" \
  --name aee
```
The default `neondb` database is fine; explicit `aee` keeps the contract identical to Fly.

### 2.3 Create the two roles (dual-URL contract)
```bash
# Owner (DDL + pg-boss + worker)
neonctl roles create \
  --project-id "$PROJ_ID" \
  --name neondb_owner
# Note the auto-generated password (printed ONCE)

# App runtime role (SELECT+INSERT on the runtime-granted tables; same as aee_app)
neonctl roles create \
  --project-id "$PROJ_ID" \
  --name aee_app
# Note the auto-generated password
```

### 2.4 Get the connection strings
```bash
# Pooled (recommended for the runtime API — Fly machine → Neon pooler)
POOLED_OWNER=$(neonctl connection-string \
  --project-id "$PROJ_ID" \
  --role neondb_owner \
  --pooled true)

POOLED_APP=$(neonctl connection-string \
  --project-id "$PROJ_ID" \
  --role aee_app \
  --pooled true)

# Direct (migrations + pg-boss prefer a direct connection)
DIRECT_OWNER=$(neonctl connection-string \
  --project-id "$PROJ_ID" \
  --role neondb_owner \
  --pooled false)
```

### 2.5 Test connectivity from your local terminal
```bash
psql "$POOLED_OWNER" -c "SELECT version();"
psql "$POOLED_APP"   -c "SELECT current_user, current_database();"
```

### 2.6 Apply migrations 001–013 (direct connection)
```bash
# Repo migration runner auto-discovers and is checksum+idempotent.
# Run from repo root, with DIRECT_OWNER:
DATABASE_URL="$DIRECT_OWNER" \
  DATABASE_APP_URL="$POOLED_APP" \
  npx tsx scripts/run-migrations.ts
```

Expected output: 13 applied (or fewer if some already at the target version; runner is
idempotent by sha256 of the migration file).

### 2.7 Verify schema
```bash
DATABASE_URL="$POOLED_OWNER" npx tsx scripts/verify-db.ts
# Expect: 9/9 PASS, S2 = 13 migrations, S1 = 36 tables (auto-derived).
```

### 2.8 Migrate existing production data (Fly → Neon)
**Pre-cutover baseline is already recorded** in `reports/aee-audit-report.md` (PHASE 3
snapshot from 2026-08-27): 88 users, 88 orgs, 39 objectives, 14 opportunities, 7 experiments,
9 decisions, 9 missions, 9 approvals, 2 execution_results, 114 events, 8 audit_logs,
27 model_runs, sum_capital_approved 168.000.000,00, sum_target_profit 1.206.000.000,00.

Export from Fly (the current prod DB):
```bash
# Using the aee_admin role that prod currently uses (digest c825553ec9022685):
flyctl machine exec <aurex-api-machine-id> -a aurex-api -- \
  bash -lc 'pg_dump --no-owner --no-privileges -t "public.*" \
            "$DATABASE_URL"' > /tmp/aee-prod-dump.sql
```

Import to Neon (direct owner):
```bash
psql "$DIRECT_OWNER" -v ON_ERROR_STOP=1 -f /tmp/aee-prod-dump.sql
```

### 2.9 Validate integrity after import
```bash
# Compare against the pre-cutover baseline above. The exact query is the same
# scripts/_prod-baseline.ts that produced the "before" snapshot.
DATABASE_URL="$POOLED_OWNER" npx tsx scripts/_prod-baseline.ts
# Expect: row counts and aggregates identical (or delta only if you intentionally
# cleaned up test data after the snapshot).
```

### 2.10 Switch AUREX to Neon (controlled cutover)
**Do not flip Fly secrets until §2.9 passes.**

The two Fly secrets to update:
```bash
# Owner (for migrations + pg-boss)
flyctl secrets set \
  -a aurex-api \
  DATABASE_URL="$POOLED_OWNER"

# Runtime (aee_app / least-privilege)
flyctl secrets set \
  -a aurex-api \
  DATABASE_APP_URL="$POOLED_APP"
```

Fly restarts the app on `secrets set` (this is the cutover). Watch:
```bash
flyctl logs -a aurex-api --follow
```

### 2.11 Rollback procedure
If anything breaks within the first hour:
```bash
# Re-set the Fly secrets to the original Fly Postgres URLs.
# These were captured in §0 (digest c825553ec9022685 for both).
flyctl secrets set \
  -a aurex-api \
  DATABASE_URL="postgresql://aee_admin:<pw>@aurex-db.internal:5432/aee"
flyctl secrets set \
  -a aurex-api \
  DATABASE_APP_URL="postgresql://aee_admin:<pw>@aurex-db.internal:5432/aee"
# The old database is untouched, so a rollback is purely a secrets flip.
```

**Do not destroy the Fly `aurex-db` app** until the Neon cutover has been live and
production-verified for at least 7 days. PHASE 10 covers that purge.

---

## 3. Neon-specific gotchas (read these before you act)

- **SSL is mandatory.** The `neon.ts` `poolConfigFor` auto-injects `sslmode=require` + `ssl:
  { rejectUnauthorized: true }` for any `*.neon.tech` / `*.neon.run` host. Your bare URL
  string is fine — the code handles the rest. **Test it locally first** with the same env
  before flipping Fly.
- **Pooled vs direct.** Use the **pooled** connection for the runtime API (handles many
  short requests). Use the **direct** connection for one-shot migrations. Don't mix them up.
- **pg-boss.** The orchestrator queue (pg-boss) needs a stable connection — give it the
  *direct* URL via `ADMIN_URL` (currently `serve-prod.ts` uses `ownerPool` which derives
  from `DATABASE_URL`).
- **Dual role.** The current prod uses ONE role (`aee_admin`) for both URLs. Neon should
  use TWO roles. The migration 004 grants match the `aee_app` role; verify `aee_app`
  gets the same `GRANT SELECT, INSERT` set on all 36 tables — and **no** `GRANT UPDATE`
  on append-only tables (`audit_logs`, `events`, `model_runs`, `capital_transactions`).
- **Idempotency.** All 13 migrations are idempotent (each uses `IF NOT EXISTS` / `DO $$
  ... $$`). You can re-run `scripts/run-migrations.ts` against Neon as many times as
  you want; only the new sha256s are applied.
