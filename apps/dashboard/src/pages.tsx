/**
 * Auth + Onboarding + Admin pages for AEE.
 * Uses McKinsey design tokens from index.css.
 */
import { useState, useEffect, useCallback } from "react";
import {
  signup, login, logout, getMe,
  onboardingStatus, onboardingStep1, onboardingStep2, onboardingStep3, onboardingStep4, onboardingStep5,
  adminOverview, adminUsers, adminOrgs,
  parseApiError,
} from "./api";

// ════════════════════════════════════════════════════════════════════════════
// AUTH SCREEN
// ════════════════════════════════════════════════════════════════════════════

export function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        await signup(email, password, name || undefined, orgName || undefined);
      } else {
        await login(email, password);
      }
      onAuthed();
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#000000" }}>
      <div style={{ width: "100%", maxWidth: "440px", padding: "48px" }}>
        <h1 style={{ color: "#ffffff", fontSize: "28px", fontWeight: 300, marginBottom: "8px", letterSpacing: "-0.5px" }}>
          AEE — Economic Control Center
        </h1>
        <p style={{ color: "#8a8a8a", fontSize: "14px", marginBottom: "40px", lineHeight: "24px" }}>
          {mode === "login" ? "Masuk ke akun Anda" : "Buat akun baru untuk memulai"}
        </p>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {mode === "signup" && (
            <>
              <input
                placeholder="Nama (opsional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
              />
              <input
                placeholder="Organisasi (opsional)"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                style={inputStyle}
              />
            </>
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password (min. 8 karakter)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            style={inputStyle}
          />
          {error && <div style={{ color: "#ff5252", fontSize: "13px", lineHeight: "20px" }}>{error}</div>}
          <button
            type="submit"
            disabled={loading}
            style={buttonStyle}
          >
            {loading ? "Memproses..." : mode === "login" ? "Masuk" : "Daftar"}
          </button>
        </form>
        <div style={{ marginTop: "24px", textAlign: "center" }}>
          <button
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}
            style={{ background: "none", border: "none", color: "#2251ff", fontSize: "14px", cursor: "pointer" }}
          >
            {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  background: "#1a1a1a",
  border: "1px solid #2a2a2a",
  borderRadius: "16px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 300,
  outline: "none",
};

const buttonStyle: React.CSSProperties = {
  padding: "14px 24px",
  background: "#2251ff",
  border: "none",
  borderRadius: "16px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 400,
  cursor: "pointer",
  transition: "opacity 120ms",
};

// ════════════════════════════════════════════════════════════════════════════
// ONBOARDING WIZARD (5 steps)
// ════════════════════════════════════════════════════════════════════════════

export function OnboardingWizard({ onComplete, onLogout }: { onComplete: () => void; onLogout: () => void }) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Step 1
  const [bizName, setBizName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [products, setProducts] = useState("");
  const [targetCustomer, setTargetCustomer] = useState("");
  // Step 2
  const [goalType, setGoalType] = useState("find_opportunities");
  // Step 3
  const [revenue, setRevenue] = useState("0");
  const [cost, setCost] = useState("0");
  const [capital, setCapital] = useState("1000000");
  const [horizon, setHorizon] = useState(3);
  // Step 4
  const [autonomy, setAutonomy] = useState(1);
  // Step 5
  const [title, setTitle] = useState("");
  const [targetProfit, setTargetProfit] = useState("2000000");

  useEffect(() => {
    onboardingStatus().then(s => {
      if (s.completed) { onComplete(); return; }
      if (s.step > 0) setStep(s.step + 1);
    }).catch(() => {});
  }, []);

  const next = async () => {
    setError(null);
    setLoading(true);
    try {
      if (step === 1) {
        await onboardingStep1({ business_name: bizName, industry, website: website || undefined, products: products || undefined, target_customer: targetCustomer });
        setStep(2);
      } else if (step === 2) {
        await onboardingStep2(goalType);
        setStep(3);
      } else if (step === 3) {
        await onboardingStep3({ current_revenue: revenue, current_cost: cost, capital, time_horizon_months: horizon });
        setStep(4);
      } else if (step === 4) {
        await onboardingStep4(autonomy);
        setStep(5);
      } else if (step === 5) {
        await onboardingStep5({ title, target_profit: targetProfit });
        onComplete();
      }
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const stepTitles = [
    "Tell us about your business",
    "What do you want to achieve?",
    "Economic context",
    "Autonomy preference",
    "AEE starts analyzing",
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#000000", padding: "48px 24px" }}>
      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "40px" }}>
          <h1 style={{ color: "#ffffff", fontSize: "22px", fontWeight: 300 }}>AEE Onboarding</h1>
          <button onClick={onLogout} style={{ background: "none", border: "none", color: "#8a8a8a", fontSize: "13px", cursor: "pointer" }}>Keluar</button>
        </div>
        {/* Progress dots */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "40px" }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{
              width: "100%", height: "4px", borderRadius: "2px",
              background: i <= step ? "#2251ff" : "#2a2a2a",
              transition: "background 400ms",
            }} />
          ))}
        </div>
        <h2 style={{ color: "#ffffff", fontSize: "20px", fontWeight: 400, marginBottom: "32px" }}>{stepTitles[step - 1]}</h2>

        {step === 1 && (
          <div style={formGroupStyle}>
            <input placeholder="Nama bisnis" value={bizName} onChange={e => setBizName(e.target.value)} style={inputStyle} />
            <input placeholder="Industri" value={industry} onChange={e => setIndustry(e.target.value)} style={inputStyle} />
            <input placeholder="Website (opsional)" value={website} onChange={e => setWebsite(e.target.value)} style={inputStyle} />
            <textarea placeholder="Produk/layanan utama" value={products} onChange={e => setProducts(e.target.value)} style={{ ...inputStyle, minHeight: "80px", resize: "vertical" }} />
            <input placeholder="Target pelanggan" value={targetCustomer} onChange={e => setTargetCustomer(e.target.value)} style={inputStyle} />
          </div>
        )}

        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[
              { val: "increase_profit", label: "Meningkatkan profit" },
              { val: "reduce_cost", label: "Mengurangi biaya" },
              { val: "find_opportunities", label: "Menemukan peluang baru" },
              { val: "launch_new", label: "Meluncurkan bisnis baru" },
              { val: "improve_growth", label: "Meningkatkan pertumbuhan" },
            ].map(opt => (
              <button key={opt.val} onClick={() => setGoalType(opt.val)} style={{
                ...inputStyle, textAlign: "left", cursor: "pointer",
                border: goalType === opt.val ? "1px solid #2251ff" : "1px solid #2a2a2a",
              }}>
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {step === 3 && (
          <div style={formGroupStyle}>
            <label style={labelStyle}>Pendapatan saat ini (Rp)</label>
            <input value={revenue} onChange={e => setRevenue(e.target.value)} style={inputStyle} />
            <label style={labelStyle}>Biaya saat ini (Rp)</label>
            <input value={cost} onChange={e => setCost(e.target.value)} style={inputStyle} />
            <label style={labelStyle}>Modal tersedia (Rp)</label>
            <input value={capital} onChange={e => setCapital(e.target.value)} style={inputStyle} />
            <label style={labelStyle}>Horizon waktu (bulan)</label>
            <input type="number" value={horizon} onChange={e => setHorizon(Number(e.target.value))} min={1} max={120} style={inputStyle} />
          </div>
        )}

        {step === 4 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[
              { val: 1, label: "ADVISORY", desc: "AEE memberi rekomendasi — Anda yang mengeksekusi" },
              { val: 2, label: "APPROVAL", desc: "AEE eksekusi dengan persetujuan Anda untuk setiap aksi penting" },
              { val: 3, label: "CONTROLLED AUTONOMY", desc: "AEE eksekusi otomatis untuk aksi low-risk" },
            ].map(opt => (
              <button key={opt.val} onClick={() => setAutonomy(opt.val)} style={{
                ...inputStyle, textAlign: "left", cursor: "pointer",
                border: autonomy === opt.val ? "1px solid #2251ff" : "1px solid #2a2a2a",
              }}>
                <div style={{ fontWeight: 400, marginBottom: "4px" }}>{opt.label}</div>
                <div style={{ fontSize: "13px", color: "#8a8a8a" }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        )}

        {step === 5 && (
          <div style={formGroupStyle}>
            <p style={{ color: "#8a8a8a", fontSize: "14px", lineHeight: "24px", marginBottom: "24px" }}>
              AEE akan mulai menganalisis bisnis Anda. Berikan judul dan target profit untuk objective pertama.
            </p>
            <label style={labelStyle}>Judul objective</label>
            <input placeholder="Discovery — Peluang WhatsApp Commerce" value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />
            <label style={labelStyle}>Target profit (Rp)</label>
            <input value={targetProfit} onChange={e => setTargetProfit(e.target.value)} style={inputStyle} />
          </div>
        )}

        {error && <div style={{ color: "#ff5252", fontSize: "13px", marginTop: "16px" }}>{error}</div>}
        <button onClick={next} disabled={loading} style={{ ...buttonStyle, marginTop: "32px", width: "100%" }}>
          {loading ? "Memproses..." : step === 5 ? "Mulai analisis" : "Lanjut"}
        </button>
      </div>
    </div>
  );
}

const formGroupStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "16px" };
const labelStyle: React.CSSProperties = { color: "#8a8a8a", fontSize: "13px", fontWeight: 300, marginBottom: "-8px" };

// ════════════════════════════════════════════════════════════════════════════
// ADMIN PANEL
// ════════════════════════════════════════════════════════════════════════════

export function AdminPanel({ onLogout }: { onLogout: () => void }) {
  const [overview, setOverview] = useState<{ users: number; orgs: number; objectives: { count: number; state: string }[] } | null>(null);
  const [users, setUsers] = useState<{ id: string; email: string; role: string; name: string | null; status: string; is_admin: boolean }[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; name: string; slug: string; plan_tier: string; member_count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, u, o] = await Promise.all([adminOverview(), adminUsers(), adminOrgs()]);
      setOverview(ov);
      setUsers(u.users);
      setOrgs(o.orgs);
    } catch (err) {
      console.error("admin error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div style={{ minHeight: "100vh", background: "#000000", padding: "48px 24px" }}>
      <div style={{ maxWidth: "900px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "40px" }}>
          <h1 style={{ color: "#ffffff", fontSize: "22px", fontWeight: 300 }}>Admin Panel</h1>
          <button onClick={onLogout} style={{ background: "none", border: "none", color: "#8a8a8a", fontSize: "13px", cursor: "pointer" }}>Keluar</button>
        </div>

        {loading ? (
          <p style={{ color: "#8a8a8a" }}>Memuat...</p>
        ) : overview ? (
          <>
            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "40px" }}>
              <StatCard label="Users" value={overview.users} />
              <StatCard label="Organizations" value={overview.orgs} />
              <StatCard label="Objectives" value={overview.objectives.reduce((s, o) => s + o.count, 0)} />
            </div>

            {/* Objectives by state */}
            <Section title="Objectives by State">
              {overview.objectives.map(o => (
                <div key={o.state} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1a1a1a" }}>
                  <span style={{ color: "#ffffff", fontSize: "14px" }}>{o.state}</span>
                  <span style={{ color: "#2251ff", fontSize: "14px" }}>{o.count}</span>
                </div>
              ))}
            </Section>

            {/* Users */}
            <Section title="Users">
              {users.map(u => (
                <div key={u.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1a1a1a" }}>
                  <div>
                    <div style={{ color: "#ffffff", fontSize: "14px" }}>{u.email}</div>
                    <div style={{ color: "#8a8a8a", fontSize: "12px" }}>{u.name || "—"} · {u.role}{u.is_admin ? " · ADMIN" : ""}</div>
                  </div>
                  <span style={{ color: u.status === "ACTIVE" ? "#00a9f4" : "#ff5252", fontSize: "13px" }}>{u.status}</span>
                </div>
              ))}
            </Section>

            {/* Orgs */}
            <Section title="Organizations">
              {orgs.map(o => (
                <div key={o.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1a1a1a" }}>
                  <div>
                    <div style={{ color: "#ffffff", fontSize: "14px" }}>{o.name}</div>
                    <div style={{ color: "#8a8a8a", fontSize: "12px" }}>{o.slug} · {o.plan_tier}</div>
                  </div>
                  <span style={{ color: "#8a8a8a", fontSize: "13px" }}>{o.member_count} members</span>
                </div>
              ))}
            </Section>
          </>
        ) : (
          <p style={{ color: "#ff5252" }}>Gagal memuat data admin</p>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: "#1a1a1a", borderRadius: "16px", padding: "24px" }}>
      <div style={{ color: "#8a8a8a", fontSize: "13px", marginBottom: "8px" }}>{label}</div>
      <div style={{ color: "#ffffff", fontSize: "32px", fontWeight: 300 }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "32px" }}>
      <h3 style={{ color: "#ffffff", fontSize: "16px", fontWeight: 400, marginBottom: "16px" }}>{title}</h3>
      {children}
    </div>
  );
}
