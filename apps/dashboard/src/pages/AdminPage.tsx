import { useState, useEffect, useCallback } from "react";
import { adminOverview, adminUsers, adminOrgs } from "../api";

// /admin — internal operator surface. Di SINILAH info model/teknis berada
// (dipisahkan dari /app customer surface sesuai architecture freeze).

export function AdminPage({ onLogout }: { onLogout: () => void }) {
  const [overview, setOverview] = useState<{ users: number; orgs: number; objectives: { count: number; state: string }[] } | null>(null);
  const [users, setUsers] = useState<{ id: string; email: string; role: string; name: string | null; status: string; is_admin: boolean }[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; name: string; slug: string; plan_tier: string; member_count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, u, o] = await Promise.all([adminOverview(), adminUsers(), adminOrgs()]);
      setOverview(ov); setUsers(u.users); setOrgs(o.orgs);
    } catch (e) { console.error("admin error:", e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div style={{ minHeight: "100vh", background: "#000", padding: "48px 24px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 40 }}>
          <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 300 }}>AUREX Admin</h1>
          <div style={{ display: "flex", gap: 12 }}>
            <a href="/app" style={{ color: "#2251ff", fontSize: 13, textDecoration: "none" }}>← Control Center</a>
            <button onClick={onLogout} style={{ background: "none", border: "none", color: "#8a8a8a", fontSize: 13, cursor: "pointer" }}>Keluar</button>
          </div>
        </div>
        {loading ? <p style={{ color: "#8a8a8a" }}>Memuat…</p> : overview ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 40 }}>
              {[{ l: "Users", v: overview.users }, { l: "Organizations", v: overview.orgs }, { l: "Objectives", v: overview.objectives.reduce((s, o) => s + o.count, 0) }].map((c) => (
                <div key={c.l} style={{ background: "#1a1a1a", borderRadius: 16, padding: 24 }}>
                  <div style={{ color: "#8a8a8a", fontSize: 13, marginBottom: 8 }}>{c.l}</div>
                  <div style={{ color: "#fff", fontSize: 32, fontWeight: 300 }}>{c.v}</div>
                </div>
              ))}
            </div>
            <AdminSection title="Objectives by State (engine internal)">
              {overview.objectives.map((o) => (
                <div key={o.state} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1a1a1a" }}>
                  <span style={{ color: "#fff", fontSize: 14 }}>{o.state}</span>
                  <span style={{ color: "#2251ff", fontSize: 14 }}>{o.count}</span>
                </div>
              ))}
            </AdminSection>
            <AdminSection title="Users">
              {users.map((u) => (
                <div key={u.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1a1a1a" }}>
                  <div>
                    <div style={{ color: "#fff", fontSize: 14 }}>{u.email}</div>
                    <div style={{ color: "#8a8a8a", fontSize: 12 }}>{u.name || "—"} · {u.role}{u.is_admin ? " · ADMIN" : ""}</div>
                  </div>
                  <span style={{ color: u.status === "ACTIVE" ? "#00a9f4" : "#ff5252", fontSize: 13 }}>{u.status}</span>
                </div>
              ))}
            </AdminSection>
            <AdminSection title="Organizations">
              {orgs.map((o) => (
                <div key={o.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1a1a1a" }}>
                  <div>
                    <div style={{ color: "#fff", fontSize: 14 }}>{o.name}</div>
                    <div style={{ color: "#8a8a8a", fontSize: 12 }}>{o.slug} · {o.plan_tier}</div>
                  </div>
                  <span style={{ color: "#8a8a8a", fontSize: 13 }}>{o.member_count} members</span>
                </div>
              ))}
            </AdminSection>
          </>
        ) : <p style={{ color: "#ff5252" }}>Gagal memuat data admin</p>}
      </div>
    </div>
  );
}

function AdminSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <h2 style={{ color: "#8a8a8a", fontSize: 13, letterSpacing: 1.5, marginBottom: 16, fontWeight: 400 }}>{title}</h2>
      <div>{children}</div>
    </div>
  );
}
