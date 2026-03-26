import { useCallback, useEffect, useState } from 'react'
import { Building2, RefreshCw, ShieldAlert, Tag } from 'lucide-react'
import { getClients } from '../api/client'
import useStore from '../store/useStore'

function ClientCard({ client }) {
  const clientName = client.name || client.client_name || `Client ${client.client_id ?? ''}`.trim()
  const businessType = client.business_type || client.industry || client.segment || 'Not specified'
  const riskProfile = client.risk_profile || client.risk_level || 'Unknown'
  const tags = client.tags || client.regulators || []

  return (
    <div className="rounded-xl border border-ink-600 bg-ink-800 p-5 transition-colors hover:border-ink-500">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{clientName}</p>
          <p className="mt-1 text-xs text-slate-500">{businessType}</p>
        </div>
        <span className="rounded-lg border border-gold-400/30 bg-gold-400/10 px-2 py-1 text-xs font-mono text-gold-400">
          {client.client_id ?? 'N/A'}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1 rounded-lg border border-crimson-400/20 bg-crimson-400/5 px-2 py-1 text-xs text-slate-300">
          <ShieldAlert size={12} className="text-crimson-400" />
          {riskProfile}
        </span>
        {tags.map((tag, index) => (
          <span
            key={`${client.client_id ?? clientName}-${tag}-${index}`}
            className="inline-flex items-center gap-1 rounded-lg border border-ink-500 bg-ink-700 px-2 py-1 text-xs text-slate-400"
          >
            <Tag size={11} />
            {tag}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function Clients() {
  const { clients, setClients } = useStore()
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await getClients()
      setClients(data.clients || data || [])
    } catch (error) {
      console.error(error)
      setClients([])
    } finally {
      setLoading(false)
    }
  }, [setClients])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Client Portfolio</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Clients monitored against new regulatory circulars
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 rounded-lg border border-ink-600 px-3 py-2 text-sm text-slate-400 transition-all hover:border-ink-500 hover:text-slate-300"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-28 rounded-xl shimmer" />
          ))}
        </div>
      )}

      {!loading && clients.length === 0 && (
        <div className="rounded-xl border border-dashed border-ink-600 bg-ink-800 p-12 text-center">
          <Building2 size={28} className="mx-auto mb-3 text-ink-600" />
          <p className="text-sm text-slate-500">No clients available.</p>
          <p className="mt-1 text-xs text-slate-600">Add client data in the backend to see matches here.</p>
        </div>
      )}

      {!loading && clients.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {clients.map((client, index) => (
            <ClientCard
              key={client.client_id ?? client.id ?? `${client.name ?? 'client'}-${index}`}
              client={client}
            />
          ))}
        </div>
      )}
    </div>
  )
}
