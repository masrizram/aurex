# AUREX — MIGRATION MAP (shadcn-admin upstream baseline)
# Forensic Phase 0 — 2026-08-25 (auto-generated map, commit a5288ab)

## AUREX_CURRENT_UI_MAP (yang ADA dan harus DIPERTAHANKAN fungsinya)
| Route | File | Data source | Fitur fungsional |
|---|---|---|---|
| /auth/* | AuthPage.tsx (131) | /auth/* cookie | login/signup/verify/forgot/reset + dev verify token |
| /onboarding | OnboardingPage.tsx (209) | /onboarding/step1-5 | wizard 5 step + first analysis polling |
| /app | OverviewPage.tsx (113) | /objectives + /approvals | KPI placeholder, active objective, attention list |
| /app/businesses | BusinessesPage.tsx (67) | /objectives (group by business_name) | daftar bisnis → objectives |
| /app/objectives | ObjectivesPage.tsx (155) | /objectives, POST /objectives | create dialog, phase label mapping |
| /app/objectives/:id | ObjectiveDetailPage.tsx (260) | /objectives/:id + tabs | overview/strategy/execution/result/decision/events |
| /app/opportunities..economics | LoopPages.tsx (422) | /objectives/:id/{opportunities,experiments,missions,results,economics,decisions}, /approvals, /events | aggregate loop pages + actions select/reject/save/let-aurex-decide/approve/reject |
| /app/settings | SettingsPage.tsx (87) | /auth/me + /billing/plan | account + plan + usage |
| /admin | AdminPage.tsx (88) | /admin/overview,users,orgs | overview + users table + orgs table |

Kontrak auth: cookie session (prod), x-user-id hanya dev-mode → UI baru WAJIB cookie-first (fetch sama-origin, tanpa header manual).

## SHADCN_ADMIN_COMPONENT_MAP (upstream e16c87f, MIT © 2024 Sat Naing)
Disalin (adaptasi React Router):
- src/styles/theme.css + index.css (oklch tokens, dark variant, sidebar tokens)
- src/components/ui/* (30 komponen) — sidebar.tsx 728L adalah inti
- layout: app-sidebar, nav-group, nav-user, team-switcher, header, main, top-nav, authenticated-layout
- profile-dropdown, theme-switch, search, command-menu, sign-out-dialog, skip-to-main
- context: theme-provider (cookie), search-provider, layout-provider
- lib: utils (cn, getPageNumbers, getDisplayNameInitials), cookies
- data-table: toolbar, pagination, column-header, faceted-filter, view-options, bulk-actions (TanStack Table)
- settings: sidebar-nav + content-section pattern
- features/auth: auth-layout, sign-in/sign-up/forgot-password form patterns

TIDAK dipakai (demo): features/{dashboard,tasks,users,apps,chats}, Clerk, axios, TanStack Router, react-query, zustand, recharts, input-otp, react-day-picker, react-top-loading-bar, @clerk, config-drawer (opsional nanti), coming-soon.

## MIGRATION_MAP (route → komponen baru)
- /auth/* → AuthLayout (upstream) + Card forms; tanpa sidebar
- /onboarding → wizard Card 6 step (Step X of 6, Progress) tanpa sidebar
- /app → AppShell (SidebarProvider+AppSidebar+SidebarInset+Header+Main) → OverviewPage shadcn (KPI StatCards, requires attention, recommendation, activity)
- /app/businesses → Card list per business → objective rows
- /app/objectives → DataTable (search, filter status, pagination, row action Buka)
- /app/objectives/:id → PageHeader + Summary cards + Tabs (7 tab)
- /app/opportunities|experiments|missions|approvals|results|economics|activity → DataTable/Sheet patterns
- /app/settings → Settings layout (Header + Main + SidebarNav + ContentSection)
- /admin/* → AppShell + DataTable teknis (KIMI/GLM/provider boleh di sini)

Sidebar AUREX (map dari §10): CONTROL CENTER/Overview · BUSINESS/{Businesses,Objectives} · INTELLIGENCE/{Opportunities,Experiments} · EXECUTION/{Missions,Approvals} · PERFORMANCE/{Results,Economics} · SYSTEM/Activity · SETTINGS/Settings — admin hanya jika isAdmin.

## Keputusan arsitektur
1. Router: KEEP React Router DOM v7 (§36) — upstream pattern direproduksi, bukan migrasi TanStack Router.
2. TanStack Table + react-query + zustand: tambahkan (dipakai DataTable pattern upstream) TANPA TanStack Router/axios/Clerk.
3. Bundle tetap single-file vite-plugin-singlefile (deployment pipeline tidak berubah).
4. API client lama (api.ts) dipertahankan kontraknya; ditambah hook useQuery wrappers.
5. x-user-id header DIHAPUS dari default fetch → cookie-only (prod contract). resolveUserId/dev-fallback dihapus.
6. FSM labels: tabel pasangan token (seperti PHASE_ENTRIES lama) — tidak ada string FSM utuh di bundle.
7. License MIT upstream: header NOTICE di src/components/ui/* + file UPSTREAM_LICENSE.md.
