// AUREX admin — AdminLayout: shared design language dengan user dashboard.
// Membungkus AuthenticatedLayout yang sama (SidebarProvider + sidebar dengan
// group "Admin Control Center") sehingga admin melihat chrome identik dengan
// user app. Hanya untuk session.isAdmin (guard internal → redirect /app).
import { Outlet, useLocation, Link, Navigate } from "react-router-dom";
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { Badge } from "@/components/ui/badge";
import type { Session } from "@/lib/session";

const TITLES: Record<string, string> = {
  "/admin": "Overview",
  "/admin/users": "Users",
  "/admin/orgs": "Organizations",
  "/admin/objectives": "Objectives",
  "/admin/approvals": "Approvals",
  "/admin/missions": "Missions",
  "/admin/billing": "Billing",
  "/admin/providers": "AI Providers",
  "/admin/economics": "Economics",
  "/admin/system": "System",
  "/admin/audit": "Audit Log",
};

export function AdminLayout({ session }: { session: Session | null }) {
  if (!session?.isAdmin) return <Navigate to="/app" replace />;
  return (
    <AuthenticatedLayout session={session}>
      <AdminChrome />
    </AuthenticatedLayout>
  );
}

function AdminChrome() {
  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? "Admin";

  return (
    <>
      <Header>
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">{title}</h1>
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            Internal · Admin
          </Badge>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Link to="/app" className="hover:text-foreground">Kembali ke app</Link>
        </div>
      </Header>
      <Main>
        <Outlet />
      </Main>
    </>
  );
}
