import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";

// ═════════════════════════════════════════════════════════════════
// AUREX — Customer App Shell (Economic Control Center)
// Sidebar mengikuti mental model customer, BUKAN state machine backend.
// TIDAK menampilkan KIMI/GLM/token/latency — itu milik /admin.
// ═════════════════════════════════════════════════════════════════

const NAV: { section: string; items: { to: string; label: string }[] }[] = [
  { section: "CONTROL CENTER", items: [{ to: "/app", label: "Overview" }] },
  {
    section: "BUSINESS",
    items: [
      { to: "/app/businesses", label: "Businesses" },
      { to: "/app/objectives", label: "Objectives" },
    ],
  },
  {
    section: "INTELLIGENCE",
    items: [
      { to: "/app/opportunities", label: "Opportunities" },
      { to: "/app/experiments", label: "Experiments" },
    ],
  },
  {
    section: "EXECUTION",
    items: [
      { to: "/app/missions", label: "Missions" },
      { to: "/app/approvals", label: "Approvals" },
    ],
  },
  {
    section: "PERFORMANCE",
    items: [
      { to: "/app/results", label: "Results" },
      { to: "/app/economics", label: "Economics" },
    ],
  },
  { section: "SYSTEM", items: [{ to: "/app/activity", label: "Activity" }] },
];

export function AppShell({ onLogout }: { onLogout: () => void }) {
  const session = useSession();
  const navigate = useNavigate();
  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <div className="shell-brand" onClick={() => navigate("/app")} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter") navigate("/app"); }}>
          AUREX
        </div>
        <nav className="shell-nav" aria-label="Control Center">
          {NAV.map((grp) => (
            <div key={grp.section} className="shell-nav-group">
              <div className="shell-nav-section">{grp.section}</div>
              {grp.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.to === "/app"}
                  className={({ isActive }) => "shell-nav-item" + (isActive ? " is-active" : "")}
                >
                  {it.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="shell-sidebar-foot">
          <NavLink to="/app/settings" className={({ isActive }) => "shell-nav-item" + (isActive ? " is-active" : "")}>
            Settings
          </NavLink>
          {session.isAdmin && (
            <button className="shell-link-btn" onClick={() => navigate("/admin")}>Admin</button>
          )}
          <button className="shell-link-btn" onClick={onLogout}>Keluar</button>
        </div>
      </aside>
      <div className="shell-main">
        <header className="shell-topbar">
          <div className="shell-topbar-org">{session.orgName ?? "AUREX"}</div>
          <div className="shell-topbar-right">
            <span className="shell-topbar-plan">{session.planTier ?? "—"}</span>
            <span className="shell-topbar-acct" title={session.email}>{session.email}</span>
          </div>
        </header>
        <main className="shell-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
