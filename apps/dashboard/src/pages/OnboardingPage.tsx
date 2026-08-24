import { useState } from "react";
import {
  onboardingStep1, onboardingStep2, onboardingStep3, onboardingStep4, onboardingStep5,
  parseApiError,
} from "../api";

// ═════════════════════════════════════════════════════════════════
// P5 — Business Onboarding (bukan form objective panjang).
// Urutan canonical: Organization → Business → Economic Baseline →
// Goal → Execution Preference → FIRST ANALYSIS → Control Center.
// Default execution = Approval Required (level 2), BUKAN Advisory.
// ═════════════════════════════════════════════════════════════════

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 16px", background: "#1a1a1a",
  border: "1px solid #2a2a2a", borderRadius: 16, color: "#fff",
  fontSize: 15, fontWeight: 300, outline: "none",
};
const btnStyle: React.CSSProperties = {
  padding: "14px 24px", background: "#2251ff", border: "none", borderRadius: 16,
  color: "#fff", fontSize: 15, fontWeight: 400, cursor: "pointer", width: "100%",
};
const labelStyle: React.CSSProperties = { color: "#8a8a8a", fontSize: 13, fontWeight: 300 };

const STEPS = [
  "Organization", "Business", "Economic Baseline", "Goal", "Execution Preference",
];

export function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0); // 0..4 form, 5 = first analysis
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Step 0 — Organization
  const [orgName, setOrgName] = useState("");
  // Step 1 — Business
  const [bizName, setBizName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [products, setProducts] = useState("");
  const [targetCustomer, setTargetCustomer] = useState("");
  // Step 2 — Economic Baseline (perluas: known/unknown-friendly)
  const [revenue, setRevenue] = useState("");
  const [cost, setCost] = useState("");
  const [capital, setCapital] = useState("");
  const [horizon, setHorizon] = useState(6);
  // Step 3 — Goal
  const [goalType, setGoalType] = useState("increase_profit");
  const [targetProfit, setTargetProfit] = useState("");
  // Step 4 — Execution Preference (default: Approval Required = 2)
  const [autonomy, setAutonomy] = useState(2);

  const next = async () => {
    setError(null); setLoading(true);
    try {
      if (step === 0) {
        if (!orgName.trim()) { setError("Nama organisasi wajib diisi"); setLoading(false); return; }
        setStep(1);
      } else if (step === 1) {
        if (!bizName.trim()) { setError("Nama bisnis wajib diisi"); setLoading(false); return; }
        await onboardingStep1({ business_name: bizName, industry: industry || "General", website: website || undefined, products: products || undefined, target_customer: targetCustomer || "Umum" });
        setStep(2);
      } else if (step === 2) {
        await onboardingStep3({
          current_revenue: revenue || "0", current_cost: cost || "0",
          capital: capital || "0", time_horizon_months: horizon,
        });
        setStep(3);
      } else if (step === 3) {
        if (!targetProfit.trim()) { setError("Target profit wajib diisi"); setLoading(false); return; }
        await onboardingStep2(goalType);
        setStep(4);
      } else if (step === 4) {
        await onboardingStep4(autonomy);
        // Buat objective pertama dari goal + baseline
        await onboardingStep5({ title: `${goalType.replace("_", " ")} — ${bizName}`, target_profit: targetProfit });
        setStep(5); // → First Analysis screen
      }
    } catch (e) { setError(parseApiError(e)); }
    finally { setLoading(false); }
  };

  if (step === 5) return <FirstAnalysis onDone={onComplete} />;

  return (
    <div style={{ minHeight: "100vh", background: "#000", padding: "48px 24px" }}>
      <div style={{ maxWidth: 600, margin: "0 auto" }}>
        <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 300, marginBottom: 8 }}>Selamat datang di AUREX</h1>
        <p style={{ color: "#8a8a8a", fontSize: 14, marginBottom: 32 }}>Mari siapkan economic operating system untuk bisnis Anda.</p>

        {/* progress */}
        <div style={{ display: "flex", gap: 8, marginBottom: 40 }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ flex: 1 }}>
              <div style={{ height: 4, borderRadius: 2, background: i <= step ? "#2251ff" : "#2a2a2a", transition: "background 400ms" }} />
              <div style={{ fontSize: 11, color: i === step ? "#fff" : "#555", marginTop: 6 }}>{s}</div>
            </div>
          ))}
        </div>

        <h2 style={{ color: "#fff", fontSize: 20, fontWeight: 400, marginBottom: 24 }}>{STEPS[step]}</h2>

        {step === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div><label style={labelStyle}>Nama organisasi / perusahaan</label>
              <input style={inputStyle} value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="PT Maju Bersama" /></div>
            <p style={{ color: "#555", fontSize: 13 }}>Organisasi adalah induk dari semua bisnis dan objective Anda.</p>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div><label style={labelStyle}>Bisnis apa yang harus AUREX kerjakan?</label>
              <input style={inputStyle} value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="Nama bisnis" /></div>
            <input style={inputStyle} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industri (F&B, retail, jasa…)" />
            <input style={inputStyle} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website (opsional)" />
            <textarea style={{ ...inputStyle, minHeight: 70 }} value={products} onChange={(e) => setProducts(e.target.value)} placeholder="Apa yang Anda jual?" />
            <input style={inputStyle} value={targetCustomer} onChange={(e) => setTargetCustomer(e.target.value)} placeholder="Siapa yang membeli?" />
          </div>
        )}

        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ color: "#555", fontSize: 13 }}>Isi yang Anda ketahui — sisanya AUREX hitung.</p>
            <div><label style={labelStyle}>Pendapatan bulanan (Rp)</label>
              <input style={inputStyle} value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="0" /></div>
            <div><label style={labelStyle}>Biaya operasional bulanan (Rp)</label>
              <input style={inputStyle} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" /></div>
            <div><label style={labelStyle}>Modal tersedia (Rp)</label>
              <input style={inputStyle} value={capital} onChange={(e) => setCapital(e.target.value)} placeholder="0" /></div>
            <div><label style={labelStyle}>Horizon waktu (bulan)</label>
              <input style={inputStyle} type="number" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} min={1} max={120} /></div>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { val: "increase_profit", label: "↑ Increase Profit" },
              { val: "reduce_cost", label: "↓ Reduce Cost" },
              { val: "improve_growth", label: "↗ Grow Revenue" },
              { val: "find_opportunities", label: "◎ Find New Opportunity" },
              { val: "launch_new", label: "＋ Launch New Venture" },
            ].map((o) => (
              <button key={o.val} onClick={() => setGoalType(o.val)} style={{
                ...inputStyle, textAlign: "left", cursor: "pointer",
                border: goalType === o.val ? "1px solid #2251ff" : "1px solid #2a2a2a",
              }}>{o.label}</button>
            ))}
            <div style={{ marginTop: 8 }}><label style={labelStyle}>Target profit (Rp)</label>
              <input style={inputStyle} value={targetProfit} onChange={(e) => setTargetProfit(e.target.value)} placeholder="20000000" /></div>
          </div>
        )}

        {step === 4 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { val: 1, label: "Advisory", desc: "AUREX hanya menganalisis dan merekomendasikan." },
              { val: 2, label: "Approval Required", desc: "AUREX menyiapkan tindakan, Anda setujui sebelum eksekusi." },
              { val: 3, label: "Controlled Autonomy", desc: "AUREX mengeksekusi aksi tertentu dalam policy/budget yang ditentukan." },
            ].map((o) => (
              <button key={o.val} onClick={() => setAutonomy(o.val)} style={{
                ...inputStyle, textAlign: "left", cursor: "pointer",
                border: autonomy === o.val ? "1px solid #2251ff" : "1px solid #2a2a2a",
              }}>
                <div style={{ fontWeight: 400, marginBottom: 4 }}>{o.label}{o.val === 2 && <span style={{ color: "#2251ff", fontSize: 12, marginLeft: 8 }}>Direkomendasikan</span>}</div>
                <div style={{ fontSize: 13, color: "#8a8a8a" }}>{o.desc}</div>
              </button>
            ))}
          </div>
        )}

        {error && <div style={{ color: "#ff5252", fontSize: 13, marginTop: 16 }}>{error}</div>}
        <button onClick={next} disabled={loading} style={{ ...btnStyle, marginTop: 32, opacity: loading ? 0.6 : 1 }}>
          {loading ? "Memproses…" : step === 4 ? "Mulai Analisis" : "Lanjut"}
        </button>
      </div>
    </div>
  );
}

// P5 — First Analysis: jangan lempar user ke tabel kosong.
function FirstAnalysis({ onDone }: { onDone: () => void }) {
  const items = [
    "Memahami bisnis Anda",
    "Menganalisis ekonomi saat ini",
    "Meneliti pasar",
    "Mengidentifikasi peluang",
    "Menyiapkan rekomendasi",
  ];
  return (
    <div style={{ minHeight: "100vh", background: "#000", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 480, width: "100%" }}>
        <h1 style={{ color: "#fff", fontSize: 20, fontWeight: 300, letterSpacing: 1, marginBottom: 8 }}>AUREX SEDANG MEMBANGUN</h1>
        <h2 style={{ color: "#fff", fontSize: 20, fontWeight: 300, marginBottom: 40 }}>MODEL EKONOMI ANDA</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 48 }}>
          {items.map((t, i) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 12, color: i < 2 ? "#fff" : "#8a8a8a" }}>
              <span style={{ color: i < 2 ? "#00a9f4" : i === 2 ? "#2251ff" : "#555" }}>{i < 2 ? "✓" : i === 2 ? "●" : "○"}</span>
              <span style={{ fontSize: 15 }}>{t}</span>
            </div>
          ))}
        </div>
        <p style={{ color: "#555", fontSize: 13, marginBottom: 24 }}>Analisis berjalan di belakang layar. Anda dapat langsung masuk ke Control Center.</p>
        <button onClick={onDone} style={btnStyle}>Buka Control Center</button>
      </div>
    </div>
  );
}
