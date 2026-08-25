// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).
import { Link } from "react-router-dom";
import { Header } from "@/components/layout/header";
import { ProfileDropdown } from "@/components/profile-dropdown";
import { Search } from "@/components/search";
import { ThemeSwitch } from "@/components/theme-switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/aurex-primitives";
import type { ObjectiveListItem } from "@/api";
import { useSession } from "@/lib/session";

/** Chrome halaman siklus bersama — dipakai semua halaman domain. */
// ── Shared page chrome ────────────────────────────────────────────────────────
export function LoopHeader() {
  const session = useSession();
  return (
    <Header>
      <div className='flex flex-row gap-2'>
        <Search />
        <div className='ml-auto flex items-center gap-2 space-x-1'>
          <ThemeSwitch />
          <ProfileDropdown session={session} />
        </div>
      </div>
    </Header>
  );
}

export function ObjectivePicker({
  objectives, value, onChange,
}: {
  objectives: ObjectiveListItem[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger className='w-full sm:w-72' aria-label='Pilih objective'>
        <SelectValue placeholder='Pilih objective…' />
      </SelectTrigger>
      <SelectContent>
        {objectives.map((o) => (
          <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function NoObjectiveState() {
  return (
    <EmptyState
      title='Belum ada objective'
      description='Pilih objective untuk melihat entitas ini. Objective dibuat lewat onboarding atau halaman Objectives.'
      action={<Button asChild><Link to='/app/objectives'>Ke Objectives</Link></Button>}
    />
  );
}

