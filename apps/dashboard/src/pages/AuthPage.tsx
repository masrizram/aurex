import { useState } from "react";
import { signup, login, verifyEmail, forgotPassword, resetPassword, parseApiError } from "../api";

type Mode = "login" | "signup" | "verify" | "forgot" | "reset";

export function AuthPage({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<Mode>(mode0());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [token, setToken] = useState(new URLSearchParams(window.location.search).get("token") ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devVerifyToken, setDevVerifyToken] = useState<string | null>(null);

  function mode0(): Mode {
    const p = window.location.pathname;
    if (p.startsWith("/auth/verify")) return "verify";
    if (p.startsWith("/auth/forgot-password")) return "forgot";
    if (p.startsWith("/auth/reset-password")) return "reset";
    if (p.startsWith("/auth/signup")) return "signup";
    return "login";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null); setNotice(null);
    try {
      if (mode === "signup") {
        const res = await signup(email, password, name || undefined, orgName || undefined);
        if ((res as unknown as { verify_token_dev?: string }).verify_token_dev) {
          setDevVerifyToken((res as unknown as { verify_token_dev: string }).verify_token_dev);
        }
        onAuthed();
      } else if (mode === "login") {
        await login(email, password);
        onAuthed();
      } else if (mode === "verify") {
        await verifyEmail(token);
        setNotice("Email terverifikasi. Silakan masuk.");
        setMode("login");
      } else if (mode === "forgot") {
        await forgotPassword(email);
        setNotice("Jika email terdaftar, tautan pemulihan telah dikirim.");
      } else if (mode === "reset") {
        if (newPassword.length < 8) { setError("Password minimal 8 karakter"); return; }
        await resetPassword(token, newPassword);
        setNotice("Password berhasil diganti. Silakan masuk.");
        setMode("login");
      }
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  }

  const title: Record<Mode, string> = {
    login: "Masuk ke AUREX",
    signup: "Buat akun AUREX",
    verify: "Verifikasi Email",
    forgot: "Lupa Password",
    reset: "Ganti Password",
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand">AUREX</div>
        <h2>{title[mode]}</h2>
        {notice && <div className="notice" role="status">{notice}</div>}
        {error && <div className="error" role="alert">{error}</div>}
        {devVerifyToken && (
          <div className="notice dev-token">
            Mode pengembangan — tautan verifikasi:{" "}
            <a href={`/auth/verify?token=${devVerifyToken}`}>klik untuk verifikasi</a>
          </div>
        )}
        <form onSubmit={submit}>
          {(mode === "login" || mode === "signup" || mode === "forgot") && (
            <label>Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
          )}
          {mode === "signup" && (
            <>
              <label>Nama
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>Nama Organisasi (opsional)
                <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="PT Contoh Sukses" />
              </label>
            </>
          )}
          {(mode === "login" || mode === "signup") && (
            <label>Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </label>
          )}
          {(mode === "verify" || mode === "reset") && (
            <label>Token
              <input value={token} onChange={(e) => setToken(e.target.value)} required placeholder="token dari email" />
            </label>
          )}
          {mode === "reset" && (
            <label>Password Baru
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
            </label>
          )}
          <button type="submit" disabled={loading}>
            {loading ? "Memproses…" : title[mode]}
          </button>
        </form>
        <div className="auth-links">
          {mode === "login" && (
            <>
              <button onClick={() => { setMode("forgot"); setError(null); setNotice(null); }}>Lupa password?</button>
              <button onClick={() => { setMode("signup"); setError(null); setNotice(null); }}>Buat akun baru</button>
            </>
          )}
          {mode !== "login" && (
            <button onClick={() => { setMode("login"); setError(null); setNotice(null); }}>Kembali ke Masuk</button>
          )}
        </div>
      </div>
    </div>
  );
}
