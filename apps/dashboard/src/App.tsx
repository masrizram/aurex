import { useCallback, useEffect, useState } from "react";
import {
  type AgentMode, type ObjectiveListItem, type ObjectiveDetail,
  type AeeEvent, type Approval, type OppSummary,
  getMode, listObjectives, getObjectiveDetail,
  createObjective, startObjective, listApprovals,
  approveDecision, rejectDecision, parseApiError, listEvents, listOpportunities,
  getMe, logout as apiLogout,
} from "./api";
import { AuthScreen, OnboardingWizard, AdminPanel } from "./pages";

// ═════════════════════════════════════════════════════════════════
// Econos — Economic Control Center
// Design system: McKinsey (Global Management Consulting)
// Implementation per DESIGN.md tokens + component state rules
// ═════════════════════════════════════════════════════════════════

const USER_ID_KEY = "aee-user-id";
const DEFAULT_USER = "25896200-49df-453f-9138-71caf6fb90f2";
const POLL_MS = 5000;

type View = "list" | "detail" | "create";
type Tab = "business" | "economics" | "strategy" | "execution" | "result" | "decision";
type Screen = "auth" | "onboarding" | "dashboard" | "admin";

export function App() {
  const [screen, setScreen] = useState<Screen>("auth");
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Check auth on mount
  useEffect(() => {
    getMe().then(me => {
      if (!me.org || !me.org.onboardingCompleted) {
        setScreen("onboarding");
      } else if (window.location.hash === "#admin" || me.user.isAdmin) {
        setScreen(me.user.isAdmin ? "admin" : "dashboard");
      } else {
        setScreen("dashboard");
      }
      setIsAdmin(me.user.isAdmin);
    }).catch(() => {
      // Fallback: check X-User-Id (demo mode)
      const uid = localStorage.getItem("aee-user-id") || "25896200-49df-453f-9138-71caf6fb90f2";
      localStorage.setItem("aee-user-id", uid);
      setScreen("dashboard");
    }).finally(() => setAuthChecked(true));
  }, []);

  const handleLogout = useCallback(async () => {
    try { await apiLogout(); } catch {}
    setScreen("auth");
  }, []);

  if (!authChecked) {
    return <div style={{ minHeight: "100vh", background: "#000000", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#8a8a8a" }}>Memuat...</p>
    </div>;
  }

  if (screen === "auth") {
    return <AuthScreen onAuthed={() => {
      getMe().then(me => {
        if (!me.org || !me.org.onboardingCompleted) setScreen("onboarding");
        else setScreen("dashboard");
      }).catch(() => setScreen("dashboard"));
    }} />;
  }

  if (screen === "onboarding") {
    return <OnboardingWizard onComplete={() => setScreen("dashboard")} onLogout={handleLogout} />;
  }

  if (screen === "admin") {
    return <AdminPanel onLogout={handleLogout} />;
  }

  return <Dashboard onLogout={handleLogout} isAdmin={isAdmin} onAdmin={() => setScreen("admin")} />;
}

// ═════════════════════════════════════════════════════════════════
// Dashboard (existing — extracted from App)
// ═════════════════════════════════════════════════════════════════
// Dashboard
// ═════════════════════════════════════════════════════════════════

function Dashboard({ onLogout, isAdmin, onAdmin }: { onLogout: () => void; isAdmin: boolean; onAdmin: () => void }) {
  const [view, setView] = useState<View>("list");
  const [mode, setMode] = useState<AgentMode | null>(null);
  const [objectives, setObjectives] = useState<ObjectiveListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ObjectiveDetail | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [events, setEvents] = useState<AeeEvent[]>([]);
  const [opps, setOpps] = useState<OppSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [userId] = useState(() => localStorage.getItem(USER_ID_KEY) || DEFAULT_USER);

  // ── Poll objectives list ──
  const refreshList = useCallback(async () => {
    try {
      const [modeData, objData] = await Promise.all([
        getMode(),
        listObjectives(userId),
      ]);
      setMode(modeData);
      setObjectives(objData);
      setError(null);
    } catch (e) {
      setError(parseApiError(e));
    }
  }, [userId]);

  // ── Fetch detail ──
  const refreshDetail = useCallback(async (id: string) => {
    try {
      const [det, appr, evts, oppList] = await Promise.all([
        getObjectiveDetail(id, userId),
        listApprovals(id, userId),
        listEvents(id, userId),
        listOpportunities(id, userId),
      ]);
      setDetail(det);
      setApprovals(appr);
      setEvents(evts);
      setOpps(oppList);
      setError(null);
    } catch (e) {
      setError(parseApiError(e));
    }
  }, [userId]);

  // ── Polling ──
  useEffect(() => {
    if (view === "list") {
      refreshList();
      const t = setInterval(refreshList, POLL_MS);
      return () => clearInterval(t);
    }
    if (view === "detail" && selectedId) {
      refreshDetail(selectedId);
      const t = setInterval(() => refreshDetail(selectedId), POLL_MS);
      return () => clearInterval(t);
    }
  }, [view, selectedId, refreshList, refreshDetail]);

  // ── Actions ──
  const openDetail = (id: string) => {
    setSelectedId(id);
    setView("detail");
  };

  const handleStart = async (id: string) => {
    try {
      await startObjective(id, userId);
      await refreshDetail(id);
    } catch (e) {
      setError(parseApiError(e));
    }
  };

  const handleApprove = async (decisionId: string) => {
    try {
      await approveDecision(decisionId, userId);
      if (selectedId) await refreshDetail(selectedId);
    } catch (e) {
      setError(parseApiError(e));
    }
  };

  const handleReject = async (decisionId: string) => {
    try {
      await rejectDecision(decisionId, userId);
      if (selectedId) await refreshDetail(selectedId);
    } catch (e) {
      setError(parseApiError(e));
    }
  };

  // ═══ Render ═══
  return (
    <div className="app">
      <Header mode={mode} />
      <main className="app-main">
        {error && <ErrorBanner message={error} onRetry={() => {
          setError(null);
          if (view === "list") refreshList();
          else if (selectedId) refreshDetail(selectedId);
        }} />}
        {view === "list" && (
          <ListView
            objectives={objectives}
            loading={loading}
            onCreate={() => setView("create")}
            onOpen={openDetail}
          />
        )}
        {view === "detail" && detail && (
          <DetailView
            detail={detail}
            approvals={approvals}
            events={events}
            opportunities={opps}
            onBack={() => { setView("list"); setDetail(null); }}
            onStart={handleStart}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        )}
        {view === "create" && (
          <CreateView
            userId={userId}
            onCreated={(id) => { setView("detail"); setSelectedId(id); }}
            onCancel={() => setView("list")}
          />
        )}
      </main>
      <Footer />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Header
// ═════════════════════════════════════════════════════════════════
function Header({ mode }: { mode: AgentMode | null }) {
  return (
    <header className="app-header" role="banner">
      <div className="app-header-inner">
        <a href="/" className="app-brand" aria-label="Econos Economic Control Center">
          <span className="app-brand-accent">AEE</span> — Economic Control Center
        </a>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          {mode && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
              <span className="mode-badge" data-mode={mode.mode} tabIndex={0}
                aria-label={`Mode ${mode.mode}`}>
                {mode.mode}
              </span>
              <span className="model-info">
                <span>KIMI {mode.kimi?.model || "—"}</span>
                <span>GLM {mode.glm?.model || "—"}</span>
              </span>
            </div>
          )}
          {isAdmin && (
            <button onClick={onAdmin} style={navBtnStyle}>Admin</button>
          )}
          <button onClick={onLogout} style={navBtnStyle}>Keluar</button>
        </div>
      </div>
    </header>
  );
}

const navBtnStyle: React.CSSProperties = {
  background: "transparent", border: "1px solid #2a2a2a", borderRadius: "12px",
  color: "#8a8a8a", fontSize: "13px", padding: "8px 16px", cursor: "pointer",
  fontWeight: 300, transition: "color 120ms, border-color 120ms",
};

// ═════════════════════════════════════════════════════════════════
// List View
// ═════════════════════════════════════════════════════════════════
function ListView({ objectives, loading, onCreate, onOpen }: {
  objectives: ObjectiveListItem[];
  loading: boolean;
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  const active = objectives.filter(o => o.status === "ACTIVE");
  const done = objectives.filter(o => o.status !== "ACTIVE");

  return (
    <div>
      <h1 className="page-title">Objectives</h1>
      <p className="page-subtitle">
        {objectives.length} total — {active.length} active, {done.length} completed
      </p>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "var(--space-6)" }}>
        <button className="btn btn--primary" onClick={onCreate}>
          + New Objective
        </button>
      </div>

      {loading && objectives.length === 0 ? (
        <div className="skeleton">
          <span className="skeleton-pulse" />
          Memuat objectives…
        </div>
      ) : objectives.length === 0 ? (
        <div className="empty-state">
          {/* G6: Action dashboard — welcome state with intent buttons */}
          <p className="empty-state-title">Welcome to AEE</p>
          <p className="empty-state-desc">What would you like to achieve?</p>
          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-5)", flexWrap: "wrap" }}>
            <button className="btn btn--primary" onClick={onCreate}>Increase Profit</button>
            <button className="btn" onClick={onCreate}>Reduce Cost</button>
            <button className="btn" onClick={onCreate}>Find Growth</button>
            <button className="btn" onClick={onCreate}>Explore New Venture</button>
          </div>
        </div>
      ) : (
        <div role="list" aria-label="Objective list">
          {objectives.map(o => (
            <div
              key={o.id}
              className="obj-row"
              role="listitem"
              tabIndex={0}
              onClick={() => onOpen(o.id)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(o.id); } }}
              aria-label={`Objective: ${o.title}, status: ${o.status}`}
            >
              <div style={{ overflow: "hidden" }}>
                <div className="obj-row-name">{o.title}</div>
                <div className="obj-row-meta">
                  {o.industry || "—"} · {o.business_mode || "—"}
                </div>
              </div>
              <span className="pill" data-stage={o.stage}>{o.stage}</span>
              <span className="obj-row-meta" data-mono style={{ fontFamily: "var(--font-mono)" }}>
                {o.id.slice(0, 8)}
              </span>
              <div style={{ textAlign: "right" }}>
                <div className="progress-track" aria-label="Progress">
                  <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, o.progress || 0))}%` }} />
                </div>
                <div className="obj-row-meta" style={{ marginTop: "var(--space-1)" }}>
                  {Math.round(o.progress || 0)}%
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Detail View
// ═════════════════════════════════════════════════════════════════
function DetailView({ detail, approvals, events, opportunities, onBack, onStart, onApprove, onReject }: {
  detail: ObjectiveDetail;
  approvals: Approval[];
  events: AeeEvent[];
  opportunities: OppSummary[];
  onBack: () => void;
  onStart: (id: string) => void;
  onApprove: (decisionId: string) => void;
  onReject: (decisionId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("business");
  const TABS: { id: Tab; label: string }[] = [
    { id: "business", label: "Business" },
    { id: "economics", label: "Economics" },
    { id: "strategy", label: "Strategy" },
    { id: "execution", label: "Execution" },
    { id: "result", label: "Result" },
    { id: "decision", label: "Decision" },
  ];

  const ev = events || [];
  const biz = detail.business;

  return (
    <div>
      <button className="btn btn--sm" onClick={onBack} style={{ marginBottom: "var(--space-5)" }}>
        ← Back
      </button>

      <h1 className="page-title">{detail.title}</h1>
      <p className="page-subtitle">
        {detail.industry || "—"} · {detail.business_mode || "—"} · {detail.status}
      </p>
      {/* G8: Terminal-state special treatment */}
      {detail.status === "ACHIEVED" && (
        <div className="card" style={{ marginBottom: "var(--space-5)", borderColor: "#00a9f4" }}>
          <h3 style={{ color: "#00a9f4", fontSize: "18px", fontWeight: 400 }}>🎯 Objective Achieved</h3>
          <p style={{ color: "#ffffff", fontSize: "14px", marginTop: "8px" }}>
            Target: {detail.economics?.revenue_target ? `Rp${(detail.economics.revenue_target/1e6).toFixed(0)}M` : "—"}
            {" · "}Actual: {detail.result?.actual_revenue ? `Rp${(detail.result.actual_revenue/1e6).toFixed(0)}M` : "—"}
          </p>
          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
            <button className="btn btn--sm">Review Results</button>
            <button className="btn btn--primary btn--sm">Create Next Objective</button>
          </div>
        </div>
      )}
      {(detail.status === "STOPPED" || detail.status === "ABORTED") && (
        <div className="card" style={{ marginBottom: "var(--space-5)", borderColor: "#ff5252" }}>
          <h3 style={{ color: "#ff5252", fontSize: "18px", fontWeight: 400 }}>Objective Stopped</h3>
          <p style={{ color: "#8a8a8a", fontSize: "14px", marginTop: "8px" }}>Reason: operational stop / abort</p>
          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
            <button className="btn btn--sm">Review</button>
            <button className="btn btn--sm">Clone / Resume</button>
          </div>
        </div>
      )}
      {detail.status === "DECISION_READY" && (
        <div className="card" style={{ marginBottom: "var(--space-5)", borderColor: "#2251ff" }}>
          <h3 style={{ color: "#2251ff", fontSize: "18px", fontWeight: 400 }}>AEE Recommends: {detail.decision?.recommendation || "—"}</h3>
          <p style={{ color: "#8a8a8a", fontSize: "14px", marginTop: "8px" }}>
            Confidence: {detail.decision?.confidence != null ? `${detail.decision.confidence.toFixed(0)}%` : "—"}
          </p>
          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
            <button className="btn btn--primary btn--sm">Review Decision</button>
            <button className="btn btn--sm">Approve</button>
            <button className="btn btn--sm">Stop</button>
          </div>
        </div>
      )}

      <div className="stat-strip">
        <div className="stat">
          <div className="stat-label">Stage</div>
          <div className="stat-value" style={{ fontSize: "var(--font-size-lg)" }}>{detail.stage}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Progress</div>
          <div className="stat-value">{Math.round(detail.progress || 0)}%</div>
        </div>
        <div className="stat">
          <div className="stat-label">Revenue Target</div>
          <div className="stat-value" style={{ fontSize: "var(--font-size-lg)" }}>
            {detail.economics?.revenue_target ? `Rp${(detail.economics.revenue_target / 1e6).toFixed(0)}M` : "—"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Margin</div>
          <div className="stat-value" style={{ fontSize: "var(--font-size-lg)" }}>
            {detail.economics?.gross_margin != null ? `${detail.economics.gross_margin.toFixed(1)}%` : "—"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Economic Truth</div>
          <div className="stat-value" style={{ fontSize: "var(--font-size-lg)", color:
            detail.environment === "VERIFIED" ? "#00a9f4" :
            detail.environment === "OBSERVED" ? "#2251ff" :
            detail.environment === "PROJECTED" ? "#8a8a8a" : "#8a8a8a" }}>
            {detail.environment || "SIMULATED"}
          </div>
          <div className="stat-detail">SIMULATED → PROJECTED → OBSERVED → VERIFIED</div>
        </div>
      </div>

      {detail.status === "ACTIVE" && detail.stage === "APPROVED" && (
        <div style={{ marginBottom: "var(--space-5)" }}>
          <button className="btn btn--primary" onClick={() => onStart(detail.id)}>
            Start Execution
          </button>
        </div>
      )}

      <div className="tab-bar" role="tablist" aria-label="Objective detail tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className="tab"
            role="tab"
            aria-selected={tab === t.id}
            data-active={tab === t.id}
            onClick={() => setTab(t.id)}
            onKeyDown={e => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const idx = TABS.findIndex(x => x.id === tab);
                const next = e.key === "ArrowRight" ? (idx + 1) % TABS.length : (idx - 1 + TABS.length) % TABS.length;
                setTab(TABS[next].id);
              }
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "business" && <BusinessTab detail={detail} />}
        {tab === "economics" && <EconomicsTab detail={detail} />}
        {tab === "strategy" && <StrategyTab detail={detail} opportunities={opportunities} />}
        {tab === "execution" && <ExecutionTab detail={detail} />}
        {tab === "result" && <ResultTab detail={detail} />}
        {tab === "decision" && (
          <DecisionTab
            detail={detail}
            approvals={approvals}
            onApprove={onApprove}
            onReject={onReject}
          />
        )}
      </div>

      <div style={{ marginTop: "var(--space-8)" }}>
        <h2 className="section-heading">Event Lineage</h2>
        <div className="event-list">
          {ev.slice(0, 30).map((e, i) => (
            <div key={i} className="event-row">
              <span className="event-time">{e.created_at ? new Date(e.created_at).toLocaleString("id-ID") : "—"}</span>
              <div>
                <div className="event-type">{e.event_type}</div>
                {e.message && <div className="event-detail">{e.message}</div>}
              </div>
              <span className="event-stage">{e.stage}</span>
            </div>
          ))}
          {ev.length === 0 && <p className="event-detail">Belum ada event.</p>}
        </div>
      </div>
    </div>
  );
}

// ═══ Tabs ═══
function BusinessTab({ detail }: { detail: ObjectiveDetail }) {
  const b = detail.business;
  if (!b) return <div className="empty-state"><p className="empty-state-desc">Data bisnis belum tersedia.</p></div>;
  return (
    <div className="kv-grid">
      <div className="kv-key">Venture</div><div className="kv-val">{b.name || "—"}</div>
      <div className="kv-key">Industry</div><div className="kv-val">{b.industry || "—"}</div>
      <div className="kv-key">Market</div><div className="kv-val">{b.market || "—"}</div>
      <div className="kv-key">Target Customer</div><div className="kv-val">{b.target_customer || "—"}</div>
      <div className="kv-key">Problem</div><div className="kv-val">{b.problem || "—"}</div>
      <div className="kv-key">Solution</div><div className="kv-val">{b.solution || "—"}</div>
      <div className="kv-key">Business Model</div><div className="kv-val">{b.business_model || "—"}</div>
      <div className="kv-key">Price</div><div className="kv-val">{b.price ? `Rp${b.price.toLocaleString("id-ID")}` : "—"}</div>
    </div>
  );
}

function EconomicsTab({ detail }: { detail: ObjectiveDetail }) {
  const ec = detail.economics;
  if (!ec) return <div className="empty-state"><p className="empty-state-desc">Data ekonomi belum tersedia.</p></div>;
  return (
    <div className="table-wrap">
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col" data-align="numeric">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Revenue Target</td><td data-align="numeric">{ec.revenue_target ? `Rp${ec.revenue_target.toLocaleString("id-ID")}` : "—"}</td></tr>
            <tr><td>Unit Price</td><td data-align="numeric">{ec.unit_price ? `Rp${ec.unit_price.toLocaleString("id-ID")}` : "—"}</td></tr>
            <tr><td>Unit Cost</td><td data-align="numeric">{ec.unit_cost ? `Rp${ec.unit_cost.toLocaleString("id-ID")}` : "—"}</td></tr>
            <tr><td>Gross Margin</td><td data-align="numeric">{ec.gross_margin != null ? `${ec.gross_margin.toFixed(1)}%` : "—"}</td></tr>
            <tr><td>Operating Profit</td><td data-align="numeric">{ec.operating_profit ? `Rp${ec.operating_profit.toLocaleString("id-ID")}` : "—"}</td></tr>
            <tr><td>ROI</td><td data-align="numeric">{ec.roi != null ? `${ec.roi.toFixed(1)}%` : "—"}</td></tr>
            <tr><td>Break-even</td><td data-align="numeric">{ec.break_even_units != null ? `${ec.break_even_units} units` : "—"}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StrategyTab({ detail, opportunities }: { detail: ObjectiveDetail; opportunities: OppSummary[] }) {
  const s = detail.strategy;
  return (
    <div>
      {s && (
        <div className="kv-grid" style={{ marginBottom: "var(--space-6)" }}>
          <div className="kv-key">Opportunity</div><div className="kv-val">{s.opportunity_name || "—"}</div>
          <div className="kv-key">Hypothesis</div><div className="kv-val">{s.hypothesis || "—"}</div>
        </div>
      )}
      {opportunities.length > 0 && (
        <div>
          <h3 className="section-heading" style={{ fontSize: "var(--font-size-md)" }}>Opportunities Researched</h3>
          <div className="table-wrap">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Status</th>
                    <th scope="col">Business Model</th>
                    <th scope="col" data-align="numeric">Risk</th>
                    <th scope="col" data-align="numeric">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {opportunities.map(o => (
                    <tr key={o.id}>
                      <td>{o.name}</td>
                      <td><span className="pill" data-stage={o.status === "SELECTED" ? "APPROVED" : "RESEARCHING"}>{o.status}</span></td>
                      <td>{o.business_model}</td>
                      <td data-align="numeric">{o.risk_score ?? "—"}</td>
                      <td data-align="numeric">{o.risk_adjusted_score ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {opportunities.length === 0 && !s && (
        <div className="empty-state"><p className="empty-state-desc">Data strategi belum tersedia.</p></div>
      )}
    </div>
  );
}

function ExecutionTab({ detail }: { detail: ObjectiveDetail }) {
  const ex = detail.execution;
  if (!ex) return <div className="empty-state"><p className="empty-state-desc">Data eksekusi belum tersedia.</p></div>;
  return (
    <div className="kv-grid">
      <div className="kv-key">Timeline</div><div className="kv-val">{ex.timeline || "—"}</div>
      <div className="kv-key">Milestones</div><div className="kv-val">{ex.milestones || "—"}</div>
      <div className="kv-key">Resources</div><div className="kv-val">{ex.resources || "—"}</div>
      <div className="kv-key">Risks</div><div className="kv-val">{ex.risks || "—"}</div>
    </div>
  );
}

function ResultTab({ detail }: { detail: ObjectiveDetail }) {
  const r = detail.result;
  if (!r) return <div className="empty-state"><p className="empty-state-desc">Hasil belum tersedia.</p></div>;
  const fmtRp = (v?: number) => v != null ? `Rp${v.toLocaleString("id-ID")}` : "—";
  const profit = r.actual_profit != null ? r.actual_profit : r.projected_profit;
  const isProfit = profit != null && profit > 0;
  return (
    <div>
      {/* G7: Narrative summary */}
      <div className="card" style={{ marginBottom: "var(--space-6)" }}>
        <h3 className="section-heading" style={{ fontSize: "var(--font-size-md)" }}>What Happened</h3>
        <div style={{ display: "flex", gap: "var(--space-6)", marginTop: "var(--space-4)" }}>
          <div>
            <div style={{ color: "#8a8a8a", fontSize: "13px" }}>Revenue</div>
            <div style={{ color: "#ffffff", fontSize: "24px", fontWeight: 300 }}>{fmtRp(r.actual_revenue ?? r.projected_revenue)}</div>
          </div>
          <div>
            <div style={{ color: "#8a8a8a", fontSize: "13px" }}>Customers</div>
            <div style={{ color: "#ffffff", fontSize: "24px", fontWeight: 300 }}>{r.actual_customers ?? r.projected_customers ?? "—"}</div>
          </div>
          <div>
            <div style={{ color: "#8a8a8a", fontSize: "13px" }}>Profit</div>
            <div style={{ color: isProfit ? "#00a9f4" : "#ff5252", fontSize: "24px", fontWeight: 300 }}>{fmtRp(profit)}</div>
          </div>
        </div>
      </div>
      {/* Projected vs Actual table */}
      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col" data-align="numeric">Projected</th>
                <th scope="col" data-align="numeric">Actual</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Revenue</td><td data-align="numeric">{fmtRp(r.projected_revenue)}</td><td data-align="numeric">{fmtRp(r.actual_revenue)}</td></tr>
              <tr><td>Customers</td><td data-align="numeric">{r.projected_customers ?? "—"}</td><td data-align="numeric">{r.actual_customers ?? "—"}</td></tr>
              <tr><td>Profit</td><td data-align="numeric">{fmtRp(r.projected_profit)}</td><td data-align="numeric">{fmtRp(r.actual_profit)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      {/* G7: Next action buttons */}
      <div style={{ marginTop: "var(--space-6)" }}>
        <h3 className="section-heading" style={{ fontSize: "var(--font-size-md)" }}>Next Action</h3>
        <div style={{ display: "flex", gap: "var(--space-3)" }}>
          {detail.decision && <span className="pill" data-stage="APPROVED">{detail.decision.recommendation}</span>}
          <button className="btn btn--primary btn--sm">Approve Next Cycle</button>
          <button className="btn btn--sm">Stop Objective</button>
        </div>
      </div>
    </div>
  );
}

function DecisionTab({ detail, approvals, onApprove, onReject }: {
  detail: ObjectiveDetail;
  approvals: Approval[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div>
      {detail.decision && (
        <div className="card" style={{ marginBottom: "var(--space-6)" }}>
          <h3 className="section-heading" style={{ fontSize: "var(--font-size-md)" }}>Decision</h3>
          <div className="kv-grid">
            <div className="kv-key">Recommendation</div><div className="kv-val">{detail.decision.recommendation || "—"}</div>
            <div className="kv-key">Confidence</div><div className="kv-val">{detail.decision.confidence != null ? `${detail.decision.confidence.toFixed(0)}%` : "—"}</div>
            <div className="kv-key">Rationale</div><div className="kv-val">{detail.decision.rationale || "—"}</div>
          </div>
        </div>
      )}
      {approvals.length > 0 && (
        <div>
          <h3 className="section-heading" style={{ fontSize: "var(--font-size-md)" }}>Pending Approvals</h3>
          {approvals.map(a => (
            <div key={a.id} className="card" style={{ marginBottom: "var(--space-4)" }}>
              <div className="kv-grid">
                <div className="kv-key">Type</div><div className="kv-val">{a.decision_type}</div>
                <div className="kv-key">Stage</div><div className="kv-val">{a.stage}</div>
              </div>
              {/* G5: Human-readable mission context instead of raw JSON */}
              {a.payload && (() => {
                const p = a.payload as Record<string, unknown>;
                const tasks = Array.isArray(p?.tasks) ? p.tasks as Array<Record<string, unknown>> : [];
                return (
                  <div style={{ marginTop: "var(--space-4)" }}>
                    {p?.title && <div style={{ marginBottom: "var(--space-2)" }}>
                      <span style={{ color: "#8a8a8a", fontSize: "13px" }}>What AEE wants to do:</span>
                      <div style={{ color: "#ffffff", fontSize: "15px", marginTop: "4px" }}>{String(p.title)}</div>
                    </div>}
                    {p?.rationale && <div style={{ marginBottom: "var(--space-2)" }}>
                      <span style={{ color: "#8a8a8a", fontSize: "13px" }}>Why:</span>
                      <div style={{ color: "#ffffff", fontSize: "14px", marginTop: "4px" }}>{String(p.rationale)}</div>
                    </div>}
                    {tasks.length > 0 && <div style={{ marginBottom: "var(--space-2)" }}>
                      <span style={{ color: "#8a8a8a", fontSize: "13px" }}>Tasks ({tasks.length}):</span>
                      <ul style={{ color: "#ffffff", fontSize: "13px", paddingLeft: "20px", marginTop: "4px" }}>
                        {tasks.slice(0, 5).map((t, i) => (
                          <li key={i}>{t?.title ? String(t.title) : `Task ${i+1}`}{t?.channel ? ` · ${t.channel}` : ""}</li>
                        ))}
                      </ul>
                    </div>}
                    <div style={{ display: "flex", gap: "var(--space-6)", fontSize: "13px", color: "#8a8a8a" }}>
                      {p?.estimated_cost && <span>Est. cost: Rp{String(p.estimated_cost)}</span>}
                      {p?.risk_level && <span>Risk: {String(p.risk_level)}</span>}
                      <span>Reversibility: {p?.reversible === false ? "No" : "Yes"}</span>
                    </div>
                  </div>
                );
              })()}
              <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
                <button className="btn btn--primary btn--sm" onClick={() => onApprove(a.id)}>Approve</button>
                <button className="btn btn--danger btn--sm" onClick={() => onReject(a.id)}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {approvals.length === 0 && !detail.decision && (
        <div className="empty-state"><p className="empty-state-desc">Belum ada decision atau approval pending.</p></div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Create View
// ═════════════════════════════════════════════════════════════════
function CreateView({ userId, onCreated, onCancel }: {
  userId: string;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<"discovery" | "given">("discovery");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    intent: "increase_profit",
    industry: "",
    market: "",
    target_customer: "",
    problem: "",
    solution: "",
    business_model: "",
    price: "",
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.title.trim()) { setFormError("Title harus diisi"); return; }
    setSubmitting(true);
    setFormError(null);
    try {
      const body = tab === "discovery"
        ? { title: form.title, business_mode: "DISCOVERY", goal_type: form.intent }
        : {
            title: form.title,
            business_mode: "GIVEN",
            venture_name: form.title,
            industry: form.industry,
            market: form.market,
            target_customer: form.target_customer,
            problem: form.problem,
            solution: form.solution,
            business_model: form.business_model,
            price: form.price ? parseFloat(form.price) : undefined,
          };
      const result = await createObjective(body, userId);
      if (result.objective?.id) onCreated(result.objective.id);
      else if (result.id) onCreated(result.id);
      else { setFormError("Tidak ada ID objective dalam response"); }
    } catch (e) {
      setFormError(parseApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <button className="btn btn--sm" onClick={onCancel} style={{ marginBottom: "var(--space-5)" }}>
        ← Cancel
      </button>

      <h1 className="page-title">New Objective</h1>
      <p className="page-subtitle">Pilih mode: discovery (AI eksplorasi) atau given (input bisnis已知)</p>

      {/* G4: Intent selection — customer chooses goal first */}
      <div style={{ marginBottom: "var(--space-5)" }}>
        <label className="form-label">What would you like to do?</label>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          {["increase_profit","reduce_cost","find_opportunities","launch_new","improve_growth"].map(g => (
            <button key={g} className="tab" role="tab"
              aria-selected={form.intent === g} data-active={form.intent === g}
              onClick={() => set("intent", g)}
              style={{ textTransform: "capitalize" }}>{g.replace("_"," ")}</button>
          ))}
        </div>
      </div>
      <div className="tab-bar" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === "discovery"} data-active={tab === "discovery"}
          onClick={() => setTab("discovery")}>Discovery</button>
        <button className="tab" role="tab" aria-selected={tab === "given"} data-active={tab === "given"}
          onClick={() => setTab("given")}>I know the business</button>
      </div>

      <div role="tabpanel">
        <div className="form-group">
          <label className="form-label" htmlFor="title">Objective Title</label>
          <input id="title" className="form-input" type="text" value={form.title}
            onChange={e => set("title", e.target.value)} placeholder="Contoh: Kopi Kenangan franchise"
            aria-required="true" disabled={submitting} />
        </div>

        {tab === "given" && (
          <>
            <div className="form-group">
              <label className="form-label" htmlFor="industry">Industry</label>
              <input id="industry" className="form-input" type="text" value={form.industry}
                onChange={e => set("industry", e.target.value)} placeholder="F&B, Retail, Tech…" disabled={submitting} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="market">Market</label>
              <input id="market" className="form-input" type="text" value={form.market}
                onChange={e => set("market", e.target.value)} placeholder="Indonesia, Southeast Asia…" disabled={submitting} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="target_customer">Target Customer</label>
              <input id="target_customer" className="form-input" type="text" value={form.target_customer}
                onChange={e => set("target_customer", e.target.value)} placeholder="Urban professionals 25-40" disabled={submitting} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="problem">Problem</label>
              <textarea id="problem" className="form-textarea" value={form.problem}
                onChange={e => set("problem", e.target.value)} placeholder="Masalah yang dipecahkan…" disabled={submitting} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="solution">Solution</label>
              <textarea id="solution" className="form-textarea" value={form.solution}
                onChange={e => set("solution", e.target.value)} placeholder="Solusi yang ditawarkan…" disabled={submitting} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="business_model">Business Model</label>
              <input id="business_model" className="form-input" type="text" value={form.business_model}
                onChange={e => set("business_model", e.target.value)} placeholder="Subscription, Transaction, Franchise…" disabled={submitting} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="price">Price (Rp)</label>
              <input id="price" className="form-input" type="number" value={form.price}
                onChange={e => set("price", e.target.value)} placeholder="50000" disabled={submitting} />
            </div>
          </>
        )}
      </div>

      {formError && <div className="error-banner" role="alert">
        <span className="error-banner-text">{formError}</span>
      </div>}

      <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
        <button className="btn btn--primary" onClick={submit} disabled={submitting} data-loading={submitting}
          aria-busy={submitting}>
          {submitting ? "Creating…" : "Create Objective"}
        </button>
        <button className="btn" onClick={onCancel} disabled={submitting}>Cancel</button>
      </div>
    </div>
  );
}

// ═══════════════════════════ brand-error ═══
function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <span className="error-banner-icon" aria-hidden="true">⚠</span>
      <span className="error-banner-text">{message}</span>
      <div className="error-banner-action">
        <button className="btn btn--sm" onClick={onRetry}>Retry</button>
      </div>
    </div>
   );
}

// ═══════════════════════════ Footer ═══
function Footer() {
  return (
    <footer className="app-footer" role="contentinfo">
      <span>Econos — AEE Orchestrator</span>
    </footer>
  );
}
