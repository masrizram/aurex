// AUREX sidebar data — customer mental model (canonical flow), NOT backend FSM.
// Adapted from shadcn-admin sidebar-data.ts (MIT © 2024 Sat Naing).
// No KIMI/GLM/pg-boss/model-runs in customer navigation (admin only).
import {
  LayoutDashboard,
  Building2,
  Target,
  Lightbulb,
  FlaskConical,
  Rocket,
  ClipboardCheck,
  BarChart3,
  TrendingUp,
  Activity,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'AUREX',
    email: '',
    avatar: '',
  },
  teams: [
    {
      name: 'AUREX',
      logo: TrendingUp,
      plan: 'Economic Control Center',
    },
  ],
  navGroups: [
    {
      title: 'Control Center',
      items: [
        {
          title: 'Overview',
          url: '/app',
          icon: LayoutDashboard,
        },
      ],
    },
    {
      title: 'Business',
      items: [
        {
          title: 'Businesses',
          url: '/app/businesses',
          icon: Building2,
        },
        {
          title: 'Objectives',
          url: '/app/objectives',
          icon: Target,
        },
      ],
    },
    {
      title: 'Intelligence',
      items: [
        {
          title: 'Opportunities',
          url: '/app/opportunities',
          icon: Lightbulb,
        },
        {
          title: 'Experiments',
          url: '/app/experiments',
          icon: FlaskConical,
        },
      ],
    },
    {
      title: 'Execution',
      items: [
        {
          title: 'Missions',
          url: '/app/missions',
          icon: Rocket,
        },
        {
          title: 'Approvals',
          url: '/app/approvals',
          icon: ClipboardCheck,
        },
      ],
    },
    {
      title: 'Performance',
      items: [
        {
          title: 'Results',
          url: '/app/results',
          icon: BarChart3,
        },
        {
          title: 'Economics',
          url: '/app/economics',
          icon: TrendingUp,
        },
      ],
    },
    {
      title: 'System',
      items: [
        {
          title: 'Activity',
          url: '/app/activity',
          icon: Activity,
        },
        {
          title: 'Settings',
          url: '/app/settings',
          icon: Settings,
        },
      ],
    },
    {
      title: 'Internal',
      items: [
        {
          title: 'Admin',
          url: '/admin',
          icon: ShieldCheck,
        },
      ],
    },
  ],
}
