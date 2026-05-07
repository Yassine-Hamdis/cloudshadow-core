import { NavLink }   from 'react-router-dom'
import useAuthStore  from '../../store/authStore'
import {
  LayoutDashboard,
  Server,
  BarChart2,
  Bell,
  Users,
  Activity,
} from 'lucide-react'

const NAV_ITEMS = [
  {
    label: 'Overview',
    to:    '/dashboard',
    icon:  LayoutDashboard,
    roles: ['ADMIN', 'USER'],
    end:   true,
  },
  {
    label: 'Servers',
    to:    '/dashboard/servers',
    icon:  Server,
    roles: ['ADMIN'],
  },
  {
    label: 'Metrics',
    to:    '/dashboard/metrics',
    icon:  BarChart2,
    roles: ['ADMIN', 'USER'],
  },
  {
    label: 'Alerts',
    to:    '/dashboard/alerts',
    icon:  Bell,
    roles: ['ADMIN', 'USER'],
  },
  {
    label: 'Users',
    to:    '/dashboard/users',
    icon:  Users,
    roles: ['ADMIN'],
  },
]

export default function Sidebar() {
  const { role } = useAuthStore()
  console.log('[Sidebar] User role:', role)

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role))
  console.log('[Sidebar] Visible items:', visibleItems.map(i => i.label))
  const roleLabel = role === 'ADMIN' ? 'Admin Workspace' : 'User Workspace'

  return (
    <aside className="
      sticky top-0 h-screen w-60 shrink-0
      app-panel-soft flex flex-col z-40
      border-r border-[#334155]/70
      shadow-[12px_0_36px_rgba(2,6,23,0.42)]
      overflow-hidden
    ">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,rgba(92,107,192,0.18),transparent_42%),linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_26%)]" />

      {/* Logo */}
      <div className="relative px-5 py-6 border-b border-[#374151]/70">
        <div className="flex items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-[#3f51b5] to-[#5c6bc0] shadow-lg shadow-[#5c6bc0]/25">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <span className="text-[1.08rem] font-semibold text-[#E6EEF2] tracking-tight block leading-none truncate">
              CloudShadow
            </span>
            <span className="text-[10px] uppercase tracking-[0.22em] text-[#9AA6B2] leading-5">
              Monitoring Dashboard
            </span>
          </div>
        </div>
        <div className="mt-4 inline-flex items-center rounded-full border border-[#3f51b5]/35 bg-[#3f51b5]/12 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#B9C4F8]">
          {roleLabel}
        </div>
      </div>

      {/* Navigation */}
      <nav className="relative flex-1 px-3 py-4">
        <p className="px-2.5 mb-2.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#8ea0b6]">
          Navigation
        </p>
        <div className="space-y-2">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `
              group relative flex items-center gap-3 px-3.5 h-11 rounded-xl
              text-[13px] font-medium leading-none transition-all duration-200 border
              ${isActive
                ? 'bg-gradient-to-r from-[#3f51b5]/90 to-[#5c6bc0]/90 text-white border-[#5c6bc0]/45 shadow-lg shadow-[#3f51b5]/20'
                : 'text-[#9AA6B2] border-transparent hover:bg-white/5 hover:border-[#3b4a61] hover:text-[#E6EEF2]'
              }
            `}
          >
            <span className="
              flex h-7 w-7 items-center justify-center rounded-lg shrink-0
              bg-black/15 border border-white/10
              group-hover:border-white/20
              transition-colors
            ">
              <item.icon className="w-4 h-4 flex-shrink-0 opacity-90" />
            </span>
            <span className="tracking-[0.01em] truncate">{item.label}</span>
          </NavLink>
        ))}
        </div>
      </nav>

      {/* Footer */}
      <div className="relative px-5 py-4 border-t border-[#374151]/70 bg-black/10">
        <p className="text-xs text-[#9fb0c4] font-medium leading-5">CloudShadow Platform</p>
        <p className="text-[11px] text-[#6b7280] font-mono leading-5">v1.0.0</p>
      </div>
    </aside>
  )
}