import { useEffect, useState, useCallback } from "react";
import { getMe } from "../api";

// P6 — Settings essential: Account + Billing/Plan + AI Usage.
// (Team, Integrations, API, dll ditunda sesuai scope freeze.)

type Billing = {
  plan: { tier: string; name: string; price_monthly: string; max_ai_credits_monthly: number };
  subscription: { status: string; current_period_end: string | null } | null;
  usage: { credits_used: number; credits_limit: number };
};

async function fetchBilling(): Promise<Billing> {
  const res = await fetch("/billing/plan", { headers: { "content-type": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

export function SettingsPage() {
  const [me, setMe] = useState<{ user: { id: string; role: string; isAdmin: boolean }; org: { name: string; planTier: string } | null } | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await getMe();
      setMe(m as never);
      try { setBilling(await fetchBilling()); } catch { setBilling(null); }
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const usagePct = billing && billing.usage.credits_limit > 0
    ? Math.min(100, (billing.usage.credits_used / billing.usage.credits_limit) * 100) : 0;

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle">Account, plan, dan penggunaan AI.</p>
      {error && <div className="error-banner"><span className="error-banner-text">{error}</span></div>}

      <div className="exec-section">
        <div className="exec-section-title">ACCOUNT</div>
        <div className="exec-block">
          <div className="kv-grid">
            <div className="kv-key">User ID</div><div className="kv-val">{me?.user.id ?? "—"}</div>
            <div className="kv-key">Role</div><div className="kv-val">{me?.user.role ?? "—"}</div>
            <div className="kv-key">Organization</div><div className="kv-val">{me?.org?.name ?? "—"}</div>
          </div>
        </div>
      </div>

      <div className="exec-section">
        <div className="exec-section-title">BILLING & PLAN</div>
        <div className="exec-block">
          <div className="kv-grid">
            <div className="kv-key">Current Plan</div>
            <div className="kv-val">{billing?.plan.name ?? me?.org?.planTier ?? "FREE"}</div>
            <div className="kv-key">Harga</div>
            <div className="kv-val">{billing ? `Rp${Number(billing.plan.price_monthly).toLocaleString("id-ID")} / bulan` : "—"}</div>
            <div className="kv-key">Status</div>
            <div className="kv-val">{billing?.subscription?.status ?? "Aktif"}</div>
          </div>
        </div>
      </div>

      <div className="exec-section">
        <div className="exec-section-title">AI USAGE</div>
        <div className="exec-block">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: "#8a8a8a" }}>Credits bulan ini</span>
            <span style={{ color: "#fff" }}>{billing ? `${billing.usage.credits_used} / ${billing.usage.credits_limit || "∞"}` : "—"}</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${usagePct}%` }} />
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="btn btn--sm" disabled title="Segera hadir">Upgrade Plan</button>
            <span style={{ color: "#555", fontSize: 13, marginLeft: 12 }}>Top-up & invoice menyusul.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
