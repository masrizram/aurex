// AUREX AppSidebar — adapted from shadcn-admin app-sidebar.tsx (MIT © 2024 Sat Naing)
// Team switcher shows org context; nav groups from AUREX sidebar data.
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import { TeamSwitcher } from './team-switcher'
import type { Session } from '@/lib/session'

type AppSidebarProps = {
  session: Session | null
}

export function AppSidebar({ session }: AppSidebarProps) {
  const { collapsible, variant } = useLayout()
  const user = {
    name: session?.email?.split('@')[0] ?? 'user',
    email: session?.email ?? '',
    avatar: '',
  }
  const teams = [
    {
      name: session?.orgName ?? 'AUREX',
      logo: sidebarData.teams[0]?.logo ?? (() => null),
      plan: session?.planTier ? planLabel(session.planTier) : 'AUREX',
    },
  ]
  // Admin group only for admins
  const navGroups = session?.isAdmin
    ? sidebarData.navGroups
    : sidebarData.navGroups.filter((g) => g.title !== 'Internal')
  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <TeamSwitcher teams={teams} />
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function planLabel(tier: string): string {
  const t = tier.toUpperCase()
  if (t === 'FREE') return 'Free Plan'
  if (t === 'STARTER') return 'Starter Plan'
  if (t === 'GROWTH') return 'Growth Plan'
  if (t === 'ENTERPRISE') return 'Enterprise Plan'
  return tier
}
