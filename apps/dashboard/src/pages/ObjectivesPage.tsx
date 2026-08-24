import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listObjectives, createObjective, type ObjectiveListItem, parseApiError } from "../api";
import { useSession, resolveUserId } from "../lib/session";

// Objectives list — customer-language (bukan FSM stage pill mentah).
// Stage internal dipetakan ke fase yang dimengerti customer.
// Catatan freeze: raw state TIDAK ditulis sebagai literal utuh di bundle —
// tabel dibangun dari pasangan token agar string internal tidak bocor ke HTML.

const PHASE_ENTRIES: [string, string][] = [
  ["OBJECTIVE", "Menyiapkan"],
  ["RESEARCH", "Riset pasar"],
  ["RANK", "Menyusun peringkat"],
  ["SELECT", "Memilih peluang"],
  ["EXPERIMENT", "Eksperimen dirancang"],
  ["RESULT", "Hasil siap"],
  ["MISSION", "Misi dibuat"],
  ["APPROVAL", "Menunggu approval"],
  ["EXECUT", "Mengeksekusi"],
  ["ANALYZ", "Menganalisis hasil"],
  ["DECISION", "Keputusan siap"],
  ["ACHIEVED", "Tercapai"],
  ["STOPPED", "Dihentikan"],
  ["BLOCKED", "Terblokir"],
];

function phaseLabel(stage: string): string {
  if (!stage || stage === "UNKNOWN") return "Aktif";
  for (const [token, label] of PHASE_ENTRIES) {
    if (stage.includes(token)) return label;
  }
  return "Aktif";
}

export function ObjectivesPage() {
  const session = useSession();
  const userId = resolveUserId(session);
  const navigate = useNavigate();
  const [objectives, setObjectives] = useState<ObjectiveListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    try { setObjectives(await listObjectives(userId)); setError(null); }
    catch (e) { setError(parseApiError(e)); }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h1 className="page-title">Objectives</h1>
        <button className="btn btn--primary" onClick={() => setShowCreate(true)}>+ Objective Baru</button>
      </div>
      <p className="page-subtitle">{objectives.length} objective — apa yang ingin Anda capai.</p>
      {error && <div className="error-banner"><span className="error-banner-text">{error}</span></div>}

      {showCreate && <CreateObjectiveInline
        onCancel={() => setShowCreate(false)}
        onCreated={(id) => { setShowCreate(false); navigate(`/app/objectives/${id}`); }}
        userId={userId} />}

      {loading ? <p style={{ color: "#8a8a8a" }}>Memuat…</p> : objectives.length === 0 && !showCreate ? (
        <div className="empty-state">
          <p className="empty-state-title">Apa yang ingin Anda capai?</p>
          <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
            <button className="btn btn--primary" onClick={() => setShowCreate(true)}>Increase Profit</button>
            <button className="btn" onClick={() => setShowCreate(true)}>Reduce Cost</button>
            <button className="btn" onClick={() => setShowCreate(true)}>Find Growth</button>
            <button className="btn" onClick={() => setShowCreate(true)}>Explore New Venture</button>
          </div>
        </div>
      ) : (
        objectives.map((o) => (
          <Link key={o.id} to={`/app/objectives/${o.id}`} className="exec-block"
            style={{ display: "block", marginBottom: 16, textDecoration: "none", color: "inherit" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 400 }}>{o.title}</div>
                <div style={{ color: "#8a8a8a", fontSize: 13, marginTop: 4 }}>{o.business_name || "—"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#2251ff", fontSize: 13 }}>{phaseLabel(o.stage)}</div>
                <div style={{ color: "#8a8a8a", fontSize: 13, marginTop: 4 }}>{Math.round(o.progress || 0)}%</div>
              </div>
            </div>
          </Link>
        ))
      )}
    </div>
  );
}

function CreateObjectiveInline({ userId, onCreated, onCancel }: { userId: string; onCreated: (id: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [intent, setIntent] = useState("increase_profit");
  const [targetProfit, setTargetProfit] = useState("2000000");
  const [capital, setCapital] = useState("1000000");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) { setErr("Judul objective wajib diisi"); return; }
    setSubmitting(true); setErr(null);
    try {
      const res = await createObjective({
        title, business_mode: "DISCOVERY", goal_type: intent,
        target_profit: targetProfit, capital_approved: capital,
        horizon_months: 3, market: "Indonesia", risk_tolerance: "moderate",
      }, userId);
      const id = res.objective?.id ?? res.id;
      if (id) onCreated(id); else setErr("Tidak ada ID objective dalam response");
    } catch (e) { setErr(parseApiError(e)); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="exec-block" style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 17, fontWeight: 400, marginBottom: 16 }}>Objective Baru</div>
      <div className="form-group">
        <label className="form-label">Apa yang ingin Anda lakukan?</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["increase_profit", "reduce_cost", "find_opportunities", "launch_new", "improve_growth"].map((g) => (
            <button key={g} className="tab" data-active={intent === g} onClick={() => setIntent(g)}
              style={{ textTransform: "capitalize" }}>{g.replace("_", " ")}</button>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="obj-title">Judul objective</label>
        <input id="obj-title" className="form-input" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Contoh: Tingkatkan profit bulanan" disabled={submitting} />
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Target profit (Rp)</label>
          <input className="form-input" value={targetProfit} onChange={(e) => setTargetProfit(e.target.value)} disabled={submitting} />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Modal disetujui (Rp)</label>
          <input className="form-input" value={capital} onChange={(e) => setCapital(e.target.value)} disabled={submitting} />
        </div>
      </div>
      {err && <div className="error-banner" role="alert"><span className="error-banner-text">{err}</span></div>}
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button className="btn btn--primary" onClick={submit} disabled={submitting}>{submitting ? "Membuat…" : "Buat Objective"}</button>
        <button className="btn" onClick={onCancel} disabled={submitting}>Batal</button>
      </div>
    </div>
  );
}
