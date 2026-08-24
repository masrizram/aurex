import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  getObjectiveDetail, listApprovals, listEvents, listOpportunities, startObjective,
  approveDecision, rejectDecision, parseApiError,
  selectOpportunity, rejectOpportunity, saveOpportunity, letAurexDecide, listDecisions,
  type ObjectiveDetail, type Approval, type AeeEvent, type OppSummary,
} from "../api";
import { useSession, resolveUserId } from "../lib/session";

// P4 — Core Economic Loop dalam satu objective:
// Opportunity → Experiment → Mission → Approval → Execution → Result → Decision.
// FSM internal dipetakan ke bahasa manusia.

function fmtRp(v?: number | null): string {
  if (v == null || isNaN(v)) return "—";
  return "Rp" + Math.round(v).toLocaleString("id-ID");
}

// Map event internal → narasi manusiawi. Dibangun dari token agar
// raw state internal tidak tersimpan sebagai literal utuh di bundle.
const EVENT_ENTRIES: [string, string][] = [
  ["OBJECTIVE", "Objective dibuat"],
  ["RESEARCH", "Riset pasar selesai"],
  ["BUSINESS", "Peluang bisnis dipilih"],
  ["OPPORTUNITY", "Peluang diberi peringkat"],
  ["EXPERIMENT", "Eksperimen dirancang"],
  ["MISSION", "Misi dibuat"],
  ["APPROVED", "Disetujui"],
  ["REJECTED", "Ditolak"],
  ["EXECUTION_STARTED", "Eksekusi dimulai"],
  ["EXECUTION_COMPLETED", "Eksekusi selesai"],
  ["VERIFIED", "Hasil ekonomi terverifikasi"],
  ["DECISION", "AUREX memberi keputusan"],
  ["ABORTED", "Objective dihentikan"],
  ["ERROR", "Kendala teknis"],
];
function humanEvent(e: AeeEvent): string {
  const t = e.event_type || "";
  for (const [token, label] of EVENT_ENTRIES) {
    if (t.includes(token)) return label;
  }
  return e.message ?? "Aktivitas tercatat";
}

export function ObjectiveDetailPage() {
  const { objectiveId = "" } = useParams();
  const session = useSession();
  const userId = resolveUserId(session);
  const [detail, setDetail] = useState<ObjectiveDetail | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [events, setEvents] = useState<AeeEvent[]>([]);
  const [opps, setOpps] = useState<OppSummary[]>([]);
  const [decisions, setDecisions] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [det, appr, evts, oppList, decList] = await Promise.all([
        getObjectiveDetail(objectiveId, userId),
        listApprovals(objectiveId, userId),
        listEvents(objectiveId, userId),
        listOpportunities(objectiveId, userId),
        listDecisions(objectiveId, userId).catch(() => ({ decisions: [] })),
      ]);
      setDetail(det); setApprovals(appr); setEvents(evts); setOpps(oppList);
      setDecisions((decList as { decisions?: Record<string, unknown>[] }).decisions ?? []);
      setError(null);
    } catch (e) { setError(parseApiError(e)); }
  }, [objectiveId, userId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  if (error) return <div className="error-banner"><span className="error-banner-text">{error}</span></div>;
  if (!detail) return <p style={{ color: "#8a8a8a" }}>Memuat objective…</p>;

  const pending = approvals.filter((a) => a.status === "PENDING");
  const result = detail.result;
  const netResult = result && result.actual_revenue != null && result.actual_profit != null
    ? result.actual_profit : null;

  return (
    <div>
      <Link to="/app/objectives" style={{ color: "#8a8a8a", fontSize: 13, textDecoration: "none" }}>← Objectives</Link>
      <h1 className="page-title" style={{ marginTop: 12 }}>{detail.title}</h1>
      <p className="page-subtitle">{detail.business?.name || "—"}</p>

      {/* Requires approval banner */}
      {pending.length > 0 && (
        <div className="exec-block" style={{ borderColor: "#2251ff", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#fff" }}>{pending.length} mission menunggu approval Anda</span>
            <Link to="/app/approvals" className="btn btn--primary btn--sm">Review</Link>
          </div>
        </div>
      )}

      {/* Decision banner */}
      {detail.decision && (
        <div className="exec-block" style={{ marginBottom: 24 }}>
          <div className="exec-section-title">AUREX RECOMMENDS</div>
          <div style={{ fontSize: 22, fontWeight: 300, color: "#2251ff" }}>{detail.decision.recommendation || "—"}</div>
          {detail.decision.confidence != null && (
            <div style={{ color: "#8a8a8a", fontSize: 13, marginTop: 4 }}>Confidence {detail.decision.confidence.toFixed(0)}%</div>
          )}
          {detail.decision.rationale && (
            <p style={{ color: "#fff", fontSize: 14, marginTop: 12, lineHeight: 1.6 }}>{detail.decision.rationale}</p>
          )}
        </div>
      )}

      {/* Economic impact */}
      <div className="exec-section">
        <div className="exec-section-title">ECONOMIC IMPACT</div>
        <div className="exec-grid">
          <div className="exec-card"><div className="exec-card-label">Revenue</div>
            <div className="exec-card-value">{fmtRp(result?.actual_revenue ?? result?.projected_revenue)}</div></div>
          <div className="exec-card"><div className="exec-card-label">Net Economic Result</div>
            <div className="exec-card-value" style={{ color: netResult != null && netResult > 0 ? "#00a9f4" : undefined }}>
              {fmtRp(netResult)}</div></div>
          <div className="exec-card"><div className="exec-card-label">Operating Profit</div>
            <div className="exec-card-value">{fmtRp(detail.economics?.operating_profit)}</div></div>
          <div className="exec-card"><div className="exec-card-label">ROI</div>
            <div className="exec-card-value">{detail.economics?.roi != null ? `${detail.economics.roi.toFixed(1)}%` : "—"}</div></div>
        </div>
      </div>

      {/* Opportunities */}
      <div className="exec-section">
        <div className="exec-section-title">OPPORTUNITIES</div>
        <div className="exec-block">
          {opps.length === 0 ? <p style={{ color: "#8a8a8a" }}>AUREX sedang meneliti peluang…</p> : (
            opps.map((o) => (
              <div key={o.id} className="attn-row" style={{ display: "block", padding: "12px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ color: "#fff" }}>{o.name}</div>
                    <div style={{ color: "#8a8a8a", fontSize: 13 }}>{o.business_model}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "#2251ff" }}>{o.risk_adjusted_score != null ? `${o.risk_adjusted_score}` : "—"}</div>
                    <div style={{ color: "#8a8a8a", fontSize: 12 }}>score</div>
                  </div>
                </div>
                {o.status === "RANKED" || o.status === "DISCOVERED" ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="btn btn--primary btn--sm" onClick={async () => { try { await selectOpportunity(objectiveId, o.id, undefined, userId); refresh(); } catch (e) { setError(parseApiError(e)); } }}>Select</button>
                    <button className="btn btn--sm" onClick={async () => { try { await saveOpportunity(objectiveId, o.id, undefined, userId); refresh(); } catch (e) { setError(parseApiError(e)); } }}>Save</button>
                    <button className="btn btn--danger btn--sm" onClick={async () => { try { await rejectOpportunity(objectiveId, o.id, "tidak sesuai", userId); refresh(); } catch (e) { setError(parseApiError(e)); } }}>Reject</button>
                  </div>
                ) : (
                  <div style={{ marginTop: 8 }}><span style={{ color: "#8a8a8a", fontSize: 12 }}>status: {o.status}</span></div>
                )}
              </div>
            ))
          )}
          {detail.status === "OPPORTUNITIES_RANKED" && (
            <div style={{ marginTop: 16 }}>
              <button className="btn btn--sm" onClick={async () => { try { await letAurexDecide(objectiveId, userId); refresh(); } catch (e) { setError(parseApiError(e)); } }}>
                Let AUREX Decide (pilih otomatis terbaik)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Pending approvals detail */}
      {pending.length > 0 && (
        <div className="exec-section">
          <div className="exec-section-title">PENDING APPROVALS</div>
          {pending.map((a) => (
            <ApprovalCard key={a.id} approval={a}
              onApprove={async () => { await approveDecision(a.id, userId); refresh(); }}
              onReject={async () => { await rejectDecision(a.id, userId); refresh(); }} />
          ))}
        </div>
      )}

      {/* Decisions history (SCALE/ITERATE/PIVOT/KILL) */}
      {decisions.length > 0 && (
        <div className="exec-section">
          <div className="exec-section-title">DECISIONS</div>
          <div className="exec-block">
            {decisions.slice(0, 10).map((d, i) => (
              <div key={i} className="attn-row">
                <div>
                  <span style={{ color: "#fff" }}>{String(d.decision ?? "—")}</span>
                  <span style={{ color: "#8a8a8a", fontSize: 13, marginLeft: 8 }}>oleh {String(d.decided_by ?? "—")}</span>
                  {typeof d.reason === "string" && d.reason && (
                    <div style={{ color: "#8a8a8a", fontSize: 12, marginTop: 2 }}>{d.reason}</div>
                  )}
                </div>
                <div style={{ color: "#8a8a8a", fontSize: 13 }}>
                  {d.confidence != null ? `${Number(d.confidence).toFixed(0)}%` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity — human readable */}
      <div className="exec-section">
        <div className="exec-section-title">ACTIVITY</div>
        <div className="exec-block">
          {events.length === 0 ? <p style={{ color: "#8a8a8a" }}>Belum ada aktivitas.</p> : (
            events.slice(0, 30).map((e, i) => (
              <div key={e.id ?? i} className="attn-row">
                <span style={{ color: "#fff" }}>{humanEvent(e)}</span>
                <span style={{ color: "#555", fontSize: 13 }}>
                  {e.created_at ? new Date(e.created_at).toLocaleString("id-ID", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : ""}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Start execution CTA when applicable */}
      {detail.status === "ACTIVE" && (
        <div style={{ marginTop: 24 }}>
          <button className="btn btn--primary" onClick={async () => { try { await startObjective(detail.id, userId); refresh(); } catch (e) { setError(parseApiError(e)); } }}>
            Mulai / Lanjutkan
          </button>
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ approval, onApprove, onReject }: { approval: Approval; onApprove: () => void; onReject: () => void }) {
  const p = (approval.payload || {}) as Record<string, unknown>;
  const tasks = Array.isArray(p?.tasks) ? (p.tasks as Array<Record<string, unknown>>) : [];
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => void) => { setBusy(true); try { fn(); } finally { setBusy(false); } };
  return (
    <div className="exec-block" style={{ marginBottom: 16 }}>
      {typeof p?.title === "string" && p.title !== "" && <div style={{ fontSize: 16, fontWeight: 400, marginBottom: 8 }}>{p.title}</div>}
      {typeof p?.rationale === "string" && p.rationale !== "" && <p style={{ color: "#8a8a8a", fontSize: 14, marginBottom: 12 }}>{p.rationale}</p>}
      {tasks.length > 0 && (
        <ul style={{ color: "#fff", fontSize: 13, paddingLeft: 20, marginBottom: 12 }}>
          {tasks.slice(0, 6).map((t, i) => <li key={i}>{t?.title ? String(t.title) : `Task ${i + 1}`}{typeof t?.channel === "string" ? ` · ${t.channel}` : ""}</li>)}
        </ul>
      )}
      <div style={{ display: "flex", gap: 20, fontSize: 13, color: "#8a8a8a", marginBottom: 16 }}>
        {typeof p?.estimated_cost === "string" && p.estimated_cost !== "" && <span>Estimasi biaya: Rp{p.estimated_cost}</span>}
        {typeof p?.risk_level === "string" && p.risk_level !== "" && <span>Risiko: {p.risk_level}</span>}
        <span>Reversibel: {p?.reversible === false ? "Tidak" : "Ya"}</span>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => act(onApprove)}>Approve & Execute</button>
        <button className="btn btn--danger btn--sm" disabled={busy} onClick={() => act(onReject)}>Reject</button>
      </div>
    </div>
  );
}
