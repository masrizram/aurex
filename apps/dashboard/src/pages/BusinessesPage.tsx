import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { listObjectives, type ObjectiveListItem } from "../api";
import { useSession, resolveUserId } from "../lib/session";

// P2 — Businesses sebagai PARENT entity. Group objectives by business.
// API saat ini: /objectives membawa business_name. /ventures membawa daftar venture.
// Presentation: Business → child objectives (bukan sebaliknya).

export function BusinessesPage() {
  const session = useSession();
  const userId = resolveUserId(session);
  const [objectives, setObjectives] = useState<ObjectiveListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setObjectives(await listObjectives(userId));
      setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Group objectives by business_name (parent entity)
  const byBusiness = new Map<string, ObjectiveListItem[]>();
  for (const o of objectives) {
    const key = o.business_name || "New Venture Discovery";
    if (!byBusiness.has(key)) byBusiness.set(key, []);
    byBusiness.get(key)!.push(o);
  }

  return (
    <div>
      <h1 className="page-title">Businesses</h1>
      <p className="page-subtitle">{byBusiness.size} bisnis — setiap bisnis punya objective, eksperimen, dan hasilnya sendiri.</p>
      {error && <div className="error-banner"><span className="error-banner-text">{error}</span></div>}
      {loading ? <p style={{ color: "#8a8a8a" }}>Memuat…</p> : byBusiness.size === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">Belum ada bisnis</p>
          <p className="empty-state-desc">Bisnis dibuat saat onboarding atau saat Anda membuat objective baru.</p>
          <Link to="/app/objectives" className="btn btn--primary" style={{ marginTop: 16 }}>Buat Objective</Link>
        </div>
      ) : (
        [...byBusiness.entries()].map(([biz, objs]) => (
          <div key={biz} className="exec-block" style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 400 }}>{biz}</div>
              <span style={{ color: "#8a8a8a", fontSize: 13 }}>{objs.length} objective</span>
            </div>
            {objs.map((o) => (
              <div key={o.id} className="attn-row">
                <span style={{ color: "#fff" }}>{o.title}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span style={{ color: "#8a8a8a", fontSize: 13 }}>{Math.round(o.progress || 0)}%</span>
                  <Link to={`/app/objectives/${o.id}`} className="btn btn--sm">Buka</Link>
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
