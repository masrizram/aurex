import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { ProfileDropdown } from "@/components/profile-dropdown";
import { Search } from "@/components/search";
import { ThemeSwitch } from "@/components/theme-switch";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useTheme } from "@/context/theme-provider";
import { getMe } from "@/api";
import { useSession } from "@/lib/session";
import { fmtNum } from "@/components/aurex-primitives";

// ═════════════════════════════════════════════════════════════════
// P17 — Settings (§26): sidebar-nav pattern dari shadcn-admin
// settings (Account / Organization / Billing & Plan / AI Usage /
// Appearance / Security).
// ═════════════════════════════════════════════════════════════════

const SECTIONS = [
  { id: "account", label: "Account" },
  { id: "organization", label: "Organization" },
  { id: "billing", label: "Billing & Plan" },
  { id: "usage", label: "AI Usage" },
  { id: "appearance", label: "Appearance" },
  { id: "security", label: "Security" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsPage() {
  const session = useSession();
  const location = useLocation();
  const [section, setSection] = useState<SectionId>(() => {
    const hash = location.hash.replace("#", "") as SectionId;
    return SECTIONS.some((s) => s.id === hash) ? hash : "account";
  });

  return (
    <>
      <Header>
        <div className='flex flex-row gap-2'>
          <Search />
          <div className='ml-auto flex items-center gap-2 space-x-1'>
            <ThemeSwitch />
            <ProfileDropdown session={session} />
          </div>
        </div>
      </Header>
      <Main>
        <div className='mb-6'>
          <h1 className='text-2xl font-semibold tracking-tight'>Settings</h1>
          <p className='text-sm text-muted-foreground'>
            Kelola akun, organisasi, langganan, dan preferensi Anda.
          </p>
        </div>
        <div className='flex flex-col gap-8 lg:flex-row'>
          <nav className='w-full shrink-0 lg:w-48' aria-label='Settings navigation'>
            <ul className='flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5' role='list'>
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/app/settings#${s.id}`}
                    onClick={() => setSection(s.id)}
                    className={cn(
                      "block rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors hover:bg-accent hover:text-accent-foreground",
                      section === s.id ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground"
                    )}
                    aria-current={section === s.id ? "page" : undefined}
                  >
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className='min-w-0 flex-1 max-w-2xl'>
            {section === "account" && <AccountSection />}
            {section === "organization" && <OrganizationSection />}
            {section === "billing" && <BillingSection />}
            {section === "usage" && <UsageSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "security" && <SecuritySection />}
          </div>
        </div>
      </Main>
    </>
  );
}

function SectionCard({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>{title}</CardTitle>
        {desc && <CardDescription>{desc}</CardDescription>}
      </CardHeader>
      <CardContent className='space-y-4'>{children}</CardContent>
    </Card>
  );
}

function AccountSection() {
  const session = useSession();
  const [name, setName] = useState(session?.email?.split("@")[0] ?? "");
  return (
    <div className='space-y-6'>
      <SectionCard title='Profile' desc='Informasi akun Anda.'>
        <div className='grid gap-2'>
          <Label htmlFor='settings-name'>Nama</Label>
          <Input id='settings-name' value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className='grid gap-2'>
          <Label htmlFor='settings-email'>Email</Label>
          <Input id='settings-email' value={session?.email ?? ""} disabled />
        </div>
        <Button size='sm' onClick={() => toast.info("Perubahan profil disimpan secara lokal pada versi ini.")}>
          Simpan
        </Button>
      </SectionCard>
      <SectionCard title='Data' desc='Data ekonomi Anda milik Anda.'>
        <p className='text-sm text-muted-foreground'>
          Semua objective, hasil, dan ledger ekonomi milik organisasi Anda dan tidak pernah dibagikan lintas tenant.
        </p>
      </SectionCard>
    </div>
  );
}

function OrganizationSection() {
  const session = useSession();
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | null>(null);
  useEffect(() => { getMe().then(setMe).catch(() => {}); }, []);
  return (
    <SectionCard title='Organization' desc='Organisasi aktif Anda.'>
      {me?.org ? (
        <div className='space-y-3 text-sm'>
          <div className='flex justify-between'><span className='text-muted-foreground'>Nama</span><span className='font-medium'>{me.org.name}</span></div>
          <div className='flex justify-between'><span className='text-muted-foreground'>Slug</span><span className='font-mono text-xs'>{me.org.slug}</span></div>
          <div className='flex justify-between'><span className='text-muted-foreground'>Plan</span><Badge variant='secondary'>{me.org.planTier}</Badge></div>
          <div className='flex justify-between'><span className='text-muted-foreground'>Execution preference</span><span className='font-medium'>{autonomyLabel(me.org.autonomyLevel)}</span></div>
        </div>
      ) : (
        <Skeleton className='h-24 w-full' />
      )}
      <Separator />
      <p className='text-xs text-muted-foreground'>{session?.email}</p>
    </SectionCard>
  );
}

function autonomyLabel(level: number): string {
  if (level <= 1) return "Advisory";
  if (level === 2) return "Approval Required";
  return "Controlled Autonomy";
}

const PLANS = [
  { tier: "FREE", name: "Free", price: "Rp0", objectives: "1 objective", credits: "100 AI credits/bln" },
  { tier: "STARTER", name: "Starter", price: "Rp499rb", objectives: "5 objectives", credits: "500 AI credits/bln" },
  { tier: "GROWTH", name: "Growth", price: "Rp2,5jt", objectives: "Unlimited", credits: "2.000 AI credits/bln" },
  { tier: "ENTERPRISE", name: "Enterprise", price: "Custom", objectives: "Unlimited", credits: "Custom" },
];

function BillingSection() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | null>(null);
  const [plan, setPlan] = useState<{ plan: any; usage: any } | null>(null);
  useEffect(() => {
    getMe().then(setMe).catch(() => {});
    fetch("/billing/plan").then((r) => r.json()).then(setPlan).catch(() => {});
  }, []);
  const currentTier = (plan?.plan?.tier ?? me?.org?.planTier ?? "FREE").toUpperCase();
  const creditsUsed = plan?.usage?.credits_used ?? 0;
  const creditsLimit = plan?.usage?.credits_limit ?? 0;

  return (
    <div className='space-y-6'>
      <SectionCard title='Current Plan' desc='Paket langganan aktif Anda.'>
        <div className='flex items-center justify-between'>
          <div>
            <p className='text-2xl font-semibold'>{PLANS.find((p) => p.tier === currentTier)?.name ?? currentTier}</p>
            <p className='text-sm text-muted-foreground'>
              {PLANS.find((p) => p.tier === currentTier)?.objectives} · {PLANS.find((p) => p.tier === currentTier)?.credits}
            </p>
          </div>
          <Badge variant='secondary'>Aktif</Badge>
        </div>
        <Separator />
        <div className='grid gap-4 sm:grid-cols-4'>
          {PLANS.map((p) => (
            <div key={p.tier} className={cn(
              'rounded-lg border p-3 space-y-1',
              p.tier === currentTier && 'border-primary bg-primary/5'
            )}>
              <p className='text-sm font-medium'>{p.name}</p>
              <p className='text-lg font-semibold'>{p.price}</p>
              <p className='text-xs text-muted-foreground'>{p.objectives}</p>
            </div>
          ))}
        </div>
        <p className='text-xs text-muted-foreground'>
          Upgrade/downgrade akan tersedia saat payment provider aktif. Saat ini perubahan plan dilakukan via tim AUREX.
        </p>
      </SectionCard>

      <SectionCard title='AI Usage' desc='Kredit AI terpakai bulan ini.'>
        {creditsLimit > 0 ? (
          <>
            <div className='flex justify-between text-sm'>
              <span>{fmtNum(creditsUsed)} / {fmtNum(creditsLimit)} credits</span>
              <span className='text-muted-foreground'>{Math.round((creditsUsed / creditsLimit) * 100)}%</span>
            </div>
            <Progress value={(creditsUsed / creditsLimit) * 100} aria-label='AI usage' />
          </>
        ) : (
          <p className='text-sm text-muted-foreground'>Belum ada penggunaan bulan ini.</p>
        )}
      </SectionCard>
    </div>
  );
}

function UsageSection() {
  return <BillingSection />;
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const [selectedFont, setSelectedFont] = useState('inter');
  return (
    <SectionCard title='Appearance' desc='Kustomisasi tampilan aplikasi.'>
      <div className='space-y-4'>
        <div>
          <Label className='mb-2 block'>Theme</Label>
          <div className='flex gap-2'>
            {(['light', 'dark', 'system'] as const).map((t) => (
              <Button
                key={t}
                variant={theme === t ? 'default' : 'outline'}
                size='sm'
                onClick={() => setTheme(t)}
                aria-pressed={theme === t}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </div>
        </div>
        <Separator />
        <div>
          <Label className='mb-2 block'>Font</Label>
          <div className='flex gap-2'>
            {['inter', 'manrope', 'system'].map((f) => (
              <Button
                key={f}
                variant={selectedFont === f ? 'default' : 'outline'}
                size='sm'
                onClick={() => {
                  setSelectedFont(f);
                  document.documentElement.classList.remove('font-inter', 'font-manrope', 'font-system');
                  document.documentElement.classList.add(`font-${f}`);
                  document.cookie = `font=${f};path=/;max-age=31536000`;
                }}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function SecuritySection() {
  const session = useSession();
  return (
    <SectionCard title='Security' desc='Keamanan sesi dan akses.'>
      <div className='space-y-4'>
        <div className='flex items-center justify-between'>
          <div>
            <p className='text-sm font-medium'>Two-factor authentication</p>
            <p className='text-xs text-muted-foreground'>Akan tersedia dalam rilis berikutnya.</p>
          </div>
          <Switch disabled aria-label='Two-factor authentication (belum tersedia)' />
        </div>
        <Separator />
        <div className='flex items-center justify-between'>
          <div>
            <p className='text-sm font-medium'>Session</p>
            <p className='text-xs text-muted-foreground'>Cookie httpOnly, 7 hari.</p>
          </div>
          <Badge variant='outline'>Aktif</Badge>
        </div>
        <Separator />
        <div>
          <p className='text-sm font-medium mb-1'>Ganti password</p>
          <p className='text-xs text-muted-foreground mb-2'>
            Gunakan alur lupa password dari halaman login ({session?.email}).
          </p>
          <Button variant='outline' size='sm' asChild>
            <Link to='/auth/forgot-password'>Kirim tautan pemulihan</Link>
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
