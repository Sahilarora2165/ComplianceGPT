import { createElement } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, FileText, MessageSquare,
  ClipboardList, Users, Shield, Activity
} from 'lucide-react'
import useStore from '../store/useStore'

const NAV = [
  { to: '/',         icon: LayoutDashboard, label: 'Dashboard'  },
  { to: '/circulars', icon: FileText,        label: 'Circulars'  },
  { to: '/drafts',   icon: ClipboardList,   label: 'Drafts'     },
  { to: '/query',    icon: MessageSquare,   label: 'Query'      },
  { to: '/clients',  icon: Users,           label: 'Clients'    },
  { to: '/audit',    icon: Activity,        label: 'Audit Log'  },
]

export default function Sidebar() {
  const { backendOnline, pipelineRunning } = useStore()

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col border-r border-ink-700 bg-ink-900 relative">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-ink-700">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Shield size={22} className="text-gold-400" />
            {pipelineRunning && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-gold-400 rounded-full animate-pulse" />
            )}
          </div>
          <div>
            <p className="font-display font-semibold text-white text-sm leading-tight">
              ComplianceGPT
            </p>
            <p className="text-xs text-slate-500 font-mono">v1.0</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group
               ${isActive
                 ? 'bg-ink-700 text-gold-400 font-medium'
                 : 'text-slate-400 hover:text-white hover:bg-ink-800'
               }`
            }
          >
            {createElement(icon, { size: 16, className: 'text-slate-500 group-hover:text-slate-300' })}
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Backend status */}
      <div className="px-4 py-4 border-t border-ink-700">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${backendOnline ? 'bg-emerald-400' : 'bg-crimson-400'}`} />
          <span className="text-xs font-mono text-slate-500">
            {backendOnline ? 'API Connected' : 'API Offline'}
          </span>
        </div>
        <p className="text-xs text-slate-600 mt-1 font-mono">:8000</p>
      </div>
    </aside>
  )
}
