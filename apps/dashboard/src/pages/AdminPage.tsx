import { Link } from "react-router-dom";
import { ArrowLeft, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ThemeSwitch } from "@/components/theme-switch";
import { LoadingState, ErrorState, fmtNum } from '@/components/aurex-primitives';
import { adminOverview, adminUsers, adminOrgs, adminObjectives } from "@/api";
import { useAsync } from "@/hooks/use-async";


// ═════════════════════════════════════════════════════════════════
// P19 — Internal Admin (§33): technical surface. Same design system.
// Data teknis (model runs, providers, latency) diizinkan di sini.
// Guard: App.tsx hanya merender bila session.isAdmin.
// ═════════════════════════════════════════════════════════════════

export function AdminPage({ onLogout }: { onLogout: () => void }) {
  const { data: overview, error: oErr, loading: oLoad, reload: oReload } = useAsync(adminOverview, []);
  const { data: users } = useAsync(adminUsers, []);
  const { data: orgs } = useAsync(adminOrgs, []);
  const { data: objectives } = useAsync(adminObjectives, []);

  const stateCounts = overview?.objectives ?? [];

  return (
    <div className='min-h-svh bg-background'>
      <header className='sticky top-0 z-50 flex h-16 items-center gap-3 border-b bg-background px-4'>
        <Button asChild variant='ghost' size='sm'>
          <Link to='/app'><ArrowLeft /> Kembali ke app</Link>
        </Button>
        <h1 className='text-sm font-semibold'>AUREX Admin</h1>
        <Badge variant='outline' className='border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'>
          Internal
        </Badge>
        <div className='ml-auto flex items-center gap-2'>
          <ThemeSwitch />
          <Button variant='ghost' size='sm' onClick={onLogout}>
            <LogOut /> Sign out
          </Button>
        </div>
      </header>
      <main className='mx-auto w-full max-w-7xl space-y-6 px-4 py-6'>
        {/* KPI */}
        {oLoad ? (
          <LoadingState rows={2} />
        ) : oErr ? (
          <ErrorState message={oErr} onRetry={oReload} />
        ) : (
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            <Card>
              <CardHeader className='pb-2'>
                <CardDescription>Total Users</CardDescription>
                <CardTitle className='text-2xl tabular-nums'>{fmtNum(overview?.users)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className='pb-2'>
                <CardDescription>Organizations</CardDescription>
                <CardTitle className='text-2xl tabular-nums'>{fmtNum(overview?.orgs)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className='pb-2'>
                <CardDescription>Total Objectives</CardDescription>
                <CardTitle className='text-2xl tabular-nums'>{fmtNum(stateCounts.reduce((a, s) => a + s.count, 0))}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className='pb-2'>
                <CardDescription>Active States</CardDescription>
                <CardTitle className='text-2xl tabular-nums'>{fmtNum(stateCounts.length)}</CardTitle>
              </CardHeader>
            </Card>
            <Card className='sm:col-span-2 lg:col-span-4'>
              <CardHeader>
                <CardTitle className='text-base'>Objectives by State</CardTitle>
                <CardDescription>Raw FSM states — admin only.</CardDescription>
              </CardHeader>
              <CardContent>
                {stateCounts.length === 0 ? (
                  <p className='text-sm text-muted-foreground'>Tidak ada data.</p>
                ) : (
                  <div className='flex flex-wrap gap-2'>
                    {stateCounts.map((s) => (
                      <Badge key={s.state} variant='outline' className='font-mono'>
                        {s.state}: {s.count}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Users table */}
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Users</CardTitle>
            <CardDescription>{users?.users.length ?? 0} terdaftar.</CardDescription>
          </CardHeader>
          <CardContent>
            {!users || users.users.length === 0 ? (
              <p className='text-sm text-muted-foreground'>Tidak ada user.</p>
            ) : (
              <div className='overflow-x-auto rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Nama</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Admin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.users.slice(0, 50).map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className='font-medium'>{u.email}</TableCell>
                        <TableCell>{u.name ?? '—'}</TableCell>
                        <TableCell><Badge variant='outline'>{u.role}</Badge></TableCell>
                        <TableCell>{u.status}</TableCell>
                        <TableCell>{u.is_admin ? <Badge variant='destructive'>admin</Badge> : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Orgs table */}
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Organizations</CardTitle>
            <CardDescription>{orgs?.orgs.length ?? 0} organisasi.</CardDescription>
          </CardHeader>
          <CardContent>
            {!orgs || orgs.orgs.length === 0 ? (
              <p className='text-sm text-muted-foreground'>Tidak ada org.</p>
            ) : (
              <div className='overflow-x-auto rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama</TableHead>
                      <TableHead>Slug</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Members</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orgs.orgs.slice(0, 50).map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className='font-medium'>{o.name}</TableCell>
                        <TableCell className='font-mono text-xs'>{o.slug}</TableCell>
                        <TableCell><Badge variant='outline'>{o.plan_tier}</Badge></TableCell>
                        <TableCell className='tabular-nums'>{o.member_count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Objectives table */}
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Objectives</CardTitle>
            <CardDescription>{objectives?.objectives.length ?? 0} objective (raw state).</CardDescription>
          </CardHeader>
          <CardContent>
            {!objectives || objectives.objectives.length === 0 ? (
              <p className='text-sm text-muted-foreground'>Tidak ada objective.</p>
            ) : (
              <div className='overflow-x-auto rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Business</TableHead>
                      <TableHead>State (raw)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {objectives.objectives.slice(0, 50).map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className='font-medium'>{o.title}</TableCell>
                        <TableCell>{o.business_name ?? '—'}</TableCell>
                        <TableCell><Badge variant='outline' className='font-mono'>{o.state}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
