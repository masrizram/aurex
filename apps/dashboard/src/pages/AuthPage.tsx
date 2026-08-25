import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TrendingUp } from "lucide-react";
import { signup, login, verifyEmail, forgotPassword, resetPassword, parseApiError } from "@/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PasswordInput } from "@/components/password-input";

// ═════════════════════════════════════════════════════════════════
// AUREX Auth — shadcn-admin auth design language (§28).
// Screens: Sign In / Sign Up / Verify / Forgot / Reset. No sidebar.
// ═════════════════════════════════════════════════════════════════

type Mode = "login" | "signup" | "verify" | "forgot" | "reset";

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='container grid h-svh max-w-none items-center justify-center'>
      <div className='mx-auto flex w-full flex-col justify-center space-y-2 py-8 sm:p-8'>
        <div className='mb-4 flex items-center justify-center gap-2'>
          <TrendingUp className='size-5' aria-hidden='true' />
          <h1 className='text-xl font-medium'>AUREX</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

const TITLES: Record<Mode, { title: string; desc: string }> = {
  login: { title: "Masuk ke AUREX", desc: "Economic Control Center untuk bisnis Anda." },
  signup: { title: "Buat akun AUREX", desc: "Mulai bangun economic operating system bisnis Anda." },
  verify: { title: "Verifikasi Email", desc: "Masukkan token verifikasi dari email Anda." },
  forgot: { title: "Lupa Password", desc: "Kami kirimkan tautan pemulihan bila email terdaftar." },
  reset: { title: "Ganti Password", desc: "Masukkan token dan password baru Anda." },
};

export function AuthPage({ onAuthed }: { onAuthed: () => void }) {
  const navigate = useNavigate();
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

  function goto(m: Mode) {
    setMode(m); setError(null); setNotice(null);
    const paths: Record<Mode, string> = {
      login: "/auth/login", signup: "/auth/signup", verify: "/auth/verify",
      forgot: "/auth/forgot-password", reset: "/auth/reset-password",
    };
    navigate(paths[m], { replace: true });
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
        if (newPassword.length < 8) { setError("Password minimal 8 karakter"); setLoading(false); return; }
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

  const t = TITLES[mode];

  return (
    <AuthLayout>
      <Card className='mx-auto w-full max-w-sm'>
        <CardHeader>
          <CardTitle className='text-xl'>{t.title}</CardTitle>
          <CardDescription>{t.desc}</CardDescription>
        </CardHeader>
        <CardContent>
          {notice && (
            <Alert className='mb-4' role='status'>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant='destructive' className='mb-4' role='alert'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {devVerifyToken && (
            <Alert className='mb-4'>
              <AlertDescription>
                Mode pengembangan — tautan verifikasi:{" "}
                <Link className='underline' to={`/auth/verify?token=${devVerifyToken}`}>
                  klik untuk verifikasi
                </Link>
              </AlertDescription>
            </Alert>
          )}
          <form onSubmit={submit} className='grid gap-4'>
            {(mode === "login" || mode === "signup" || mode === "forgot") && (
              <div className='grid gap-2'>
                <Label htmlFor='email'>Email</Label>
                <Input
                  id='email' type='email' value={email}
                  onChange={(e) => setEmail(e.target.value)} required autoComplete='email'
                />
              </div>
            )}
            {mode === "signup" && (
              <>
                <div className='grid gap-2'>
                  <Label htmlFor='name'>Nama</Label>
                  <Input id='name' value={name} onChange={(e) => setName(e.target.value)} autoComplete='name' />
                </div>
                <div className='grid gap-2'>
                  <Label htmlFor='orgName'>Nama Organisasi (opsional)</Label>
                  <Input id='orgName' value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder='PT Contoh Sukses' />
                </div>
              </>
            )}
            {(mode === "login" || mode === "signup") && (
              <div className='grid gap-2'>
                <div className='flex items-center justify-between'>
                  <Label htmlFor='password'>Password</Label>
                  {mode === "login" && (
                    <button type='button' className='text-xs text-muted-foreground underline-offset-4 hover:underline' onClick={() => goto("forgot")}>
                      Lupa password?
                    </button>
                  )}
                </div>
                <PasswordInput
                  id='password' value={password}
                  onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </div>
            )}
            {(mode === "verify" || mode === "reset") && (
              <div className='grid gap-2'>
                <Label htmlFor='token'>Token</Label>
                <Input id='token' value={token} onChange={(e) => setToken(e.target.value)} required placeholder='token dari email' />
              </div>
            )}
            {mode === "reset" && (
              <div className='grid gap-2'>
                <Label htmlFor='newPassword'>Password Baru</Label>
                <PasswordInput
                  id='newPassword' value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)} required minLength={8} autoComplete='new-password'
                />
              </div>
            )}
            <Button type='submit' className='w-full' disabled={loading}>
              {loading ? "Memproses…" : t.title}
            </Button>
          </form>
          <div className='mt-4 text-center text-sm'>
            {mode === "login" ? (
              <>
                Belum punya akun?{" "}
                <Link to='/auth/signup' className='underline underline-offset-4' onClick={() => goto("signup")}>Buat akun</Link>
              </>
            ) : (
              <button type='button' className='text-muted-foreground underline underline-offset-4 hover:underline' onClick={() => goto("login")}>
                Kembali ke Masuk
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
