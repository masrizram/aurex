// AUREX TopNav — adapted from shadcn-admin top-nav.tsx (MIT © 2024 Sat Naing)
import { Link } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type TopNavProps = React.HTMLAttributes<HTMLElement> & {
  links: {
    title: string
    href: string
    isActive: boolean
    disabled?: boolean
  }[]
}

export function TopNav({ className, links, ...props }: TopNavProps) {
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            size='icon'
            variant='outline'
            className={cn('md:size-7 lg:hidden', className)}
            {...props}
          >
            <Menu className='size-4' />
            <span className='sr-only'>Toggle menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start' className='w-48 overflow-y-auto'>
          {links.map((link) => (
            <DropdownMenuItem key={link.title} asChild>
              <Link to={link.href} className='flex items-center gap-2'>
                {link.title}{' '}
                {link.isActive && (
                  <span className='ms-auto text-muted-foreground'>•</span>
                )}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <nav
        className='hidden gap-4 md:flex'
        {...props}
        aria-label='Section navigation'
      >
        {links.map((link) => (
          <Link
            key={link.title}
            to={link.href}
            className={cn(
              'text-sm font-medium text-muted-foreground transition-colors hover:text-primary',
              link.isActive && 'text-primary',
              link.disabled && 'cursor-not-allowed opacity-40 hover:text-muted-foreground'
            )}
            aria-disabled={link.disabled}
          >
            {link.title}
          </Link>
        ))}
      </nav>
    </>
  )
}
