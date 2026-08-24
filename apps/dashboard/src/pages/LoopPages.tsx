import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  listObjectives, listOpportunities, listApprovals, listEvents, getObjectiveDetail,
  listExperiments, listMissions, listResults, getEconomics, listDecisions,
  selectOpportunity, rejectOpportunity, saveOpportunity, letAurexDecide,
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

const fmtRp = (v?: number | string | null) =>
  (v == null || isNaN(Number(v)) ? "—" : "Rp" + Math.round(Number(v)).toLocaleString("id-ID"));

// ═══ OPPORTUNITIES (dengan aksi §19: Select / Save / Reject / Let AUREX Decide) ═══
export function OpportunitiesPage() {
  const { objectives, loading, error, userId, refresh } = useObjectives();
  const [rows, setRows] = useState<(OppSummary & { objTitle: string; objId: string; objState: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const all: (OppSummary & { objTitle: string; objId: string; objState: string })[] = [];
    for (const o of objectives) {
      const opps = await listOpportunities(o.id, userId);
      for (const p of opps) all.push({ ...p, objTitle: o.title, objId: o.id, objState: o.status });
    }
    all.sort((a, b) => (b.risk_adjusted_score ?? 0) - (a.risk_adjusted_score ?? 0));
    setRows(all);
  }, [objectives, userId]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(okMsg); await refresh(); await load(); }
    catch (e) { setMsg(parseApiError(e)); } finally { setBusy(false); }
  };

  const awaitingIds = Array.from(new Set(
    rows.filter((r) => r.objState === "OPPORTUNITIES_RANKED" && r.status === "RANKED").map((r) => r.objId),
  ));

  return (
    <div>
      <h1 className="page-title">Opportunities</h1>
      <p className="page-subtitle">AUREX mengidentifikasi {rows.length} peluang di seluruh objective.</p>
      {msg && <div className="error-banner" role="status"><span className="error-banner-text">{msg}</span></div>}
      {error && <div className="error-banner"><span className="error-banner-text">{error}</span></div>}
      {loading ? <p style={{ color: "#8a8a8a" }}>Memuat…</p> : rows.length === 0 ? (
        <div className="empty-state"><p className="empty-state-desc">Belum ada peluang. AUREX meneliti setelah objective dimulai.</p></div>
      ) : rows.map((o) => {
        const canChoose = o.objState === "OPPORTUNITIES_RANKED" && o.status === "RANKED";
        return (
          <div key={o.id} className="exec-block" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 400 }}>{o.name}</div>
                <div style={{ color: "#8a8a8a", fontSize: 13, marginTop: 4 }}>{o.business_model} · {o.customer_segment}</div>
                <div style={{ color: "#555", fontSize: 12, marginTop: 4 }}>Objective: {o.objTitle}</div>
                {o.status !== "RANKED" && (
                  <div style={{ color: "#2251ff", fontSize: 12, marginTop: 4 }}>
                    {o.status === "SELECTED" ? "✓ Dipilih — sedang dieksekusi" : o.status === "REJECTED" ? "Ditolak" : o.status === "SAVED" ? "Disimpan" : o.status}
                  </div>
                )}
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
            {canChoose && (
              <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
                <button className="btn btn--primary btn--sm" disabled={busy}
                  onClick={() => act(() => selectOpportunity(o.objId, o.id, undefined, userId), "Peluang dipilih — AUREX melanjutkan validasi.")}>
                  Select
                </button>
                <button className="btn btn--sm" disabled={busy}
                  onClick={() => act(() => saveOpportunity(o.objId, o.id, undefined, userId), "Peluang disimpan untuk nanti.")}>
                  Save
                </button>
                <button className="btn btn--danger btn--sm" disabled={busy}
                  onClick={() => act(() => rejectOpportunity(o.objId, o.id, undefined, userId), "Peluang ditolak.")}>
                  Reject
                </button>
              </div>
            )}
            <div style={{ marginTop: 12 }}><Link to={`/app/objectives/${o.objId}`} className="btn btn--sm">Lihat Analisis</Link></div>
          </div>
        );
      })}
      {awaitingIds.length > 0 && (
        <div className="exec-block" style={{ marginTop: 24 }}>
          <div style={{ fontSize: 16 }}>Atau biarkan AUREX memilih peluang terbaik:</div>
          {awaitingIds.map((oid) => (
            <button key={oid} className="btn btn--primary btn--sm" style={{ marginTop: 12 }} disabled={busy}
              onClick={() => act(() => letAurexDecide(oid, userId), "AUREX diberi wewenang memilih — melanjutkan.")}>
              Let AUREX Decide
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ EXPERIMENTS (dari tabel experiments via endpoint dedicated §20) ═══
export function ExperimentsPage() {
  const { objectives, loading, error, userId } = useObjectives();
  const [rows, setRows] = useState<{ objId: string; objTitle: string; hyp: string; opp: string; budget: string | null; dur: number | null; status: string }[]>([]);
  useEffect(() => {
    (async () => {
      const all: typeof rows = [];
      for (const o of objectives) {
        try {
          const res = await listExperiments(o.id, userId) as { experiments?: Record<string, unknown>[] };
          for (const e of res.experiments ?? []) {
            all.push({
              objId: o.id, objTitle: o.title,
              hyp: String(e.hypothesis ?? "—"), opp: String(e.opportunity_name ?? "—"),
              budget: (e.budget as string) ?? null, dur: (e.duration_days as number) ?? null,
              status: String(e.status ?? "—"),
            });
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
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontSize: 16, fontWeight: 400 }}>{r.opp}</div>
            <span style={{ color: "#8a8a8a", fontSize: 13 }}>{r.status}</span>
          </div>
          <div style={{ color: "#555", fontSize: 12, marginTop: 4 }}>Objective: {r.objTitle}</div>
          <div style={{ marginTop: 12 }}>
            <div style={{ color: "#555", fontSize: 12, letterSpacing: 1 }}>HIPOTESIS</div>
            <p style={{ color: "#fff", fontSize: 14, marginTop: 4 }}>{r.hyp}</p>
          </div>
          <div style={{ display: "flex", gap: 24, marginTop: 12, fontSize: 13, color: "#8a8a8a" }}>
            <span>Budget: {fmtRp(r.budget)}</span>
            <span>Durasi: {r.dur != null ? `${r.dur} hari` : "—"}</span>
          </div>
          <div style={{ marginTop: 12 }}><Link to={`/app/objectives/${r.objId}`} className="btn btn--sm">Buka Objective</Link></div>
        </div>
      ))}
    </div>
  );
}

// ═══ MISSIONS (dari tabel missions + versi terbaru §21) ═══
export function MissionsPage() {
  const { objectives, loading, error, userId } = useObjectives();
  const [rows, setRows] = useState<{ objId: string; objTitle: string; mission: string; status: string; version: number | null; opp: string | null; executions: number }[]>([]);
  useEffect(() => {
    (async () => {
      const all: typeof rows = [];
      for (const o of objectives) {
        try {
          const res = await listMissions(o.id, userId) as { missions?: Record<string, unknown>[] };
          for (const m of res.missions ?? []) {
            const pkg = (m.package ?? {}) as Record<string, unknown>;
            all.push({
              objId: o.id, objTitle: o.title,
              mission: String(pkg.title ?? "Mission"),
              status: String(m.status ?? "—"),
              version: (m.version as number) ?? null,
              opp: (m.opportunity_name as string) ?? null,
              executions: Number(m.execution_count ?? 0),
            });
          }
        } catch { /* skip */ }
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
      ) : rows.map((m, i) => (
        <div key={i} className="exec-block" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontSize: 16, fontWeight: 400 }}>{m.mission}</div>
            <span style={{ color: "#8a8a8a", fontSize: 13 }}>{m.status}{m.version != null ? ` · v${m.version}` : ""}</span>
          </div>
          <div style={{ color: "#555", fontSize: 12, marginTop: 4 }}>
            Objective: {m.objTitle}{m.opp ? ` · ${m.opp}` : ""} · Eksekusi: {m.executions}
          </div>
          <div style={{ marginTop: 12 }}><Link to={`/app/objectives/${m.objId}`} className="btn btn--sm">Buka</Link></div>
        </div>
      ))}
    </div>
  );
}

// ═══ APPROVALS (Approval Center top-level §22) ═══
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

// ═══ RESULTS (evidence-aware §24: SELF_REPORTED ≠ VERIFIED) ═══
export function ResultsPage() {
  const { objectives, loading, error, userId } = useObjectives();
  const [rows, setRows] = useState<{ objId: string; objTitle: string; res: Record<string, unknown> }[]>([]);
  useEffect(() => {
    (async () => {
      const all: typeof rows = [];
      for (const o of objectives) {
        try {
          const r = await listResults(o.id, userId) as { results?: Record<string, unknown>[] };
          for (const it of r.results ?? []) all.push({ objId: o.id, objTitle: o.title, res: it });
        } catch { /* skip */ }
      }
      setRows(all);
    })();
  }, [objectives, userId]);
  const TIER_LABEL: Record<string, string> = {
    SELF_REPORTED: "Dilaporkan sendiri", EVIDENCED: "Ber-evidence", RECONCILED: "Direkonsiliasi", VERIFIED: "Terverifikasi",
  };
  return (
    <div>
      <h1 className="page-title">Results</h1>
      <p className="page-subtitle">Hasil dari setiap eksekusi — dengan tingkat kepercayaan evidence.</p>
      {error && <div className="error-banner"><span className="error-banner-text">{error}</span></div>}
      {loading ? <p style={{ color: "#8a8a8a" }}>Memuat…</p> : rows.length === 0 ? (
        <div className="empty-state"><p className="empty-state-desc">Belum ada hasil. Hasil muncul setelah mission selesai dieksekusi.</p></div>
      ) : rows.map((r, i) => {
        const p = (r.res.payload ?? {}) as Record<string, unknown>;
        const tier = String(r.res.verification_tier ?? "SELF_REPORTED");
        return (
          <div key={i} className="exec-block" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontSize: 16, fontWeight: 400 }}>{String(r.res.opportunity_name ?? "Eksekusi")}</div>
              <span style={{ color: tier === "VERIFIED" || tier === "RECONCILED" ? "#00a9f4" : "#8a8a8a", fontSize: 13 }}>
                {TIER_LABEL[tier] ?? tier}
              </span>
            </div>
            <div style={{ color: "#555", fontSize: 12, marginTop: 4 }}>Objective: {r.objTitle}</div>
            <div className="exec-grid" style={{ marginTop: 16, marginBottom: 0 }}>
              <div className="exec-card"><div className="exec-card-label">Revenue (dilaporkan)</div><div className="exec-card-value">{fmtRp(p.revenue as number ?? null)}</div></div>
              <div className="exec-card"><div className="exec-card-label">Cost (dilaporkan)</div><div className="exec-card-value">{fmtRp(p.cost as number ?? null)}</div></div>
              <div className="exec-card"><div className="exec-card-label">Status Eksekusi</div><div className="exec-card-value">{String(r.res.execution_status ?? "—")}</div></div>
            </div>
            <div style={{ marginTop: 12 }}><Link to={`/app/objectives/${r.objId}`} className="btn btn--sm">Detail</Link></div>
          </div>
        );
      })}
    </div>
  );
}

// ═══ ECONOMICS (baseline/current/target §27) ═══
export function EconomicsPage() {
  const { objectives, loading, error, userId } = useObjectives();
  const [rows, setRows] = useState<{ objId: string; objTitle: string; eco: Record<string, any> }[]>([]);
  useEffect(() => {
    (async () => {
      const all: typeof rows = [];
      for (const o of objectives) {
        try {
          const eco = await getEconomics(o.id, userId) as Record<string, any>;
          if (eco && (eco.current || eco.baseline || eco.target)) all.push({ objId: o.id, objTitle: o.title, eco });
        } catch { /* skip */ }
      }
      setRows(all);
    })();
  }, [objectives, userId]);
  return (
    <div>
      <h1 className="page-title">Economics</h1>
      <p className="page-subtitle">Baseline → Current → Target per objective.</p>
      {error && <div className="error-banner"><span className="error-banner-text">{error}</span></div>}
      {loading ? <p style={{ color: "#8a8a8a" }}>Memuat…</p> : rows.length === 0 ? (
        <div className="empty-state"><p className="empty-state-desc">Belum ada data ekonomi.</p></div>
      ) : (
        <div className="table-wrap"><div className="table-scroll"><table className="data-table">
          <thead><tr><th>Objective</th><th data-align="numeric">Operating Profit</th><th data-align="numeric">ROI</th><th data-align="numeric">Capital Deployed</th><th data-align="numeric">Target Profit</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.objId}>
                <td>{r.objTitle}</td>
                <td data-align="numeric">{fmtRp(r.eco?.current?.operating_profit)}</td>
                <td data-align="numeric">{r.eco?.current?.roi != null ? `${Number(r.eco.current.roi).toFixed(1)}%` : "—"}</td>
                <td data-align="numeric">{fmtRp(r.eco?.current?.capital_deployed)}</td>
                <td data-align="numeric">{fmtRp(r.eco?.target?.target_profit)}</td>
                <td data-align="numeric"><Link to={`/app/objectives/${r.objId}`} className="btn btn--sm">Buka</Link></td>
              </tr>
            ))}
          </tbody>
        </table></div></div>
      )}
    </div>
  );
}

// ═══ ACTIVITY (human-readable timeline §28 — tanpa raw FSM) ═══
const ACTIVITY_ENTRIES: [string, string][] = [
  ["OBJECTIVE", "Objective dibuat"], ["RESEARCH", "Riset pasar selesai"],
  ["BUSINESS", "Peluang bisnis dipilih"], ["OPPORTUNITY", "Peluang diberi peringkat"],
  ["EXPERIMENT", "Eksperimen dirancang"], ["MISSION", "Misi dibuat"],
  ["APPROVED", "Disetujui"], ["REJECTED", "Ditolak"],
  ["EXECUTION_STARTED", "Eksekusi dimulai"], ["EXECUTION_COMPLETED", "Eksekusi selesai"],
  ["VERIFIED", "Hasil ekonomi terverifikasi"], ["DECISION", "AUREX memberi keputusan"],
  ["ABORTED", "Objective dihentikan"], ["ERROR", "Kendala teknis"],
  ["AWAITING_CHOICE", "Menunggu keputusan Anda"],
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
