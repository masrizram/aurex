// AUREX admin — Users module: search/filter/page, detail, edit, suspend/activate,
// grant/revoke admin, hard delete (aman: dependency analysis di backend).
import { useState } from "react";
import { toast } from "sonner";
import { Search, RefreshCw, Eye, Pencil, Ban, CheckCircle2, ShieldCheck, ShieldOff, Trash2, X } from "lucide-react";
import {
  adminUsers, adminUserDetail, adminUserUpdate, adminUserSuspend, adminUserActivate,
  adminUserGrantAdmin, adminUserRevokeAdmin, adminUserDelete,
  type AdminUserRow, type AdminUserDetail,
} from "../api";
import { useAsync } from "@/hooks/use-async";
import { StatusBadge, fmtDate, MonoText } from "../ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { LoadingState, ErrorState } from "@/components/aurex-primitives";

export function AdminUsers() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("ALL");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const [editUser, setEditUser] = useState<AdminUserRow | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editRole, setEditRole] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, error, loading } = useAsync(
    () => adminUsers({ search: search || undefined, status: status === "ALL" ? undefined : status, limit: 50, offset: page * 50 }),
    [search, status, page, refreshKey],
  );

  const openDetail = async (u: AdminUserRow) => {
    setSelected(u);
    setDetailLoading(true);
    setDetail(null);
    try {
      const d = await adminUserDetail(u.id);
      setDetail(d.user);
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setDetailLoading(false);
    }
  };

  const openEdit = (u: AdminUserRow) => {
    setEditUser(u);
    setEditRole(u.role);
    setEditStatus(u.status);
    setEditName(u.name ?? "");
  };

  const saveEdit = async () => {
    if (!editUser) return;
    setSaving(true);
    try {
      await adminUserUpdate(editUser.id, { role: editRole, status: editStatus, name: editName || undefined });
      toast.success("User diperbarui");
      setEditUser(null);
      setRefreshKey((k) => k + 1);
      if (selected?.id === editUser.id) openDetail(editUser);
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const suspend = async (u: AdminUserRow) => {
    try { await adminUserSuspend(u.id); toast.success("User di-suspend"); setRefreshKey((k) => k + 1); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
  };
  const activate = async (u: AdminUserRow) => {
    try { await adminUserActivate(u.id); toast.success("User diaktifkan"); setRefreshKey((k) => k + 1); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
  };
  const grantAdmin = async (u: AdminUserRow) => {
    try { await adminUserGrantAdmin(u.id); toast.success("Admin diberikan"); setRefreshKey((k) => k + 1); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
  };
  const revokeAdmin = async (u: AdminUserRow) => {
    try { await adminUserRevokeAdmin(u.id); toast.success("Admin dicabut"); setRefreshKey((k) => k + 1); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
  };
  const hardDelete = async (u: AdminUserRow) => {
    try { await adminUserDelete(u.id); toast.success("User dihapus permanen"); setRefreshKey((k) => k + 1); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>Kelola akun, role, status, dan hak admin.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-56">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Cari email / nama…" className="pl-9" />
            </div>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua</SelectItem>
                <SelectItem value="ACTIVE">Aktif</SelectItem>
                <SelectItem value="SUSPENDED">Suspend</SelectItem>
                <SelectItem value="DELETED">Terhapus</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => setRefreshKey((k) => k + 1)} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          </div>

          {loading ? <LoadingState rows={4} /> : error ? <ErrorState message={error} onRetry={() => setRefreshKey((k) => k + 1)} /> : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead><TableHead>Nama</TableHead><TableHead>Role</TableHead>
                    <TableHead>Status</TableHead><TableHead>Admin</TableHead><TableHead>Orgs</TableHead><TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.users.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Tidak ada user.</TableCell></TableRow>}
                  {data?.users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.email}</TableCell>
                      <TableCell>{u.name ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline">{u.role}</Badge></TableCell>
                      <TableCell><StatusBadge value={u.status} /></TableCell>
                      <TableCell>{u.is_admin ? <Badge variant="destructive">admin</Badge> : "—"}</TableCell>
                      <TableCell className="tabular-nums">{u.org_count}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title="Detail" onClick={() => openDetail(u)}><Eye className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(u)}><Pencil className="h-4 w-4" /></Button>
                          {u.status === "ACTIVE" ? (
                            <Button variant="ghost" size="icon" title="Suspend" onClick={() => suspend(u)} className="text-amber-500"><Ban className="h-4 w-4" /></Button>
                          ) : (
                            <Button variant="ghost" size="icon" title="Aktifkan" onClick={() => activate(u)} className="text-emerald-500"><CheckCircle2 className="h-4 w-4" /></Button>
                          )}
                          {u.is_admin ? (
                            <Button variant="ghost" size="icon" title="Cabut admin" onClick={() => revokeAdmin(u)} className="text-muted-foreground"><ShieldOff className="h-4 w-4" /></Button>
                          ) : (
                            <Button variant="ghost" size="icon" title="Beri admin" onClick={() => grantAdmin(u)} className="text-muted-foreground"><ShieldCheck className="h-4 w-4" /></Button>
                          )}
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
              <p className="text-xs text-muted-foreground">{data.users.length} user (halaman {page + 1})</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Sebelumnya</Button>
                <Button variant="outline" size="sm" disabled={data.users.length < 50} onClick={() => setPage((p) => p + 1)}>Berikutnya →</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit User</DialogTitle></DialogHeader>
          {editUser && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Nama tampilan</label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nama" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Role</label>
                <Select value={editRole} onValueChange={setEditRole}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">owner</SelectItem>
                    <SelectItem value="operator">operator</SelectItem>
                    <SelectItem value="auditor">auditor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Status</label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                    <SelectItem value="SUSPENDED">SUSPENDED</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}><X className="h-4 w-4" /> Batal</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? "Menyimpan…" : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>User Detail</DialogTitle></DialogHeader>
          {detailLoading ? <LoadingState rows={2} /> : detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="space-y-2">
                  <p className="text-muted-foreground">Email <span className="block font-medium text-foreground">{detail.email}</span></p>
                  <p className="text-muted-foreground">Role <span className="block font-medium text-foreground">{detail.role}</span></p>
                  <p className="text-muted-foreground">Status <span className="block font-medium text-foreground"><StatusBadge value={detail.status} /></span></p>
                  <p className="text-muted-foreground">Admin <span className="block font-medium text-foreground">{detail.is_admin ? "Ya" : "Tidak"}</span></p>
                </div>
                <div className="space-y-2">
                  <p className="text-muted-foreground">Dibuat <span className="block font-medium text-foreground">{fmtDate(detail.created_at)}</span></p>
                  <p className="text-muted-foreground">Objective <span className="block font-medium text-foreground tabular-nums">{detail.objective_count}</span></p>
                  <p className="text-muted-foreground">Sesi <span className="block font-medium text-foreground tabular-nums">{detail.session_count}</span></p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Memberships</p>
                {detail.memberships && detail.memberships.length > 0 ? (
                  <div className="space-y-1.5">
                    {detail.memberships.map((m) => (
                      <div key={m.org_id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                        <span className="font-medium">{m.org_name}</span>
                        <div className="flex items-center gap-2">
                          <MonoText>{m.org_slug}</MonoText>
                          <Badge variant="outline">{m.role}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">Tidak ada.</p>}
              </div>
              <div className="flex justify-end gap-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm"><Trash2 className="h-4 w-4" /> Hapus permanen</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Hapus user permanen?</AlertDialogTitle>
                      <AlertDialogDescription>Ditolak bila ada referensi (objectives, memberships, dst). Suspensi lebih aman untuk akun yang masih direferensikan.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Batal</AlertDialogCancel>
                      <AlertDialogAction onClick={() => { hardDelete(detail).then(() => setSelected(null)); }} className="bg-destructive text-destructive-foreground">Hapus</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ) : <p className="text-muted-foreground text-sm">Tidak ada detail.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
