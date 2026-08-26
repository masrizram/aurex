// AUREX admin — AI Providers: CRUD provider/model, encrypted API key,
// test connection, routing Strategic/Execution/Fallback.
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Plus, Pencil, Trash2, PlugZap, X, KeyRound } from "lucide-react";
import { adminProviders, adminProviderCreate, adminProviderUpdate, adminProviderDelete, adminProviderTest, type AdminProviderRow } from "../api";
import { useAsync } from "@/hooks/use-async";
import { StatusBadge } from "../ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { LoadingState, ErrorState } from "@/components/aurex-primitives";

const ROLES = ["STRATEGIC", "EXECUTION", "FALLBACK"] as const;

type FormState = { name: string; base_url: string; api_key: string; model: string; role: string; is_primary: boolean };

const EMPTY: FormState = { name: "", base_url: "", api_key: "", model: "", role: "EXECUTION", is_primary: false };

export function AdminProviders() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminProviderRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const { data, error, loading } = useAsync(() => adminProviders(), [refreshKey]);

  const openCreate = () => { setForm(EMPTY); setCreating(true); };
  const openEdit = (p: AdminProviderRow) => {
    setEditing(p);
    setForm({ name: p.name, base_url: p.base_url, api_key: "", model: p.model, role: p.role, is_primary: p.is_primary });
  };

  const save = async () => {
    if (form.name.length < 1 || form.base_url.length < 5 || form.model.length < 1) {
      toast.error("Nama, base_url, model wajib diisi"); return;
    }
    if (!editing && form.api_key.length < 8) { toast.error("API key min 8 karakter"); return; }
    setBusy(true);
    try {
      if (editing) {
        const body: Record<string, string | boolean> = { name: form.name, base_url: form.base_url, model: form.model, role: form.role, is_primary: form.is_primary };
        if (form.api_key) body.api_key = form.api_key;
        await adminProviderUpdate(editing.id, body);
        toast.success("Provider diperbarui");
      } else {
        await adminProviderCreate({ name: form.name, base_url: form.base_url, api_key: form.api_key, model: form.model, role: form.role, is_primary: form.is_primary });
        toast.success("Provider dibuat");
      }
      setCreating(false); setEditing(null); setRefreshKey((k) => k + 1);
    } catch (e) { toast.error(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  const remove = async (p: AdminProviderRow) => {
    try { await adminProviderDelete(p.id); toast.success("Provider dihapus"); setRefreshKey((k) => k + 1); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
  };

  const test = async (p: AdminProviderRow) => {
    setTestingId(p.id);
    try { const r = await adminProviderTest(p.id); toast[r.ok ? "success" : "error"](r.message); if (r.ok) setRefreshKey((k) => k + 1); }
    catch (e) { toast.error(String((e as Error)?.message ?? e)); }
    finally { setTestingId(null); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>AI Providers</CardTitle>
          <CardDescription>CRUD provider/model, API key terenkripsi, test connection, routing role.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between">
            <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Tambah provider</Button>
            <Button variant="outline" size="icon" onClick={() => setRefreshKey((k) => k + 1)} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          </div>

          {loading ? <LoadingState rows={3} /> : error ? <ErrorState message={error} onRetry={() => setRefreshKey((k) => k + 1)} /> : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead>Model</TableHead><TableHead>Role</TableHead><TableHead>Primary</TableHead>
                    <TableHead>Status</TableHead><TableHead>Key</TableHead><TableHead>Health</TableHead><TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.providers.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Belum ada provider.</TableCell></TableRow>}
                  {data?.providers.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.model}</TableCell>
                      <TableCell><Badge variant="outline">{p.role}</Badge></TableCell>
                      <TableCell>{p.is_primary ? <Badge variant="default">primary</Badge> : "—"}</TableCell>
                      <TableCell><StatusBadge value={p.status} /></TableCell>
                      <TableCell>{p.api_key_set ? <Badge variant="secondary"><KeyRound className="h-3 w-3" /> tersimpan</Badge> : <Badge variant="destructive">kosong</Badge>}</TableCell>
                      <TableCell>
                        {p.last_health_ok == null ? <span className="text-muted-foreground text-xs">belum</span> : (
                          <div className="flex flex-col">
                            <StatusBadge value={p.last_health_ok ? "OK" : "GAGAL"} />
                            <span className="text-xs text-muted-foreground mt-0.5">{p.last_health_message ?? ""}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title="Test connection" onClick={() => test(p)} disabled={testingId === p.id}>
                            {testingId === p.id ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" title="Hapus" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader><AlertDialogTitle>Hapus provider?</AlertDialogTitle>
                                <AlertDialogDescription>{p.name} ({p.model}) akan dihapus. Pastikan ada fallback.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Batal</AlertDialogCancel>
                                <AlertDialogAction onClick={() => remove(p)} className="bg-destructive text-destructive-foreground">Hapus</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit dialog */}
      <Dialog open={creating || !!editing} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Provider" : "Tambah Provider"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Nama provider</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. GLM Kimi" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Base URL (OpenAI-compatible)</label>
              <Input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.openai.com/v1" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">API Key {editing && <span className="text-muted-foreground/60">(kosongkan = biarkan)</span>}</label>
              <Input value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder={editing ? "••••••" : "sk-…"} type="password" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Model</label>
              <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="glm-5.2" className="font-mono text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Routing role</label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Primary untuk role ini?</label>
                <Select value={form.is_primary ? "yes" : "no"} onValueChange={(v) => setForm({ ...form, is_primary: v === "yes" })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="no">Tidak</SelectItem><SelectItem value="yes">Ya</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreating(false); setEditing(null); }}><X className="h-4 w-4" /> Batal</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
