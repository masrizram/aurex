# AUREX (AEE) — Database Migration: Fly Postgres → Neon

> **Status: REPO-SIDE COMPLETE · EXTERNAL CONFIG PENDING (dashboard access required).**
> The code changes to support Neon are done and verified (typecheck + tests green).
> The external dashboard steps below CANNOT be executed from this session (no Neon
> credentials/project access was provided). Each step is written so a human or a
> properly-credentialed agent can complete the switch with zero code changes.

---

## 1. Why Neon

| | Fly Postgres (current) | Neon |
|---|---|---|
| Serverless | No — single VM, self-managed | Yes — autoscaling endpoints, built-in PITR |
| Cold start | n/a (always-on VM) | ~500ms wake (suspended endpoints) |
| Branching | Manual | Built-in ephemeral branches (dev/preview) |
| Connections | Single primary | Pooled via pgbouncer (5432 "pooler" host) |
| Cost | Full VM always on | Autosuspend → near-zero idle |

The app is already **dual-URL** (`DATABASE_URL` owner + `DATABASE_APP_URL` app role),
which maps directly to Neon's multi-role model. This is why the migration is a
config-only switch on the repo side.

## 2. Repo changes already shipped (this PR)

| File | Change |
|---|---|
| `packages/db/src/neon.ts` | `isNeonUrl`, `neonNormalize` (injects `sslmode=require`), `poolConfigFor` (auto-enables SSL for neon.tech hosts) |
| `packages/db/src/index.ts` | `ownerPool`/`appPool` routed through `poolConfigFor`; exports the Neon helpers |
| `packages/db/src/resilient.ts` | `ResilientPool` now Honor Neon SSL config |
| `apps/worker/src/index.ts` | worker appPool routed through `poolConfigFor` |
| `scripts/serve-prod.ts` | API pool → `ownerPool`; pg-boss → `neonNormalize(ADMIN_URL)`; `waitForDb` → `poolConfigFor` |
| `packages/db/test/neon.test.ts` | 7 unit tests covering detection, sslmode injection, scheme prepend, PoolConfig SSL, non-Neon passthrough |

## 3. What the code now does automatically

- If `DATABASE_URL`/`DATABASE_APP_URL` host contains `neon.tech` or `neon.run`, every
  pool auto-applies `ssl: { rejectUnauthorized: true }` and appends `sslmode=require`.
- The migration runner already uses `ownerPool` (now Neon-aware).
- pg-boss connection string is `neonNormalize`d at the entrypoint.
- Non-Neon hosts (local dev, Fly Postgres) are untouched — the migration is
  **reversible** by simply pointing the env back.

## 4. External config — DO THIS ON THE NEON CONSOLE (requires org owner)

> These steps need `console.neon.tech` access. From this session the Neon console was
> **not reachable / no credentials were provided**, so this is a runbook, not a claim.

### 4.1 Create the project + roles (mirror the dual-URL contract)

1. `console.neon.tech` → **Create Project** → name `aurex-db`, region matching Fly
   `primary_region = "sin"` (Neon Asia-Pacific regions: `aws-ap-southeast-1` ≈ Singapore).

2. In **Dashboard → SQL Editor** (or `psql "$NEON_OWNER_URL"`), create the two roles
   exactly like the current Fly Postgres:

   ```sql
   -- OWNER role (migrations + pg-boss) — Neon provided this as the default
   -- "neondb_owner" role; the console "connection string" uses it.
   -- RUNTIME role (API pool) — least privilege, mirror of aee_app:
   CREATE ROLE aee_app LOGIN PASSWORD '<AEE_GENERATED_PASSWORD>';
   GRANT CONNECT ON DATABASE neondb TO aee_app;
   ```

3. Because AEE uses a **post-migration grant model** (`migration 001` `REVOKE`s and
   `GRANT`s to `aee_app`), the owner must run the migrations first. The runtime role
   is then granted `SELECT, INSERT` on all tables by the migrations themselves.

### 4.2 Get the two connection strings

- **Owner URL** (migrations + pg-boss): console → **Connect** → *PostgreSQL* →
  **Pooled connection** (port `5432`) — copy the string. Confirm it contains
  `sslmode=require` (the app adds it automatically if missing) and the `neondb_owner` user.
- **App URL** (runtime pool): same dialog but swap the user to `aee_app` and its password.
  IMPORTANT: the app pool should use the **pooled** host for connection fan-out; if you
  need transaction fixups / LISTEN-NOTIFY, use the **direct** (non-pooler) host for
  `DATABASE_APP_URL`.

### 4.3 Set Fly secrets (`fly.secrets` — do via `fly` CLI from a real shell)

```bash
fly secrets set \
  DATABASE_URL="postgresql://neondb_owner:...@ep-xxx-pooler.aws-ap-southeast-1.aws.neon.tech/neondb?sslmode=require" \
  DATABASE_APP_URL="postgresql://aee_app:...@ep-xxx-pooler.aws-ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
```

The Fly machine redeploys on secret change (`serve-prod.ts` reads them at boot; it runs
`run-migrations.ts` automatically → the schema migrates to Neon on first boot).

### 4.4 Enable Neon branching for staging/preview (optional, recommended)

- **Dashboard → Branch** → create `preview` branch from `main`. Point a Fly preview
  machine's `DATABASE_URL`/`DATABASE_APP_URL` at the branch connection string. This gives
  ephemeral DB per PR without touching prod data.

## 5. Verification (after external config)

```bash
# 1. Health: DB must report healthy (SSL + reachable)
curl -s https://aurex-api.fly.dev/health

# 2. Migration ledger: all 13 migrations applied
wsl.exe -e bash -lc 'psql "$DATABASE_URL" -c "SELECT count(*) FROM schema_migrations;"'   # expect 13

# 3. Runtime role works (app pool) — login + create objective via the API cookie flow
#    (canonical E2E):
npx tsx scripts/e2e-canonical-cookie.ts   # expect 20/20 PASS

# 4. Trigger + REVOKE still enforced on Neon:
wsl.exe -e bash -lc 'psql "$DATABASE_APP_URL" -c "UPDATE capital_transactions SET amount=1"'
#   expect: ERROR: permission denied for table capital_transactions

# 5. Double-entry invariant (per-account balance nets to zero):
wsl.exe -e bash -lc 'psql "$DATABASE_URL" -c "SELECT count(*) FROM capital_transactions WHERE debit_account=credit_account;"'  # expect 0
```

## 6. Rollback (reversible)

Point the same two secrets back at the Fly Postgres URLs and redeploy. The pool code
auto-detects non-Neon hosts and drops SSL — no code change. (Data in the old Fly
Postgres cluster is untouched; Neon `aurex-db` can be dropped after confirmation.)

## 7. Known Neon specifics handled

| Concern | Resolution |
|---|---|
| TLS required | `poolConfigFor` auto-sets `ssl: { rejectUnauthorized: true }` for neon.tech hosts |
| `sslmode=require` in URL | `neonNormalize` injects it if absent; idempotent |
| pg-boss (raw connection string) | `serve-prod.ts` normalizes `ADMIN_URL` before `new pgBossCtor` |
| Autosuspend cold start | `waitForDb` retries 30×, 5s apart; `ResilientPool` bounded-retries queries |
| Connection fan-out | Use the **pooled** host for `DATABASE_APP_URL`; direct host only for LISTEN/NOTIFY |
| Roles / least privilege | `aee_app` runtime role created post-migration; grants applied by migrations |
