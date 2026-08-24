# AEE — COMPLETE APPLICATION FLOW

> Spec locked. Implementasi mengikuti urutan ini. Setiap step harus mulus sebelum monetisasi.

## Customer Journey (Happy Path)

```
1. Sign Up
   ├─ Email + password → akun dibuat (role=owner)
   ├─ Organization auto-created (slug dari email)
   └─ Session cookie diterima → redirect /app

2. Onboarding Wizard (5 langkah, wajib sebelum akses dashboard)
   ├─ Step 1: Tell AEE about your business
   │   └─ name, industry, website, products, target_customers
   ├─ Step 2: What do you want to achieve?
   │   └─ goal_type: increase_profit | reduce_cost | find_opportunities | launch_new | improve_growth
   ├─ Step 3: Economic context
   │   └─ current_revenue, current_cost, capital, time_horizon_months
   ├─ Step 4: Autonomy preference
   │   └─ autonomy_level: ADVISORY(1) | APPROVAL(2) | CONTROLLED_AUTONOMY(3)
   └─ Step 5: AEE starts
       └─ "We are analyzing your business" → create objective → start → redirect dashboard

3. Dashboard (Economic Control Center)
   ├─ Objective aktif dengan live FSM progress
   ├─ Opportunities table (ranked)
   ├─ Strategy / Venture / Experiment tabs
   ├─ Events timeline (lineage audit)
   ├─ Approvals queue (autonomy-1/2)
   └─ Environment badge (SIMULATED/PROJECTED/OBSERVED/VERIFIED)

4. Settings
   ├─ Organization profile + plan tier
   ├─ Usage credits (monthly limit, used, remaining)
   ├─ Team members (invite, role)
   └─ API keys

5. Admin (role=admin only)
   ├─ Platform overview (total users, orgs, objectives, revenue)
   ├─ User management (list, suspend, role change)
   ├─ Organization management
   └─ Objective oversight (stop, retry)
```

## API Surface

```
Auth:
  POST   /auth/signup          {email, password, org_name?}       → {user, org, session_cookie}
  POST   /auth/login           {email, password}                  → {user, session_cookie}
  POST   /auth/logout          {}                                  → {}
  GET    /auth/me                                                  → {user, org, membership, usage}

Onboarding:
  GET    /onboarding/status                                        → {step, completed}
  POST   /onboarding/step1     {business_name, industry, ...}      → {venture_id}
  POST   /onboarding/step2     {goal_type}                          → {goal_type}
  POST   /onboarding/step3     {revenue, cost, capital, horizon}    → {economics}
  POST   /onboarding/step4     {autonomy_level}                     → {autonomy_level}
  POST   /onboarding/step5     {title, target_profit}               → {objective_id, cycle_id} → start

Billing:
  GET    /billing/plan                                             → {plan, usage}
  POST   /billing/topup       {amount}                             → {balance} (stub)

Admin:
  GET    /admin/overview                                          → {users, orgs, objectives, revenue}
  GET    /admin/users                                              → [{id, email, role, org, status}]
  PATCH  /admin/users/:id     {role?, status?}                    → {user}
  GET    /admin/orgs                                              → [{id, name, plan, members}]
  GET    /admin/objectives                                        → [{id, title, state, org, user}]
  POST   /admin/objectives/:id/stop   {reason}                    → {state: STOPPED}

Existing (unchanged):
  GET    /objectives, /objectives/:id, /objectives/:id/opportunities
  POST   /objectives, /objectives/:id/start, /objectives/:id/retry
  GET    /approvals, /events, /agent-mode
  POST   /approvals/:id/approve, /approvals/:id/reject
```

## DB Changes (Migration 005)

```sql
-- sessions (cookie-based auth)
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- users: add name, status, is_admin
ALTER TABLE users ADD COLUMN name text;
ALTER TABLE users ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status = ANY(ARRAY['ACTIVE','SUSPENDED','DELETED']));

-- organizations: add onboarding fields
ALTER TABLE organizations ADD COLUMN onboarding_step int NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN onboarding_completed timestamptz;

-- business_ventures: add onboarding fields
ALTER TABLE business_ventures ADD COLUMN website text;
ALTER TABLE business_ventures ADD COLUMN products text;
ALTER TABLE business_ventures ADD COLUMN goal_type text;
ALTER TABLE business_ventures ADD COLUMN current_revenue numeric(15,2) DEFAULT 0;
ALTER TABLE business_ventures ADD COLUMN current_cost numeric(15,2) DEFAULT 0;
ALTER TABLE business_ventures ADD COLUMN time_horizon_months int DEFAULT 3;
```

## Routing

```
/           → Landing page (public marketing)
/app        → SPA dashboard (auth required, cookie or X-User-Id fallback)
/admin      → Admin panel (role=admin)
/api/*      → REST API (existing + new endpoints)
```

## Gates

```
tsc=0 · vitest 136+ · build OK · E2E smoke: signup → onboarding 5 step → dashboard → objective running
```
