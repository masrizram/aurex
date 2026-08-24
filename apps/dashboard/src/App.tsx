import { useEffect, useState, useCallback } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { getMe, logout as apiLogout } from "./api";
import { SessionContext, type Session } from "./lib/session";
import { AppShell } from "./components/AppShell";
import { AuthPage } from "./pages/AuthPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { AdminPage } from "./pages/AdminPage";
import { OverviewPage } from "./pages/OverviewPage";
import { BusinessesPage } from "./pages/BusinessesPage";
import { ObjectivesPage } from "./pages/ObjectivesPage";
import { ObjectiveDetailPage } from "./pages/ObjectiveDetailPage";
import {
  OpportunitiesPage, ExperimentsPage, MissionsPage, ApprovalsPage,
  ResultsPage, EconomicsPage, ActivityPage,
} from "./pages/LoopPages";
import { SettingsPage } from "./pages/SettingsPage";

// ═════════════════════════════════════════════════════════════════
// AUREX — Customer SaaS Router.
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

  const handleLogout = useCallback(async () => {
    try { await apiLogout(); } catch { /* ignore */ }
    setSession(null); setGate("auth"); navigate("/auth/login", { replace: true });
  }, [navigate]);

  if (gate === "loading") {
    return (
      <div style={{ minHeight: "100vh", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#8a8a8a" }}>Memuat…</p>
      </div>
    );
  }

  return (
    <SessionContext.Provider value={session}>
      <Routes>
        {/* Auth lifecycle §6 — publik */}
        <Route path="/auth" element={<Navigate to="/auth/login" replace />} />
        <Route path="/auth/*" element={<AuthPage onAuthed={() => bootstrap()} />} />
        <Route path="/onboarding" element={<OnboardingPage onComplete={() => { setGate("ready"); navigate("/app", { replace: true }); }} />} />
        <Route path="/admin" element={
          session?.isAdmin ? <AdminPage onLogout={handleLogout} />
            : <Navigate to="/app" replace />
        } />

        {/* Customer app — behind shell */}
        <Route path="/app" element={<AppShell onLogout={handleLogout} />}>
          <Route index element={<OverviewPage />} />
          <Route path="businesses" element={<BusinessesPage />} />
          <Route path="objectives" element={<ObjectivesPage />} />
          <Route path="objectives/:objectiveId" element={<ObjectiveDetailPage />} />
          <Route path="opportunities" element={<OpportunitiesPage />} />
          <Route path="experiments" element={<ExperimentsPage />} />
          <Route path="missions" element={<MissionsPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="results" element={<ResultsPage />} />
          <Route path="economics" element={<EconomicsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* Default — unknown → landing root (landing publik diserve di /) */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionContext.Provider>
  );
}
