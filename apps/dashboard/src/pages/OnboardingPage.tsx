import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, TrendingUp } from "lucide-react";
import {
  onboardingStep1, onboardingStep2, onboardingStep3, onboardingStep4, onboardingStep5,
  onboardingStatus, getObjectiveDetail, parseApiError,
} from "@/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ═════════════════════════════════════════════════════════════════
// P5 — Onboarding wizard (shadcn-admin design language, §29).
// Canonical: Organization → Business → Economic Baseline → Goal →
// Execution Preference → First Analysis (real progress, no fake).
// Default execution = Approval Required (level 2), BUKAN Advisory.
// ═════════════════════════════════════════════════════════════════

const STEPS = [
  "Organization", "Business", "Economic Baseline", "Goal", "Execution Preference",
];

const GOALS = [
  { value: "increase_profit", label: "Menaikkan profit" },
  { value: "reduce_cost", label: "Menekan biaya" },
  { value: "find_opportunities", label: "Menemukan peluang baru" },
  { value: "launch_new", label: "Meluncurkan produk baru" },
  { value: "improve_growth", label: "Mempercepat pertumbuhan" },
];

export function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0); // 0..4 form, 5 = first analysis
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const restored = useRef(false);

  // Step 0 — Organization
  const [orgName, setOrgName] = useState("");
  // Step 1 — Business
  const [bizName, setBizName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [products, setProducts] = useState("");
  const [targetCustomer, setTargetCustomer] = useState("");
  // Step 2 — Economic Baseline
  const [revenue, setRevenue] = useState("");
  const [cost, setCost] = useState("");
  const [capital, setCapital] = useState("");
  const [horizon, setHorizon] = useState(6);
  // Step 3 — Goal
  const [goalType, setGoalType] = useState("increase_profit");
  const [targetProfit, setTargetProfit] = useState("");
  // Step 4 — Execution Preference (default: Approval Required = 2)
  const [autonomy, setAutonomy] = useState(2);

  // Restore progress bila user reload di tengah wizard
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    onboardingStatus().then((s) => {
      if (s.completed) { onComplete(); return; }
      if (s.step >= 2) setStep(Math.min(2, s.step - 1));
    }).catch(() => { /* anonymous guard menangani */ });
  }, [onComplete]);

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
        await onboardingStep5({ title: `${goalType.replace("_", " ")} — ${bizName}`, target_profit: targetProfit });
        setStep(5); // → First Analysis screen
      }
    } catch (e) { setError(parseApiError(e)); }
    finally { setLoading(false); }
  };

  if (step === 5) return <FirstAnalysis onDone={onComplete} navigate={navigate} />;

  const pct = Math.round(((step + 1) / (STEPS.length + 1)) * 100);

  return (
    <div className='container grid h-svh max-w-none place-items-center'>
      <div className='mx-auto w-full max-w-lg space-y-6 p-4 sm:p-8'>
        <div className='flex items-center justify-center gap-2'>
          <TrendingUp className='size-5' aria-hidden='true' />
          <h1 className='text-xl font-medium'>AUREX</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Selamat datang di AUREX</CardTitle>
            <CardDescription>
              Mari siapkan economic operating system untuk bisnis Anda.
            </CardDescription>
            <div className='mt-2 space-y-2'>
              <div className='flex items-center justify-between text-xs text-muted-foreground'>
                <span>Step {step + 1} of {STEPS.length + 1}</span>
                <span>{STEPS[step] ?? "First Analysis"}</span>
              </div>
              <Progress value={pct} aria-label={`Langkah ${step + 1} dari ${STEPS.length + 1}`} />
            </div>
          </CardHeader>
          <CardContent className='space-y-4'>
            {error && (
              <Alert variant='destructive' role='alert'>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {step === 0 && (
              <div className='grid gap-2'>
                <Label htmlFor='orgName'>Nama Organisasi</Label>
                <Input id='orgName' value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder='PT Contoh Sukses' autoFocus />
                <p className='text-xs text-muted-foreground'>Organisasi adalah wadah semua bisnis dan objective Anda.</p>
              </div>
            )}

            {step === 1 && (
              <div className='grid gap-4'>
                <div className='grid gap-2'>
                  <Label htmlFor='bizName'>Nama Bisnis</Label>
                  <Input id='bizName' value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder='ABC Commerce' autoFocus />
                </div>
                <div className='grid gap-2'>
                  <Label htmlFor='industry'>Industri</Label>
                  <Input id='industry' value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder='Retail / F&B / Jasa…' />
                </div>
                <div className='grid gap-2'>
                  <Label htmlFor='website'>Website (opsional)</Label>
                  <Input id='website' value={website} onChange={(e) => setWebsite(e.target.value)} placeholder='https://…' />
                </div>
                <div className='grid gap-2'>
                  <Label htmlFor='products'>Produk / layanan utama (opsional)</Label>
                  <Input id='products' value={products} onChange={(e) => setProducts(e.target.value)} placeholder='Kopi bubuk, langganan bulanan…' />
                </div>
                <div className='grid gap-2'>
                  <Label htmlFor='targetCustomer'>Pelanggan utama</Label>
                  <Input id='targetCustomer' value={targetCustomer} onChange={(e) => setTargetCustomer(e.target.value)} placeholder='Pemilik warung di Jakarta…' />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className='grid gap-4'>
                <div className='grid gap-2'>
                  <Label htmlFor='revenue'>Pendapatan bulanan saat ini (Rp)</Label>
                  <Input id='revenue' inputMode='numeric' value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder='0' />
                </div>
                <div className='grid gap-2'>
                  <Label htmlFor='cost'>Biaya bulanan saat ini (Rp)</Label>
                  <Input id='cost' inputMode='numeric' value={cost} onChange={(e) => setCost(e.target.value)} placeholder='0' />
                </div>
                <div className='grid gap-2'>
                  <Label htmlFor='capital'>Modal tersedia (Rp)</Label>
                  <Input id='capital' inputMode='numeric' value={capital} onChange={(e) => setCapital(e.target.value)} placeholder='0' />
                  <p className='text-xs text-muted-foreground'>Tidak yakin angkanya? Isi 0 — AUREX mulai dari belajar dulu.</p>
                </div>
                <div className='grid gap-2'>
                  <Label>Horizon waktu</Label>
                  <Select value={String(horizon)} onValueChange={(v) => setHorizon(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[3, 6, 12, 24].map((m) => (
                        <SelectItem key={m} value={String(m)}>{m} bulan</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className='grid gap-4'>
                <div className='grid gap-2'>
                  <Label>Tujuan utama</Label>
                  <RadioGroup value={goalType} onValueChange={setGoalType} className='gap-2'>
                    {GOALS.map((g) => (
                      <Label key={g.value} htmlFor={g.value} className={cn(
                        'flex items-center gap-3 rounded-md border p-3 text-sm font-normal cursor-pointer',
                        goalType === g.value && 'border-primary bg-primary/5'
                      )}>
                        <RadioGroupItem id={g.value} value={g.value} />
                        {g.label}
                      </Label>
                    ))}
                  </RadioGroup>
                </div>
                <div className='grid gap-2'>
                  <Label htmlFor='targetProfit'>Target profit (Rp)</Label>
                  <Input id='targetProfit' inputMode='numeric' value={targetProfit} onChange={(e) => setTargetProfit(e.target.value)} placeholder='5000000' />
                </div>
              </div>
            )}

            {step === 4 && (
              <div className='grid gap-2'>
                <Label>Preferensi Eksekusi</Label>
                <RadioGroup value={String(autonomy)} onValueChange={(v) => setAutonomy(Number(v))} className='gap-2'>
                  {[
                    { v: 1, t: 'Advisory', d: 'AUREX hanya menyarankan — semua keputusan dan eksekusi oleh Anda.' },
                    { v: 2, t: 'Approval Required', d: 'AUREX mengeksekusi setelah Anda menyetujui misi yang diusulkan. (Direkomendasikan)' },
                    { v: 3, t: 'Controlled Autonomy', d: 'AUREX mengeksekusi otomatis dalam batas modal dan risiko yang Anda tetapkan.' },
                  ].map((o) => (
                    <Label key={o.v} htmlFor={`aut-${o.v}`} className={cn(
                      'flex items-start gap-3 rounded-md border p-3 cursor-pointer',
                      autonomy === o.v && 'border-primary bg-primary/5'
                    )}>
                      <RadioGroupItem id={`aut-${o.v}`} value={String(o.v)} className='mt-0.5' />
                      <div className='space-y-1'>
                        <p className='text-sm font-medium leading-none'>{o.t}</p>
                        <p className='text-xs text-muted-foreground'>{o.d}</p>
                      </div>
                    </Label>
                  ))}
                </RadioGroup>
              </div>
            )}

            <div className='flex items-center justify-between pt-2'>
              <Button type='button' variant='ghost' disabled={step === 0 || loading}
                onClick={() => setStep((s) => Math.max(0, s - 1))}>
                Kembali
              </Button>
              <Button onClick={next} disabled={loading}>
                {loading ? "Memproses…" : step === 4 ? "Mulai Analisis" : "Lanjut"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ═══ First Analysis — REAL progress dari state machine (§31) ══════════════════
const ANALYSIS_STEPS: [string, string][] = [
  ["OBJECTIVE", "Memahami bisnis Anda"],
  ["RESEARCH", "Menghitung baseline ekonomi"],
  ["RANK", "Meneliti peluang"],
  ["SELECT", "Menyusun peringkat peluang"],
  ["DECISION", "Menyiapkan rekomendasi"],
];

function FirstAnalysis({ onDone, navigate }: { onDone: () => void; navigate: ReturnType<typeof useNavigate> }) {
  const [state, setState] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const objs = await (await import("@/api")).listObjectives();
        const first = objs[0];
        if (!first) return;
        const d = await getObjectiveDetail(first.id);
        if (!alive) return;
        setState(d.status);
        setDetail(d.decision?.rationale ?? null);
        // Selesai saat FSM melewati ranking (opportunities siap / decision ready)
        const done = ["OPPORTUNITIES_RANKED", "DECISION_READY", "ACHIEVED"].includes(d.status);
        if (done) {
          setTimeout(() => { if (alive) { onDone(); navigate("/app", { replace: true }); } }, 1200);
        }
      } catch { /* retry next tick */ }
    };
    const iv = setInterval(tick, 2500);
    tick();
    return () => { alive = false; clearInterval(iv); };
  }, [onDone, navigate]);

  const currentIdx = ANALYSIS_STEPS.findIndex(([tok]) => (state ?? "").includes(tok));
  return (
    <div className='container grid h-svh max-w-none place-items-center'>
      <Card className='w-full max-w-md'>
        <CardHeader>
          <CardTitle>AUREX sedang membangun model ekonomi Anda.</CardTitle>
          <CardDescription>Analisis berjalan otomatis — progres di bawah ini nyata, bukan animasi.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          {ANALYSIS_STEPS.map(([tok, label], i) => {
            const done = currentIdx > i;
            const active = currentIdx === i;
            return (
              <div key={tok} className={cn('flex items-center gap-3 text-sm', !done && !active && 'text-muted-foreground')}>
                {done ? (
                  <span className='grid size-5 place-items-center rounded-full bg-primary text-primary-foreground'>
                    <Check className='size-3' aria-hidden='true' />
                  </span>
                ) : active ? (
                  <span className='grid size-5 place-items-center rounded-full border-2 border-primary border-t-transparent animate-spin' aria-label='sedang berjalan' />
                ) : (
                  <span className='size-5 rounded-full border' aria-hidden='true' />
                )}
                <span>{label}</span>
              </div>
            );
          })}
          {detail && (
            <Alert className='mt-2'>
              <AlertDescription>{detail}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
