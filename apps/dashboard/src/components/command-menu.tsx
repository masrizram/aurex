// AUREX CommandMenu — adapted from shadcn-admin command-menu.tsx (MIT © 2024 Sat Naing)
// Navigates AUREX entities; theme switching like upstream.
import React from 'react'
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

export function CommandMenu() {
  const navigate = useNavigate()
  const { setTheme } = useTheme()
  const { open, setOpen } = useSearch()

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
