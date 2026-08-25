import * as React from "react";
import { Link } from "react-router-dom";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { ProfileDropdown } from "@/components/profile-dropdown";
import { Search } from "@/components/search";
import { ThemeSwitch } from "@/components/theme-switch";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "@/components/data-table/pagination";
import { DataTableToolbar } from "@/components/data-table/toolbar";
import { MoreHorizontal } from "lucide-react";
import { EmptyState, ErrorState, LoadingState, StatusBadge, phaseLabel } from "@/components/aurex-primitives";
import { listObjectives, createObjective, parseApiError, type ObjectiveListItem } from "@/api";
import { useSession } from "@/lib/session";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAsync } from "@/hooks/use-async";

// ═════════════════════════════════════════════════════════════════
// P9 — Objectives (§15): shadcn-admin data-table architecture.
// Search + filter status + sorting + pagination + row actions.
// ═════════════════════════════════════════════════════════════════

export function ObjectivesPage() {
  const session = useSession();
  const { data, error, loading, reload } = useAsync(listObjectives);
  const objectives = data ?? [];

  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});
  const [createOpen, setCreateOpen] = React.useState(false);

  const columns = React.useMemo<ColumnDef<ObjectiveListItem>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label='Select all'
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label='Select row'
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: "title",
        header: "Objective",
        cell: ({ row }) => (
          <Link
            to={`/app/objectives/${row.original.id}`}
            className='font-medium underline-offset-4 hover:underline'
          >
            {row.original.title}
          </Link>
        ),
      },
      {
        accessorKey: "business_name",
        header: "Business",
        cell: ({ row }) => row.original.business_name ?? "—",
      },
      {
        accessorKey: "industry",
        header: "Baseline",
        cell: ({ row }) => row.original.industry ?? "—",
      },
      {
        accessorKey: "progress",
        header: "Progress",
        cell: ({ row }) => <span className='tabular-nums'>{row.original.progress}%</span>,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge stage={row.original.status} />,
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
      },
      {
        accessorKey: "recommendation",
        header: () => null,
        cell: () => null,
        enableHiding: true,
      },
      {
        id: "actions",
        header: () => null,
        cell: ({ row }) => (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label='Open menu'
                variant='ghost'
                className='data-[state=open]:bg-muted flex size-8'
              >
                <MoreHorizontal className='size-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-40'>
              <DropdownMenuItem asChild>
                <Link to={`/app/objectives/${row.original.id}`}>Buka detail</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant='destructive'
                onClick={() => {
                  toast.info("Gunakan detail objective untuk menghentikan siklus.");
                }}
              >
                Hentikan
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: objectives,
    columns,
    state: { sorting, columnFilters, columnVisibility, rowSelection },
    getRowId: (row) => row.id,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

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
            <h1 className='text-2xl font-semibold tracking-tight'>Objectives</h1>
            <p className='text-sm text-muted-foreground'>
              Semua objective ekonomi organisasi Anda.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> Create Objective
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Daftar Objective</CardTitle>
            <CardDescription>
              {objectives.length} objective · {table.getFilteredRowModel().rows.length} tampil
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingState rows={4} />
            ) : error ? (
              <ErrorState message={error} onRetry={reload} />
            ) : objectives.length === 0 ? (
              <EmptyState
                title='Belum ada objective'
                description='Buat objective ekonomi pertama Anda untuk mulai menemukan peluang.'
                action={<Button onClick={() => setCreateOpen(true)}>Create Objective</Button>}
              />
            ) : (
              <div className='space-y-4'>
                <DataTableToolbar
                  table={table}
                  searchPlaceholder='Cari objective…'
                  searchKey='title'
                  filters={[
                    {
                      columnId: "status",
                      title: "Status",
                      options: uniqueStatuses(objectives).map((s) => ({
                        label: phaseLabel(s),
                        value: s,
                      })),
                    },
                  ]}
                />
                <div className='overflow-hidden rounded-md border'>
                  <Table>
                    <TableHeader>
                      {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id} className='hover:bg-transparent'>
                          {headerGroup.headers.map((header) => (
                            <TableHead key={header.id}>
                              {header.isPlaceholder
                                ? null
                                : flexRender(header.column.columnDef.header, header.getContext())}
                            </TableHead>
                          ))}
                        </TableRow>
                      ))}
                    </TableHeader>
                    <TableBody>
                      {table.getRowModel().rows?.length ? (
                        table.getRowModel().rows.map((row) => (
                          <TableRow
                            key={row.id}
                            data-state={row.getIsSelected() && "selected"}
                          >
                            {row.getVisibleCells().map((cell) => (
                              <TableCell key={cell.id}>
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={columns.length} className='h-24 text-center'>
                            Tidak ada hasil.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <DataTablePagination table={table} />
              </div>
            )}
          </CardContent>
        </Card>
      </Main>
      <CreateObjectiveDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={reload} />
    </>
  );
}

function uniqueStatuses(objs: ObjectiveListItem[]): string[] {
  return Array.from(new Set(objs.map((o) => o.status).filter(Boolean)));
}

function CreateObjectiveDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [industry, setIndustry] = React.useState("");
  const [businessName, setBusinessName] = React.useState("");
  const [target, setTarget] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await createObjective({
        title,
        industry: industry || undefined,
        business_mode: businessName ? "KNOWN" : "DISCOVERY",
        business: businessName ? { name: businessName, industry: industry || "General" } : undefined,
        economics: target ? { revenue_target: Number(target) } : undefined,
      });
      toast.success("Objective dibuat.");
      onOpenChange(false);
      setTitle(""); setIndustry(""); setBusinessName(""); setTarget("");
      onCreated();
    } catch (e2) {
      setErr(parseApiError(e2));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Create Objective</DialogTitle>
          <DialogDescription>
            Objective = tujuan ekonomi yang AUREX kejar untuk Anda.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className='grid gap-4'>
          {err && <p className='text-sm text-destructive' role='alert'>{err}</p>}
          <div className='grid gap-2'>
            <Label htmlFor='obj-title'>Judul</Label>
            <Input id='obj-title' value={title} onChange={(e) => setTitle(e.target.value)} required placeholder='Naikkan profit bulanan ke Rp20jt' />
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='obj-industry'>Industri</Label>
            <Input id='obj-industry' value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder='Retail' />
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='obj-biz'>Bisnis (opsional)</Label>
            <Input id='obj-biz' value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder='ABC Commerce' />
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='obj-target'>Target revenue (Rp)</Label>
            <Input id='obj-target' inputMode='numeric' value={target} onChange={(e) => setTarget(e.target.value)} placeholder='20000000' />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>Batal</Button>
            <Button type='submit' disabled={saving}>{saving ? "Menyimpan…" : "Buat"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
