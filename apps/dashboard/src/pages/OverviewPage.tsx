import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { listObjectives, listApprovals, type ObjectiveListItem } from "../api";
import { useSession, resolveUserId } from "../lib/session";

export function OverviewPage() {
  const session = useSession();
  const userId = resolveUserId(session);
  const [objectives, setObjectives] = useState<ObjectiveListItem[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const objs = await listObjectives(userId);
      setObjectives(objs);
      // Aggregate pending approvals across active objectives
      let pending = 0;
      for (const o of objs.filter((x) => x.status === "ACTIVE")) {
        try {
          const appr = await listApprovals(o.id, userId);
          pending += appr.filter((a) => a.status === "PENDING").length;
        } catch { /* per-objective approvals optional */ }
      }
      setPendingApprovals(pending);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  const active = objectives.filter((o) => o.status === "ACTIVE");
  const primary = active[0] ?? objectives[0] ?? null;

  return (
    <div>
      <h1 className="page-title">Selamat datang{session.orgName ? `, ${session.orgName}` : ""}.</h1>
      <p className="page-subtitle">Economic Control Center — ringkasan performa ekonomi Anda.</p>

      {error && <div className="error-banner" role="alert"><span className="error-banner-text">{error}</span></div>}

      {/* Economic Performance */}
      <div className="exec-section">
        <div className="exec-section-title">ECONOMIC PERFORMANCE</div>
        <div className="exec-grid">
          <div className="exec-card">
            <div className="exec-card-label">Operating Profit</div>
            <div className="exec-card-value">—</div>
            <div className="exec-card-delta">data menunggu analisis pertama</div>
          </div>
          <div className="exec-card">
            <div className="exec-card-label">Revenue</div>
            <div className="exec-card-value">—</div>
          </div>
          <div className="exec-card">
            <div className="exec-card-label">Verified Value Created</div>
            <div className="exec-card-value">—</div>
          </div>
          <div className="exec-card">
            <div className="exec-card-label">Capital Deployed</div>
            <div className="exec-card-value">—</div>
          </div>
        </div>
      </div>

      {/* Active objective */}
      <div className="exec-section">
        <div className="exec-section-title">ACTIVE OBJECTIVE</div>
        <div className="exec-block">
          {loading ? (
            <p style={{ color: "#8a8a8a" }}>Memuat…</p>
          ) : !primary ? (
            <div>
              <p style={{ color: "#8a8a8a", marginBottom: 16 }}>Belum ada objective. Mulai dari tujuan bisnis Anda.</p>
              <Link to="/app/objectives" className="btn btn--primary">Buat Objective</Link>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 18, fontWeight: 400, marginBottom: 12 }}>{primary.title}</div>
              <div className="progress-track" aria-label="Progress">
                <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, primary.progress || 0))}%` }} />
              </div>
              <div style={{ color: "#8a8a8a", fontSize: 13, marginTop: 8 }}>{Math.round(primary.progress || 0)}% menuju target</div>
              <div style={{ marginTop: 16 }}>
                <Link to={`/app/objectives/${primary.id}`} className="btn btn--sm">Buka Objective</Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Requires attention */}
      <div className="exec-section">
        <div className="exec-section-title">REQUIRES YOUR ATTENTION</div>
        <div className="exec-block">
          {pendingApprovals === 0 ? (
            <p style={{ color: "#8a8a8a" }}>Tidak ada yang menunggu persetujuan Anda.</p>
          ) : (
            <div className="attn-row">
              <span style={{ color: "#fff" }}>{pendingApprovals} mission menunggu approval</span>
              <Link to="/app/approvals" className="btn btn--primary btn--sm">Review</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
