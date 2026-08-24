# AUREX — Frontend Architecture Freeze (P0)

Keputusan ini membekukan pemisahan concern yang ditemukan audit. **Backend FSM & engine tidak berubah** — yang dibekukan adalah information architecture di atasnya.

## Ownership

| Path / App | Peran | Boleh menampilkan |
|---|---|---|
| `apps/landing` | **Public website** (acquisition) | Value prop, platform, solutions, pricing. Tanpa nama model AI sebagai headline. |
| `apps/dashboard` (`/app/*`) | **Customer SaaS — SINGLE SOURCE OF TRUTH** | Mental model customer: Bisnis → Tujuan → Peluang → Eksperimen → Misi → Hasil → Uang → Keputusan. |
| `apps/dashboard` (`/admin/*`) | **Internal/operator surface** | KIMI/GLM, token, latency, FSM state, jobs, errors, provider health. |
| `packages/api` | **API only** | REST boundary. Bukan UI. |
| `packages/orchestrator` | **Engine (FSM)** | Internal state machine. TIDAK bocor ke customer UX. |
| `packages/agents` | **KIMI/GLM** | Intelligence + execution. Identitas model TIDAK tampil di customer surface. |

## Aturan keras

1. **Raw FSM terminology** (`RESULT_READY`, `MISSION_CREATED`, `OBJECTIVE_CREATED`, stage pill, `MODEL_RUN`, token count, latency, `KIMI k3`, `GLM 5.2`) **dilarang di `/app/*` customer UX.** Hanya boleh di `/admin/*`.
2. **Domain hierarchy canonical** (P2): `ORGANIZATION → BUSINESS → OBJECTIVE → OPPORTUNITY → EXPERIMENT → MISSION → EXECUTION → RESULT → DECISION`.
3. `apps/dashboard` React = satu-satunya customer UI. Static `packages/api/assets/*.html` didepresiasi setelah React build terverifikasi di deployment path (migrate → verify → delete).
4. Internal engine state (`RESEARCH → RANK → MISSION_CREATED → RESULT_READY`) adalah **engine state**, dipetakan ke bahasa manusia di presentation layer — tidak pernah di-render mentah.

## Route map (P1)

```
PUBLIC      /                apps/landing
AUTH        /auth/login  /auth/signup  (verify/forgot = ditunda, P-later)
ONBOARDING  /onboarding      wizard (P5 reorder)
APP         /app             Overview (Control Center)
            /app/businesses  /app/businesses/:businessId
            /app/objectives  /app/objectives/:objectiveId
            /app/opportunities
            /app/experiments
            /app/missions
            /app/approvals
            /app/results
            /app/economics
            /app/activity
            /app/settings/*  (P6: account, billing)
ADMIN       /admin           internal operator (route terpisah dari /app)
```
