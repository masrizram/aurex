// AUREX CommandMenu — adapted from shadcn-admin command-menu.tsx (MIT © 2024 Sat Naing)
// §27 master prompt: navigasi + pencarian entity + aksi domain-legal.
// Entity search memakai endpoint list yang SUDAH ada (tanpa endpoint baru);
// aksi = navigasi ke inbox/failed missions, BUKAN bypass FSM.
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ChevronRight, Laptop, Moon, Sun } from 'lucide-react'
import { useSearch } from '@/context/search-provider'
import { useTheme } from '@/context/theme-provider'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { sidebarData } from '@/components/layout/data/sidebar-data'
import { ScrollArea } from '@/components/ui/scroll-area'
import { listObjectives } from '@/api'

type ObjectiveLite = { id: string; title: string; state?: string }

export function CommandMenu() {
  const navigate = useNavigate()
  const { setTheme } = useTheme()
  const { open, setOpen } = useSearch()
  // §35: fetch hanya saat palette dibuka, sekali per sesi palette
  const [objectives, setObjectives] = React.useState<ObjectiveLite[]>([])
  const loadedRef = React.useRef(false)

  React.useEffect(() => {
    if (!open || loadedRef.current) return
    loadedRef.current = true
    let alive = true
    listObjectives()
      .then((res) => {
        if (!alive) return
        setObjectives(
          (res ?? []).map((o) => ({
            id: o.id,
            title: String(o.title ?? 'Objective'),
            state: typeof o.stage === 'string' ? o.stage : undefined,
          })),
        )
      })
      .catch(() => {
        /* palette tetap berfungsi untuk navigasi bila data gagal dimuat */
      })
    return () => {
      alive = false
    }
  }, [open])

  const runCommand = React.useCallback(
    (command: () => unknown) => {
      setOpen(false)
      command()
    },
    [setOpen]
  )

  return (
    <CommandDialog modal open={open} onOpenChange={setOpen}>
      <CommandInput placeholder='Type a command or search...' />
      <CommandList>
        <ScrollArea type='hover' className='h-72 pe-1'>
          <CommandEmpty>No results found.</CommandEmpty>
          {objectives.length > 0 && (
            <>
              <CommandGroup heading='Objectives'>
                {objectives.slice(0, 8).map((o) => (
                  <CommandItem
                    key={o.id}
                    value={`objective ${o.title}`}
                    onSelect={() => runCommand(() => navigate(`/app/objectives/${o.id}`))}
                  >
                    <ChevronRight className='me-2' />
                    {o.title}
                    <ArrowRight className='ms-auto' />
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}
          {sidebarData.navGroups.map((group) => (
            <CommandGroup key={group.title} heading={group.title}>
              {group.items.map((navItem, i) => {
                if (navItem.url)
                  return (
                    <CommandItem
                      key={`${navItem.url}-${i}`}
                      value={navItem.title}
                      onSelect={() => runCommand(() => navigate(navItem.url))}
                    >
                      <ChevronRight className='me-2' />
                      {navItem.title}
                      <ArrowRight className='ms-auto' />
                    </CommandItem>
                  )
                return (
                  <React.Fragment key={`${navItem.title}-${i}`}>
                    {navItem.items?.map((sub) => (
                      <CommandItem
                        key={`${sub.url}-${i}`}
                        value={sub.title}
                        onSelect={() => runCommand(() => navigate(sub.url))}
                      >
                        <ChevronRight className='me-2' />
                        {sub.title}
                        <ArrowRight className='ms-auto' />
                      </CommandItem>
                    ))}
                  </React.Fragment>
                )
              })}
            </CommandGroup>
          ))}
          <CommandSeparator />
          {/* §27: aksi cepat menuju antrean keputusan — tetap lewat halaman
              resmi (authZ + FSM server-side), bukan shortcut yang mem-bypass. */}
          <CommandGroup heading='Aksi cepat'>
            <CommandItem onSelect={() => runCommand(() => navigate('/app/approvals'))}>
              <ChevronRight className='me-2' />
              Buka persetujuan menunggu
              <ArrowRight className='ms-auto' />
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => navigate('/app/economics'))}>
              <ChevronRight className='me-2' />
              Lihat ekonomi
              <ArrowRight className='ms-auto' />
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading='Theme'>
            <CommandItem onSelect={() => runCommand(() => setTheme('light'))}>
              <Sun className='me-2' /> Light
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme('dark'))}>
              <Moon className='me-2' /> Dark
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme('system'))}>
              <Laptop className='me-2' /> System
            </CommandItem>
          </CommandGroup>
        </ScrollArea>
      </CommandList>
    </CommandDialog>
  )
}
