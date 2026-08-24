import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  listObjectives, listOpportunities, listApprovals, listEvents, getObjectiveDetail,
  approveDecision, rejectDecision, parseApiError,
  type ObjectiveListItem, type OppSummary, type Approval, type AeeEvent,
} from "../api";
import { useSession, resolveUserId } from "../lib/session";

// ═══ Shared hook: aggregate across objectives ═══
function useObjectives() {
  const session = useSession();
  const userId = resolveUserId(session);
  const [objectives, setObjectives] = useState<ObjectiveListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setObjectives(await listObjectives(userId)); setError(null); }
    catch (e) { setError(parseApiError(e)); } finally { setLoading(false); }
  }, [userId]);
  useEffect(() => { refresh(); }, [refresh]);
  return { objectives, loading, error, userId, refresh };
}

const fmtRp = (v?: number | null) => (v == null || isNaN(v) ? "—" : "Rp" + Math.round(v).toLocaleString("id-ID"));

// ═══ OPPORTUNITIES ═══
export function OpportunitiesPage() {
  const { objectives, loading, error, userId } = useObjectives();
  const [rows, setRows] = useState<(OppSummary & { objTitle: string; objId: string })[]>([]);
  useEffect(() => {
    (async () => {
      const all: (OppSummary & { objTitle: string; objId: string })[] = [];
      for (const o of objectives) {
        const opps = await listOpportunities(o.id, userId);
        for (const p of opps) all.push({ ...p, objTitle: o.title, objId: o.id });
      }
      all.sort((a, b) => (b.risk_adjusted_score ?? 0) - (a.risk_adjusted_score ?? 0));
      setRows(all);
    })();
  }, [objectives, userId]);
  return (
    <div>
      <h1 className="page-title">Opportunities</h1>
      <p className="page-subtitle">AUREX mengidentifikasi {rows.length} peluang di seluruh objective.</p>
      {error && <div className="error-banner"><span className="error-banner-text">{error}</span></div>}
      {loading ? <p style={{ color: "#8a8a8a" }}>Memuat…</p> : rows.length === 0 ? (
        <div className="empty-state"><p className="empty-state-desc">Belum ada peluang. AUREX meneliti setelah objective dimulai.</p></div>
      ) : rows.map((o) => (
        <div key={o.id} className="exec-block" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 400 }}>{o.name}</div>
              <div style={{ color: "#8a8a8a", fontSize: 13, marginTop: 4 }}>{o.business_model} · {o.customer_segment}</div>
              <div style={{ color: "#555", fontSize: 12, marginTop: 4 }}>Objective: {o.objTitle}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#2251ff", fontSize: 22, fontWeight: 300 }}>{o.risk_adjusted_score ?? "—"}</div>
              <div style={{ color: "#8a8a8a", fontSize: 12 }}>opportunity score</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 24, marginTop: 12, fontSize: 13, color: "#8a8a8a" }}>
            {o.capital_required && <span>Modal: {o.capital_required}</span>}
            {o.expected_revenue && <span>Potensi: {o.expected_revenue}</span>}
            {o.risk_score != null && <span>Risiko: {o.risk_score}</span>}
          </div>
          <div style={{ marginTop: 12 }}><Link to={`/app/objectives/${o.objId}`} className="btn btn--sm">Lihat Analisis</Link></div>
        </div>
      ))}
    </div>
  );
}

// ═══ EXPERIMENTS ═══
export function ExperimentsPage() {
  const { objectives, loading, error, userId } = useObjectives();
  const [rows, setRows] = useState<{ objId: string; objTitle: string; hypothesis: string; opportunity: string }[]>([]);
  useEffect(() => {
    (async () => {
      const all: typeof rows = [];
      for (const o of objectives) {
        try {
          const det = await getObjectiveDetail(o.id, userId);
          const opps = await listOpportunities(o.id, userId);
          const sel = opps.find((p) => p.status === "SELECTED") ?? opps[0];
          const hyp = det?.strategy as unknown as { hypothesis?: string } | null;
          if (sel || hyp?.hypothesis) {
            all.push({ objId: o.id, objTitle: o.title, hypothesis: hyp?.hypothesis ?? sel?.problem ?? "—", opportunity: sel?.name ?? "—" });
          }
        } catch { /* skip */ }
      }
      setRows(all);
    })();
  }, [objectives, userId]);
  return (
    <div>
      <h1 className="page-title">Experiments</h1>
      <p className="page-subtitle">Validasi hipotesis sebelum modal besar dikeluarkan.</p>
      {error && <div className="error-banner"><span className="error-banner-text">{error}</span></div>}
      {loading ? <p style={{ color: "#8a8a8a" }}>Memuat…</p> : rows.length === 0 ? (
        <div className="empty-state"><p className="empty-state-desc">Belum ada eksperimen berjalan.</p></div>
      ) : rows.map((r, i) => (
        <div key={i} className="exec-block" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 400 }}>{r.opportunity}</div>
          <div style={{ color: "#8a8a8a", fontSize: 13, marginTop: 4 }}>Objective: {r.objTitle}</div>
          <div style={{ marginTop: 12 }}>
            <div style={{ color: "#555", fontSize: 12, letterSpacing: 1 }}>HIPOTESIS</div>
            <p style={{ color: "#fff", fontSize: 14, marginTop: 4 }}>{r.hypothesis}</p>
          </div>
          <div style={{ marginTop: 12 }}><Link to={`/app/objectives/${r.objId}`} className="btn btn--sm">Buka Objective</Link></div>
        </div>
      ))}
    </div>
  );
}

// ═══ MISSIONS (dari approval payload yang membawa mission) ═══
export function MissionsPage() {
  const { objectives, loading, error, userId } = useObjectives();
  const [rows, setRows] = useState<(Approval & { objTitle: string; objId: string })[]>([]);
  useEffect(() => {
    (async () => {
      const all: (Approval & { objTitle: string; objId: string })[] = [];
      for (const o of objectives) {
        const appr = await listApprovals(o.id, userId);
        for (const a of appr) all.push({ ...a, objTitle: o.title, objId: o.id });
      }
      setRows(all);
    })();
  }, [objectives, userId]);
  return (
    <div>
      <h1 className="page-title">Missions</h1>
      <p className="page-subtitle">Rencana eksekusi yang diusulkan AUREX.</p>
      {error && <div className="error-banner"><span className="error-banner-text">{error}</span></div>}
      {loading ? <p style={{ color: "#8a8a8a" }}>Memuat…</p> : rows.length === 0 ? (
        <div className="empty-state"><p className="empty-state-desc">Belum ada mission. Mission muncul setelah eksperimen dirancang.</p></div>
      ) : rows.map((a) => {
        const p = (a.payload || {}) as Record<string, unknown>;
        return (
          <div key={a.id} className="exec-block" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontSize: 16, fontWeight: 400 }}>{p?.title ? String(p.title) : "Mission"}</div>
              <span style={{ color: a.status === "PENDING" ? "#2251ff" : "#8a8a8a", fontSize: 13 }}>
                {a.status === "PENDING" ? "Menunggu approval" : a.status === "APPROVED" ? "Disetujui" : a.status}
              </span>
            </div>
            <div style={{ color: "#555", fontSize: 12, marginTop: 4 }}>Objective: {a.objTitle}</div>
            <div style={{ display: "flex", gap: 20, marginTop: 12, fontSize: 13, color: "#8a8a8a" }}>
              {typeof p?.estimated_cost === "string" && p.estimated_cost !== "" && <span>Biaya: Rp{p.estimated_cost}</span>}
              {typeof p?.risk_level === "string" && p.risk_level !== "" && <span>Risiko: {p.risk_level}</span>}
              <span>Reversibel: {p?.reversible === false ? "Tidak" : "Ya"}</span>
            </div>
            <div style={{ marginTop: 12 }}><Link to={`/app/objectives/${a.objId}`} className="btn btn--sm">Buka</Link></div>
          </div>
        );
      })}
    </div>
  );
}

// ═══ APPROVALS (Approval Center top-level) ═══
export function ApprovalsPage() {
  const { objectives, loading, error, userId, refresh } = useObjectives();
  const [rows, setRows] = useState<(Approval & { objTitle: string; objId: string })[]>([]);
  const load = useCallback(async () => {
    const all: (Approval & { objTitle: string; objId: string })[] = [];
    for (const o of objectives) {
      const appr = await listApprovals(o.id, userId);
      for (const a of appr) if (a.status === "PENDING") all.push({ ...a, objTitle: o.title, objId: o.id });
    }
    setRows(all);
  }, [objectives, userId]);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      <h1 className="page-title">Approval Center</h1>
      <p className="page-subtitle">{rows.length} mission menunggu keputusan Anda.</p>
      {error && <div className="error-banner"><span className="error-banner-text">{error}</span></div>}
      {loading ? <p style={{ color: "#8a8a8a" }}>Memuat…</p> : rows.length === 0 ? (
        <div className="empty-state"><p className="empty-state-title">Tidak ada yang menunggu approval</p>
          <p className="empty-state-desc">AUREX akan meminta persetujuan Anda sebelum mengeksekusi tindakan penting.</p></div>
      ) : rows.map((a) => {
        const p = (a.payload || {}) as Record<string, unknown>;
        const tasks = Array.isArray(p?.tasks) ? (p.tasks as Array<Record<string, unknown>>) : [];
        return (
          <div key={a.id} className="exec-block" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 17, fontWeight: 400 }}>{typeof p?.title === "string" ? p.title : "Mission"}</div>
            <div style={{ color: "#555", fontSize: 12, marginTop: 4 }}>Objective: {a.objTitle}</div>
            {typeof p?.rationale === "string" && p.rationale !== "" && <p style={{ color: "#8a8a8a", fontSize: 14, marginTop: 12 }}>{p.rationale}</p>}
            {tasks.length > 0 && (
              <ul style={{ color: "#fff", fontSize: 13, paddingLeft: 20, marginTop: 12 }}>
                {tasks.slice(0, 6).map((t, i) => <li key={i}>{t?.title ? String(t.title) : `Task ${i + 1}`}</li>)}
              </ul>
            )}
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button className="btn btn--primary btn--sm" onClick={async () => { await approveDecision(a.id, userId); await refresh(); await load(); }}>Approve & Execute</button>
              <button className="btn btn--danger btn--sm" onClick={async () => { await rejectDecision(a.id, userId); await refresh(); await load(); }}>Reject</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══ RESULTS ═══
export function ResultsPage() {
  const { objectives, loading, error, userId } = useObjectives();
  const [rows, setRows] = useState<{ objId: string; objTitle: string; revenue: number | null; profit: number | null; customers: number | null }[]>([]);
  useEffect(() => {
    (async () => {
      const all: typeof rows = [];
      for (const o of objectives) {
        try {
          const det = await getObjectiveDetail(o.id, userId);
          if (det?.result) {
            all.push({
              objId: o.id, objTitle: o.title,
              revenue: det.result.actual_revenue ?? det.result.projected_revenue ?? null,
              profit: det.result.actual_profit ?? det.result.projected_profit ?? null,
              customers: det.result.actual_customers ?? det.result.projected_customers ?? null,
            });
          }
        } catch { /* skip */ }
      }
      setRows(all);
    })();
  }, [objectives, userId]);
  return (
    <div>
      <h1 className="page-title">Results</h1>
      <p className="page-subtitle">Hasil terverifikasi dari setiap eksperimen & mission.</p>
      {error && <div className="error-banner"><span className="error-banner-text">{error}</span></div>}
      {loading ? <p style={{ color: "#8a8a8a" }}>Memuat…</p> : rows.length === 0 ? (
        <div className="empty-state"><p className="empty-state-desc">Belum ada hasil. Hasil muncul setelah mission selesai dieksekusi.</p></div>
      ) : rows.map((r, i) => (
        <div key={i} className="exec-block" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 400 }}>{r.objTitle}</div>
          <div className="exec-grid" style={{ marginTop: 16, marginBottom: 0 }}>
            <div className="exec-card"><div className="exec-card-label">Revenue</div><div className="exec-card-value">{fmtRp(r.revenue)}</div></div>
            <div className="exec-card"><div className="exec-card-label">Net Result</div>
              <div className="exec-card-value" style={{ color: r.profit != null && r.profit > 0 ? "#00a9f4" : undefined }}>{fmtRp(r.profit)}</div></div>
            <div className="exec-card"><div className="exec-card-label">Customers</div><div className="exec-card-value">{r.customers ?? "—"}</div></div>
          </div>
          <div style={{ marginTop: 12 }}><Link to={`/app/objectives/${r.objId}`} className="btn btn--sm">Detail</Link></div>
        </div>
      ))}
    </div>
  );
}

// ═══ ECONOMICS ═══
export function EconomicsPage() {
  const { objectives, loading, error, userId } = useObjectives();
  const [rows, setRows] = useState<{ objId: string; objTitle: string; opProfit: number | null; roi: number | null; revTarget: number | null }[]>([]);
  useEffect(() => {
    (async () => {
      const all: typeof rows = [];
      for (const o of objectives) {
        try {
          const det = await getObjectiveDetail(o.id, userId);
          all.push({
            objId: o.id, objTitle: o.title,
            opProfit: det?.economics?.operating_profit ?? null,
            roi: det?.economics?.roi ?? null,
            revTarget: det?.economics?.revenue_target ?? null,
          });
        } catch { /* skip */ }
      }
      setRows(all);
    })();
  }, [objectives, userId]);
  const totalProfit = rows.reduce((s, r) => s + (r.opProfit ?? 0), 0);
  return (
    <div>
      <h1 className="page-title">Economics</h1>
      <p className="page-subtitle">Financial command center — performa ekonomi lintas objective.</p>
      {error && <div className="error-banner"><span className="error-banner-text">{error}</span></div>}
      <div className="exec-section">
        <div className="exec-section-title">TOTAL OPERATING PROFIT</div>
        <div className="exec-card" style={{ maxWidth: 320 }}><div className="exec-card-value">{fmtRp(rows.length ? totalProfit : null)}</div></div>
      </div>
      {loading ? <p style={{ color: "#8a8a8a" }}>Memuat…</p> : rows.length === 0 ? (
        <div className="empty-state"><p className="empty-state-desc">Belum ada data ekonomi.</p></div>
      ) : (
        <div className="table-wrap"><div className="table-scroll"><table className="data-table">
          <thead><tr><th>Objective</th><th data-align="numeric">Revenue Target</th><th data-align="numeric">Operating Profit</th><th data-align="numeric">ROI</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.objId}>
                <td>{r.objTitle}</td>
                <td data-align="numeric">{fmtRp(r.revTarget)}</td>
                <td data-align="numeric">{fmtRp(r.opProfit)}</td>
                <td data-align="numeric">{r.roi != null ? `${r.roi.toFixed(1)}%` : "—"}</td>
                <td data-align="numeric"><Link to={`/app/objectives/${r.objId}`} className="btn btn--sm">Buka</Link></td>
              </tr>
            ))}
          </tbody>
        </table></div></div>
      )}
    </div>
  );
}

// ═══ ACTIVITY (human-readable timeline, aggregated) ═══
const ACTIVITY_ENTRIES: [string, string][] = [
  ["OBJECTIVE", "Objective dibuat"], ["RESEARCH", "Riset pasar selesai"],
  ["BUSINESS", "Peluang bisnis dipilih"], ["OPPORTUNITY", "Peluang diberi peringkat"],
  ["EXPERIMENT", "Eksperimen dirancang"], ["MISSION", "Misi dibuat"],
  ["APPROVED", "Disetujui"], ["REJECTED", "Ditolak"],
  ["EXECUTION_STARTED", "Eksekusi dimulai"], ["EXECUTION_COMPLETED", "Eksekusi selesai"],
  ["VERIFIED", "Hasil ekonomi terverifikasi"], ["DECISION", "AUREX memberi keputusan"],
  ["ABORTED", "Objective dihentikan"], ["ERROR", "Kendala teknis"],
];
function humanActivity(e: AeeEvent): string {
  const t = e.event_type || "";
  for (const [token, label] of ACTIVITY_ENTRIES) if (t.includes(token)) return label;
  return e.message ?? "Aktivitas tercatat";
}
export function ActivityPage() {
  const { objectives, loading, error, userId } = useObjectives();
  const [rows, setRows] = useState<(AeeEvent & { objTitle: string })[]>([]);
  useEffect(() => {
    (async () => {
      const all: (AeeEvent & { objTitle: string })[] = [];
      for (const o of objectives) {
        const evts = await listEvents(o.id, userId);
        for (const e of evts) all.push({ ...e, objTitle: o.title });
      }
      all.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      setRows(all.slice(0, 50));
    })();
  }, [objectives, userId]);
  return (
    <div>
      <h1 className="page-title">Activity</h1>
      <p className="page-subtitle">Linimasa aktivitas AUREX dalam bahasa yang Anda pahami.</p>
      {error && <div className="error-banner"><span className="error-banner-text">{error}</span></div>}
      {loading ? <p style={{ color: "#8a8a8a" }}>Memuat…</p> : rows.length === 0 ? (
        <div className="empty-state"><p className="empty-state-desc">Belum ada aktivitas.</p></div>
      ) : (
        <div className="exec-block">
          {rows.map((e, i) => (
            <div key={e.id ?? i} className="attn-row">
              <div>
                <div style={{ color: "#fff" }}>{humanActivity(e)}</div>
                <div style={{ color: "#555", fontSize: 12 }}>{e.objTitle}</div>
              </div>
              <span style={{ color: "#555", fontSize: 13 }}>
                {e.created_at ? new Date(e.created_at).toLocaleString("id-ID", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
