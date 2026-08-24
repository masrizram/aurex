import { useState } from "react";
import { signup, login, parseApiError } from "../api";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 16px", background: "#1a1a1a",
  border: "1px solid #2a2a2a", borderRadius: 16, color: "#fff",
  fontSize: 15, fontWeight: 300, outline: "none",
};
const btnStyle: React.CSSProperties = {
  padding: "14px 24px", background: "#2251ff", border: "none", borderRadius: 16,
  color: "#fff", fontSize: 15, fontWeight: 400, cursor: "pointer",
};

export function AuthPage({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setLoading(true);
    try {
      if (mode === "signup") await signup(email, password, name || undefined, orgName || undefined);
      else await login(email, password);
      onAuthed();
    } catch (err) { setError(parseApiError(err)); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#000" }}>
      <div style={{ width: "100%", maxWidth: 440, padding: 48 }}>
        <h1 style={{ color: "#fff", fontSize: 26, fontWeight: 300, marginBottom: 8, letterSpacing: 1 }}>AUREX</h1>
        <p style={{ color: "#8a8a8a", fontSize: 14, marginBottom: 40 }}>
          {mode === "login" ? "Masuk ke Economic Control Center" : "Buat akun untuk memulai"}
        </p>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {mode === "signup" && (
            <>
              <input placeholder="Nama (opsional)" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
              <input placeholder="Organisasi (opsional)" value={orgName} onChange={(e) => setOrgName(e.target.value)} style={inputStyle} />
            </>
          )}
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
          <input type="password" placeholder="Password (min. 8 karakter)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} style={inputStyle} />
          {error && <div style={{ color: "#ff5252", fontSize: 13 }}>{error}</div>}
          <button type="submit" disabled={loading} style={btnStyle}>
            {loading ? "Memproses…" : mode === "login" ? "Masuk" : "Daftar"}
          </button>
        </form>
        <div style={{ marginTop: 24, textAlign: "center" }}>
          <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}
            style={{ background: "none", border: "none", color: "#2251ff", fontSize: 14, cursor: "pointer" }}>
            {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
          </button>
        </div>
      </div>
    </div>
  );
}
