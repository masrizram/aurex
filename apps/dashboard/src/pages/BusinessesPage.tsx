import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Building2 } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { ProfileDropdown } from "@/components/profile-dropdown";
import { Search } from "@/components/search";
import { ThemeSwitch } from "@/components/theme-switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState, StatusBadge } from "@/components/aurex-primitives";
import { useAsync } from "@/hooks/use-async";
import { listObjectives, type ObjectiveListItem } from "@/api";
import { useSession } from "@/lib/session";

// ═════════════════════════════════════════════════════════════════
// P8 — Businesses (§13): card/list composition dari objectives
// (bisnis = business venture pada objective; satu venture → banyak obj).
// ═════════════════════════════════════════════════════════════════

type Business = {
  name: string;
  industry: string | null;
  objectives: ObjectiveListItem[];
  activeCount: number;
};

export function BusinessesPage() {
  const session = useSession();
  const { data: objectives, error, loading, reload } = useAsync(listObjectives);

  const businesses = useMemo<Business[]>(() => {
    const map = new Map<string, Business>();
    for (const o of objectives ?? []) {
      const key = o.business_name || o.industry || "Lainnya";
      if (!map.has(key)) {
        map.set(key, {
          name: key,
          industry: o.industry,
          objectives: [],
          activeCount: 0,
        });
      }
      const b = map.get(key)!;
      b.objectives.push(o);
      if (!["STOPPED", "ACHIEVED"].includes(o.status)) b.activeCount += 1;
    }
    return Array.from(map.values());
  }, [objectives]);

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
        <div className='mb-6 flex w-full flex-wrap items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold tracking-tight'>Businesses</h1>
            <p className='text-sm text-muted-foreground'>
              Semua bisnis dalam {session?.orgName ?? "organisasi Anda"}.
            </p>
          </div>
        </div>

        {loading ? (
          <LoadingState rows={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : businesses.length === 0 ? (
          <EmptyState
            title='Belum ada bisnis'
            description='Bisnis Anda akan muncul di sini setelah onboarding atau objective pertama dibuat.'
            action={<Button asChild><Link to='/onboarding'>Mulai Onboarding</Link></Button>}
          />
        ) : (
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
            {businesses.map((b) => (
              <Card key={b.name} className='transition-shadow hover:shadow-md'>
                <CardHeader>
                  <div className='flex items-start justify-between gap-2'>
                    <div className='flex items-center gap-2'>
                      <span className='grid size-9 place-items-center rounded-lg bg-muted'>
                        <Building2 className='size-4 text-muted-foreground' aria-hidden='true' />
                      </span>
                      <div>
                        <CardTitle className='text-base'>{b.name}</CardTitle>
                        <p className='text-xs text-muted-foreground'>{b.industry ?? "—"}</p>
                      </div>
                    </div>
                    <Badge variant='outline'>{b.activeCount} aktif</Badge>
                  </div>
                </CardHeader>
                <CardContent className='space-y-3'>
                  <ul className='space-y-2'>
                    {b.objectives.slice(0, 3).map((o) => (
                      <li key={o.id}>
                        <Link
                          to={`/app/objectives/${o.id}`}
                          className='flex items-center justify-between gap-2 rounded-md border p-2.5 text-sm transition-colors hover:bg-accent'
                        >
                          <span className='flex min-w-0 flex-col'>
                            <span className='truncate font-medium'>{o.title}</span>
                            <StatusBadge stage={o.status} />
                          </span>
                          <ArrowUpRight className='size-4 shrink-0 text-muted-foreground' aria-hidden='true' />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {b.objectives.length > 3 && (
                    <Button asChild variant='ghost' size='sm' className='w-full'>
                      <Link to='/app/objectives'>Lihat semua ({b.objectives.length})</Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Main>
    </>
  );
}
