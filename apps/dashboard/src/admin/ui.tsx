// AUREX admin shared UI helpers — compact badges, states, formatters.
// Design language mengikuti @/components/aurex-primitives + shadcn.
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function statusTone(status: string | null | undefined): "default" | "destructive" | "secondary" | "success" | "warning" | "outline" {
  const s = (status ?? "").toLowerCase();
  if (["active", "approved", "paid", "completed", "succeeded", "running", "queued", "appoved"].includes(s)) return "success";
  if (["suspended", "failed", "rejected", "timed_out", "cancelled", "deleted", "past_due", "blocked", "killing"].includes(s)) return "destructive";
  if (["pending", "trialing", "warn", "warning"].includes(s)) return "warning";
  if (["inactive", "draft", "expired", "default"].includes(s)) return "secondary";
  return "outline";
}

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const tone = statusTone(value);
  return (
    <Badge variant={tone === "success" ? "default" : tone === "destructive" ? "destructive" : tone === "warning" ? "outline" : tone === "secondary" ? "secondary" : "outline"}
      className={cn("font-medium", tone === "warning" && "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400", tone === "success" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400")}>
      {value}
    </Badge>
  );
}

export function MonoText({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs", className)}>{children}</span>;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export function fmtRupiah(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return String(value);
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

export function pageSize(defaultN = 50): { limit: number; offset: number } {
  return { limit: defaultN, offset: 0 };
}
