// AUREX admin — Billing: subscription, plan, quota, Duitku invoices. Read-only view.
import { useState } from "react";
import { RefreshCw, ExternalLink } from "lucide-react";
import { adminBilling } from "../api";
import { useAsync } from "@/hooks/use-async";
import { StatusBadge, fmtDate, fmtRupiah, MonoText } from "../ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingState, ErrorState } from "@/components/aurex-primitives";

type Sub = { id: string; organization_id: string; org_name: string; org_slug: string; status: string; plan_name: string; plan_tier: string; price_monthly: string; max_ai_credits_monthly: number | null; current_period_start: string | null; current_period_end: string | null; cancel_at: string | null };
type Usage = { organization_id: string; month_year: string; credits_used: number; credits_limit: number; credits_purchased: number };
type Invoice = { id: string; organization_id: string; org_name: string; plan_tier: string; period_months: number; amount: string; status: string; merchant_order_id: string; duitku_reference: string | null; payment_url: string | null; created_at: string };

export function AdminBilling() {
  const [orgId, setOrgId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState("subscriptions");

  const { data, error, loading } = useAsync(
    () => adminBilling({ org_id: orgId || undefined, limit: 100 }),
    [orgId, refreshKey],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
          <CardDescription>Subscription, plan, quota, dan transaksi Duitku. Read-only.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="Filter org (uuid)" className="max-w-xs font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={() => setRefreshKey((k) => k + 1)} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
                <TabsTrigger value="usage">Usage Quota</TabsTrigger>
                <TabsTrigger value="invoices">Duitku Invoices</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {loading ? <LoadingState rows={4} /> : error ? <ErrorState message={error} onRetry={() => setRefreshKey((k) => k + 1)} /> : (
            <>
              {tab === "subscriptions" && (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Org</TableHead><TableHead>Plan</TableHead><TableHead>Status</TableHead><TableHead>Bulanan</TableHead><TableHead>Periode End</TableHead><TableHead>Cancel At</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data?.subscriptions as Sub[])?.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Tidak ada subscription.</TableCell></TableRow>}
                      {(data?.subscriptions as Sub[])?.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.org_name}</TableCell>
                          <TableCell><Badge variant="outline">{s.plan_tier}</Badge></TableCell>
                          <TableCell><StatusBadge value={s.status} /></TableCell>
                          <TableCell className="tabular-nums">{fmtRupiah(s.price_monthly)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDate(s.current_period_end)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDate(s.cancel_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {tab === "usage" && (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Org</TableHead><TableHead>Bulan</TableHead><TableHead>Digunakan</TableHead><TableHead>Limit</TableHead><TableHead>Dibeli</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data?.usage as Usage[])?.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Tidak ada usage.</TableCell></TableRow>}
                      {(data?.usage as Usage[])?.map((u, i) => (
                        <TableRow key={`${u.organization_id}-${u.month_year}-${i}`}>
                          <TableCell><MonoText>{u.organization_id.slice(0, 8)}</MonoText></TableCell>
                          <TableCell>{u.month_year}</TableCell>
                          <TableCell className="tabular-nums">{u.credits_used}</TableCell>
                          <TableCell className="tabular-nums">{u.credits_limit ?? "∞"}</TableCell>
                          <TableCell className="tabular-nums">{u.credits_purchased}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {tab === "invoices" && (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Org</TableHead><TableHead>Plan</TableHead><TableHead>Periode</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Order</TableHead><TableHead>Aksi</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data?.invoices as Invoice[])?.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Tidak ada invoice.</TableCell></TableRow>}
                      {(data?.invoices as Invoice[])?.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className="font-medium">{inv.org_name}</TableCell>
                          <TableCell><Badge variant="outline">{inv.plan_tier}</Badge></TableCell>
                          <TableCell className="tabular-nums">{inv.period_months} bln</TableCell>
                          <TableCell className="tabular-nums">{fmtRupiah(inv.amount)}</TableCell>
                          <TableCell><StatusBadge value={inv.status} /></TableCell>
                          <TableCell className="text-xs"><MonoText>{inv.merchant_order_id}</MonoText></TableCell>
                          <TableCell className="text-right">
                            {inv.payment_url && (
                              <Button variant="ghost" size="icon" title="Payment URL" asChild>
                                <a href={inv.payment_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /></a>
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
