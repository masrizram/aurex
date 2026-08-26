import { useEffect, useState, useCallback } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { getMe } from "./api";
import { SessionContext, type Session } from "./lib/session";
import { ThemeProvider } from "./context/theme-provider";
import { FontProvider } from "./context/font-provider";
import { AuthenticatedLayout } from "./components/layout/authenticated-layout";
import { Toaster } from "@/components/ui/sonner";
import { AuthPage } from "./pages/AuthPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { OverviewPage } from "./pages/OverviewPage";
import { BusinessesPage } from "./pages/BusinessesPage";
import { BusinessDetailPage } from "./pages/BusinessDetailPage";
import { ObjectivesPage } from "./pages/ObjectivesPage";
import { ObjectiveDetailPage } from "./pages/ObjectiveDetailPage";
import { OpportunitiesPage } from "./pages/loop/OpportunitiesPage";
import { ExperimentsPage } from "./pages/loop/ExperimentsPage";
import { DecisionsPage } from "./pages/loop/DecisionsPage";
import { MissionsPage } from "./pages/loop/MissionsPage";
import { ApprovalsPage } from "./pages/loop/ApprovalsPage";
import { ResultsPage } from "./pages/loop/ResultsPage";
import { EconomicsPage } from "./pages/loop/EconomicsPage";
import { ActivityPage } from "./pages/loop/ActivityPage";
import { SettingsPage } from "./pages/SettingsPage";
// Admin Control Center (internal — guard isAdmin)
import { AdminLayout } from "./admin/admin-layout";
import { AdminOverview } from "./admin/modules/overview";
import { AdminUsers } from "./admin/modules/users";
import { AdminOrganizations } from "./admin/modules/organizations";
import { AdminObjectives } from "./admin/modules/objectives";
import { AdminApprovals } from "./admin/modules/approvals";
import { AdminMissions } from "./admin/modules/missions";
import { AdminBilling } from "./admin/modules/billing";
import { AdminProviders } from "./admin/modules/providers";
import { AdminEconomics } from "./admin/modules/economics";
import { AdminSystem } from "./admin/modules/system";
import { AdminAuditLog } from "./admin/modules/audit";

// ═════════════════════════════════════════════════════════════════
// AUREX — Customer SaaS Router (shadcn-admin UI system).
// Navigation mengikuti mental model customer (canonical product flow),
// BUKAN state machine backend. Raw FSM hanya di /admin (isAdmin).
// Guard §4: anonymous → /auth/login; onboarding belum selesai → /onboarding.
// ═════════════════════════════════════════════════════════════════

type Gate = "loading" | "auth" | "onboarding" | "ready";

export function App() {
  const [gate, setGate] = useState<Gate>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const bootstrap = useCallback(async () => {
    try {
      const me = await getMe();
      const sess: Session = {
        userId: me.user.id, email: me.user.email ?? me.user.id, role: me.user.role,
        isAdmin: me.user.isAdmin,
        orgName: me.org?.name ?? null, planTier: me.org?.planTier ?? null,
      };
      setSession(sess);
      if (!me.org || !me.org.onboardingCompleted) setGate("onboarding");
      else setGate("ready");
    } catch {
      // Anonymous: tanpa fallback dev — wajib login (§4).
      setSession(null);
      setGate("auth");
    }
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  // Route guard: redirect sesuai gate
  useEffect(() => {
    if (gate === "loading") return;
    const p = location.pathname;
    // Halaman auth publik (login/signup/verify/forgot/reset) selalu boleh.
    const onAuth = p === "/auth" || p.startsWith("/auth/");
    if (gate === "auth" && !onAuth) navigate("/auth/login", { replace: true });
    if (gate === "onboarding" && !p.startsWith("/onboarding") && !onAuth) {
      navigate("/onboarding", { replace: true });
    }
    if (gate === "ready" && (p === "/" || onAuth || p === "/onboarding")) {
      navigate("/app", { replace: true });
    }
  }, [gate, location.pathname, navigate]);

  if (gate === "loading") {    // Skeleton root sesuai pola loading upstream (bukan blank page).
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" aria-label="Memuat" />
          <p className="text-sm text-muted-foreground">Memuat AUREX…</p>
        </div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <FontProvider>
        <SessionContext.Provider value={session}>
          <Routes>
            {/* Auth lifecycle §6 — publik */}
            <Route path="/auth" element={<Navigate to="/auth/login" replace />} />
            <Route path="/auth/*" element={<AuthPage onAuthed={() => bootstrap()} />} />
            <Route path="/onboarding" element={<OnboardingPage onComplete={() => { setGate("ready"); navigate("/app", { replace: true }); }} />} />

            {/* Customer app — behind shadcn-admin shell */}
            <Route path="/app" element={<AuthenticatedLayout session={session} />}>
              <Route index element={<OverviewPage />} />
              <Route path="businesses" element={<BusinessesPage />} />
              <Route path="businesses/:businessId" element={<BusinessDetailPage />} />
              <Route path="objectives" element={<ObjectivesPage />} />
              <Route path="objectives/:objectiveId" element={<ObjectiveDetailPage />} />
              <Route path="opportunities" element={<OpportunitiesPage />} />
              <Route path="experiments" element={<ExperimentsPage />} />
              <Route path="decisions" element={<DecisionsPage />} />
              <Route path="missions" element={<MissionsPage />} />
              <Route path="approvals" element={<ApprovalsPage />} />
              <Route path="results" element={<ResultsPage />} />
              <Route path="economics" element={<EconomicsPage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>

            {/* Admin Control Center — internal, guard isAdmin; same shell layout */}
            <Route path="/admin" element={<AdminLayout session={session} />}>
              <Route index element={<AdminOverview />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="orgs" element={<AdminOrganizations />} />
              <Route path="objectives" element={<AdminObjectives />} />
              <Route path="approvals" element={<AdminApprovals />} />
              <Route path="missions" element={<AdminMissions />} />
              <Route path="billing" element={<AdminBilling />} />
              <Route path="providers" element={<AdminProviders />} />
              <Route path="economics" element={<AdminEconomics />} />
              <Route path="system" element={<AdminSystem />} />
              <Route path="audit" element={<AdminAuditLog />} />
            </Route>

            {/* Default — unknown → landing root (landing publik diserve di /) */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          {/* CommandMenu TIDAK dipasang global di sini — ia dirender oleh
              SearchProvider (search-provider.tsx), sesuai pola upstream
              shadcn-admin. Mount global = useSearch() di luar provider =
              crash seluruh app (P1, 2026-08-25). */}
          <Toaster position="top-right" richColors />
        </SessionContext.Provider>
      </FontProvider>
    </ThemeProvider>
  );
}
