import { useEffect } from 'react'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'
import useStore from '../store/useStore'

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
}
const COLORS = {
  success: 'border-emerald-500 text-emerald-400',
  error: 'border-crimson-500 text-crimson-400',
  info: 'border-gold-500 text-gold-400',
}

function Toast({ id, msg, type }) {
  const removeNotification = useStore((s) => s.removeNotification)
  const Icon = ICONS[type] || Info

  useEffect(() => {
    const t = setTimeout(() => removeNotification(id), 4000)
    return () => clearTimeout(t)
  }, [id, removeNotification])

  return (
    <div className={`flex items-start gap-3 bg-ink-800 border-l-2 ${COLORS[type]} px-4 py-3 rounded-r-lg shadow-xl animate-slide-up`}>
      <Icon size={15} className="mt-0.5 flex-shrink-0" />
      <p className="text-sm text-slate-300 flex-1">{msg}</p>
      <button onClick={() => removeNotification(id)} className="text-slate-600 hover:text-slate-400 ml-2">
        <X size={13} />
      </button>
    </div>
  )
}

export default function Notifications() {
  const notifications = useStore((s) => s.notifications)
  if (!notifications.length) return null

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 w-80">
      {notifications.map((n) => (
        <Toast key={n.id} {...n} />
      ))}
    </div>
  )
}