// AUREX admin — Organizations: edit metadata, plan, status, members, membership.
import { useState } from "react";
import { toast } from "sonner";
import { Search, RefreshCw, Eye, Pencil, Trash2, UserPlus } from "lucide-react";
import {
  adminOrgs, adminOrgDetail, adminOrgUpdate, adminOrgUpdateMember, adminOrgAddMember, adminOrgRemoveMember,
  type AdminOrgRow, type AdminOrgDetail,
} from "../api";
import { useAsync } from "@/hooks/use-async";
import { StatusBadge, fmtDate, MonoText } from "../ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { LoadingState, ErrorState } from "@/components/aurex-primitives";

const PLANS = ["FREE", "STARTER", "GROWTH", "ENTERPRISE"] as const;
const MEMBER_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

export function AdminOrganizations() {
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState<string>("ALL");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AdminOrgRow | null>(null);
  const [detail, setDetail] = useState<AdminOrgDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editName, setEditName] = useState("");
  const [editPlan, setEditPlan] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [newMemberId, setNewMemberId] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("MEMBER");

  const { data, error, loading } = useAsync(
    () => adminOrgs({ search: search || undefined, plan: plan === "ALL" ? undefined : plan, limit: 50, offset: page * 50 }),
    [search, plan, page, refreshKey],
  );

  const openDetail = async (o: AdminOrgRow) => {
    setSelected(o);
    setDetailLoading(true);
    setDetail(null);
    try { const d = await adminOrgDetail(o.id); setDetail(d.organization); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
    finally { setDetailLoading(false); }
  };

  const openEdit = (o: AdminOrgRow) => {
    setEditName(o.name);
    setEditPlan(o.plan_tier);
    setEditStatus(o.status);
  };

  const saveEdit = async () => {
    if (!selected && !editName) return;
    const id = selected?.id;
    if (!id) return;
    setSaving(true);
    try {
      await adminOrgUpdate(id, { name: editName || undefined, plan_tier: editPlan as never, status: editStatus as never });
      toast.success("Organisasi diperbarui");
      setRefreshKey((k) => k + 1);
      openDetail(selected!);
    } catch (e) { toast.error(String((e as Error)?.message ?? e)); }
    finally { setSaving(false); }
  };

  const changeMemberRole = async (userId: string, role: string) => {
    if (!selected) return;
    try { await adminOrgUpdateMember(selected.id, userId, role); toast.success("Role member diubah"); openDetail(selected); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
  };

  const addMember = async () => {
    if (!selected || !newMemberId) return;
    try { await adminOrgAddMember(selected.id, { user_id: newMemberId, role: newMemberRole }); toast.success("Member ditambahkan"); setNewMemberId(""); openDetail(selected); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
  };

  const removeMember = async (userId: string) => {
    if (!selected) return;
    try { await adminOrgRemoveMember(selected.id, userId); toast.success("Member dihapus"); openDetail(selected); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Organizations</CardTitle>
          <CardDescription>Kelola metadata, plan, status, membership.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-56">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Cari nama / slug…" className="pl-9" />
            </div>
            <Select value={plan} onValueChange={(v) => { setPlan(v); setPage(0); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Plan" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua plan</SelectItem>
                {PLANS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => setRefreshKey((k) => k + 1)} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          </div>

          {loading ? <LoadingState rows={4} /> : error ? <ErrorState message={error} onRetry={() => setRefreshKey((k) => k + 1)} /> : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama</TableHead><TableHead>Slug</TableHead><TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead><TableHead>Members</TableHead><TableHead>Objectives</TableHead><TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.orgs.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Tidak ada organisasi.</TableCell></TableRow>}
                  {data?.orgs.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.name}</TableCell>
                      <TableCell><MonoText>{o.slug}</MonoText></TableCell>
                      <TableCell><Badge variant="outline">{o.plan_tier}</Badge></TableCell>
                      <TableCell><StatusBadge value={o.status} /></TableCell>
                      <TableCell className="tabular-nums">{o.member_count}</TableCell>
                      <TableCell className="tabular-nums">{o.objective_count}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title="Detail" onClick={() => openDetail(o)}><Eye className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" title="Edit" onClick={() => { openDetail(o); openEdit(o); }}><Pencil className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {!loading && data && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{data.orgs.length} organisasi (halaman {page + 1})</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Sebelumnya</Button>
                <Button variant="outline" size="sm" disabled={data.orgs.length < 50} onClick={() => setPage((p) => p + 1)}>Berikutnya →</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Organisasi Detail</DialogTitle></DialogHeader>
          {detailLoading ? <LoadingState rows={2} /> : detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <div><p className="text-muted-foreground">Nama</p><p className="font-medium">{detail.name}</p></div>
                <div><p className="text-muted-foreground">Slug</p><p className="font-medium"><MonoText>{detail.slug}</MonoText></p></div>
                <div><p className="text-muted-foreground">Plan</p><p className="font-medium"><Badge variant="outline">{detail.plan_tier}</Badge></p></div>
                <div><p className="text-muted-foreground">Status</p><p className="font-medium"><StatusBadge value={detail.status} /></p></div>
                <div><p className="text-muted-foreground">Autonomy</p><p className="font-medium tabular-nums">{detail.autonomy_level}</p></div>
                <div><p className="text-muted-foreground">Objectives</p><p className="font-medium tabular-nums">{detail.objective_count}</p></div>
              </div>

              {/* Edit section */}
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Edit metadata</p>
                <div className="grid gap-2 md:grid-cols-3">
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nama" />
                  <Select value={editPlan} onValueChange={setEditPlan}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{PLANS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={editStatus} onValueChange={setEditStatus}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="ACTIVE">ACTIVE</SelectItem><SelectItem value="SUSPENDED">SUSPENDED</SelectItem></SelectContent>
                  </Select>
                </div>
                <Button size="sm" onClick={saveEdit} disabled={saving}>{saving ? "Menyimpan…" : "Simpan perubahan"}</Button>
              </div>

              {/* Subscription */}
              {detail.subscription && (
                <div className="rounded-md border p-3 space-y-1 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">Subscription</p>
                  <p><span className="text-muted-foreground">Plan:</span> {detail.subscription.plan_name} ({detail.subscription.plan_tier})</p>
                  <p><span className="text-muted-foreground">Status:</span> <StatusBadge value={detail.subscription.status} /></p>
                  <p><span className="text-muted-foreground">Periode berakhir:</span> {fmtDate(detail.subscription.current_period_end)}</p>
                </div>
              )}

              {/* Members */}
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Members ({detail.members.length})</p>
                <div className="max-h-48 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.members.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="text-sm">{m.email}</TableCell>
                          <TableCell>
                            <Select value={m.role} onValueChange={(v) => changeMemberRole(m.user_id, v)}>
                              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                              <SelectContent>{MEMBER_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" title="Hapus member" onClick={() => removeMember(m.user_id)}><Trash2 className="h-4 w-4" /></Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex gap-2">
                  <Input value={newMemberId} onChange={(e) => setNewMemberId(e.target.value)} placeholder="User ID (uuid)" className="max-w-xs" />
                  <Select value={newMemberRole} onValueChange={setNewMemberRole}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>{MEMBER_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="sm" onClick={addMember}><UserPlus className="h-4 w-4" /> Tambah</Button>
                </div>
              </div>

              {/* Usage */}
              {detail.usage.length > 0 && (
                <div className="rounded-md border p-3 space-y-1 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">AI Credits (6 bulan terakhir)</p>
                  {detail.usage.map((u) => (
                    <div key={u.month_year} className="flex justify-between">
                      <span className="text-muted-foreground">{u.month_year}</span>
                      <span className="tabular-nums">{u.credits_used}/{u.credits_limit}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : <p className="text-muted-foreground text-sm">Tidak ada detail.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
