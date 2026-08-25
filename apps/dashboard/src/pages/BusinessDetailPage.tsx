import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { ProfileDropdown } from "@/components/profile-dropdown";
import { Search } from "@/components/search";
import { ThemeSwitch } from "@/components/theme-switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState, ErrorState, LoadingState, StatusBadge,
  fmtRp,
} from "@/components/aurex-primitives";
import { listVentures, listObjectives } from "@/api";
import { useAsync } from "@/hooks/use-async";
import { useSession } from "@/lib/session";

// ═════════════════════════════════════════════════════════════════
// P11 — Business Detail (§14): PageHeader + summary cards + tabs.
// Hierarchy: Organization → Business → Objective.
// ═════════════════════════════════════════════════════════════════

export function BusinessDetailPage() {
  const { businessId } = useParams<{ businessId: string }>();
  const session = useSession();
  const { data: ventures, loading, error, reload } = useAsync(listVentures, []);
  const business = ventures?.ventures?.find((v) => v.id === businessId);

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
        <Button asChild variant='ghost' size='sm' className='mb-4 -ms-2'>
          <Link to='/app/businesses'><ArrowLeft /> Semua bisnis</Link>
        </Button>

        {loading ? (
          <div className='space-y-4'>
            <Skeleton className='h-10 w-1/2' />
            <Skeleton className='h-24 w-full' />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !business ? (
          <EmptyState title='Bisnis tidak ditemukan' description='Bisnis ini mungkin sudah diarsipkan.' />
        ) : (
          <>
            <div className='mb-6 space-y-4'>
              <div>
                <h1 className='text-2xl font-semibold tracking-tight'>{business.name}</h1>
                <div className='mt-2 flex flex-wrap items-center gap-2'>
                  <Badge variant='outline'>{business.industry ?? "—"}</Badge>
                  {(business.origin === "KIMI_DISCOVERED") && (
                    <Badge variant='secondary'>Ditemukan AUREX</Badge>
                  )}
                </div>
              </div>

              <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                <Card>
                  <CardHeader className='pb-2'>
                    <CardDescription className='text-xs'>Objectives</CardDescription>
                    <CardTitle className='text-xl tabular-nums'>{business.objective_count ?? 0}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className='pb-2'>
                    <CardDescription className='text-xs'>Model bisnis</CardDescription>
                    <CardTitle className='text-sm font-medium'>{business.business_model ?? "—"}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className='pb-2'>
                    <CardDescription className='text-xs'>Target customer</CardDescription>
                    <CardTitle className='text-sm font-medium'>{business.target_customer ?? "—"}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className='pb-2'>
                    <CardDescription className='text-xs'>Market</CardDescription>
                    <CardTitle className='text-sm font-medium'>{business.market ?? "—"}</CardTitle>
                  </CardHeader>
                </Card>
              </div>
            </div>

            <Tabs defaultValue='overview'>
              <TabsList className='mb-4 flex-wrap'>
                <TabsTrigger value='overview'>Overview</TabsTrigger>
                <TabsTrigger value='objectives'>Objectives</TabsTrigger>
                <TabsTrigger value='economics'>Economics</TabsTrigger>
                <TabsTrigger value='activity'>Activity</TabsTrigger>
              </TabsList>

              <TabsContent value='overview'>
                <div className='grid gap-4 lg:grid-cols-2'>
                  <Card>
                    <CardHeader><CardTitle className='text-base'>Problem</CardTitle></CardHeader>
                    <CardContent><p className='text-sm'>{business.problem ?? "—"}</p></CardContent>
                  </Card>
                  <Card>
                    <CardHeader><CardTitle className='text-base'>Solution</CardTitle></CardHeader>
                    <CardContent><p className='text-sm'>{business.solution ?? "—"}</p></CardContent>
                  </Card>
                  <Card className='lg:col-span-2'>
                    <CardHeader><CardTitle className='text-base'>Model bisnis</CardTitle></CardHeader>
                    <CardContent><p className='text-sm'>{business.business_model ?? "—"}</p></CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value='objectives'>
                <BusinessObjectives businessId={businessId!} />
              </TabsContent>
              <TabsContent value='economics'>
                <BusinessEconomics businessId={businessId!} />
              </TabsContent>
              <TabsContent value='activity'>
                <p className='text-sm text-muted-foreground'>
                  Aktivitas per-bisnis tersedia pada halaman Activity global (filter per objective).
                </p>
              </TabsContent>
            </Tabs>
          </>
        )}
      </Main>
    </>
  );
}

function BusinessObjectives({ businessId }: { businessId: string }) {
  // Objectives list diambil dari listObjectives lalu difilter client-side
  // (endpoint /objectives sudah join business_name).
  const { data: objectives, loading, error, reload } = useAsync(listObjectives, [businessId]);
  const items = (objectives ?? []).filter(
    (o: any) => o.business_venture_id === businessId || o.business?.id === businessId
  );
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (items.length === 0)
    return (
      <EmptyState
        title='Belum ada objective'
        description='Buat objective ekonomi pertama untuk bisnis ini.'
      />
    );
  return (
    <div className='space-y-3'>
      {items.map((o: any) => (
        <Card key={o.id}>
          <CardHeader>
            <div className='flex items-start justify-between gap-2'>
              <CardTitle className='text-base'>
                <Link to={`/app/objectives/${o.id}`} className='hover:underline'>{o.title}</Link>
              </CardTitle>
              <StatusBadge stage={o.state ?? o.status ?? ""} />
            </div>
          </CardHeader>
          <CardContent>
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <span className='tabular-nums'>{fmtRp(o.target_profit ?? null)}</span>
              <span>target</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function BusinessEconomics(_props: { businessId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>Ekonomi bisnis</CardTitle>
        <CardDescription>Snapshot ekonomi teragregasi per-bisnis akan tersedia bersama objective aktif pertama.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className='text-sm text-muted-foreground'>
          Setiap objective menyimpan snapshot ekonominya sendiri (revenue, operating profit, ROI).
          Lihat tab Economics pada detail objective.
        </p>
      </CardContent>
    </Card>
  );
}
