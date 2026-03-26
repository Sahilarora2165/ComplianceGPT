import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Users, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import useStore from '../store/useStore'
import { getSimulatedCirculars } from '../api/client'

const PRIORITY_CONFIG = {
  HIGH:   { label: 'HIGH',   cls: 'text-crimson-400 bg-crimson-400/10 border-crimson-400/30' },
  MEDIUM: { label: 'MEDIUM', cls: 'text-amber-400 bg-amber-400/10 border-amber-400/30'       },
  LOW:    { label: 'LOW',    cls: 'text-slate-400 bg-slate-400/10 border-slate-400/30'       },
}

const REGULATOR_COLORS = {
  RBI:        'text-blue-400  bg-blue-400/10  border-blue-400/30',
  GST:        'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  IncomeTax:  'text-purple-400 bg-purple-400/10 border-purple-400/30',
  MCA:        'text-orange-400 bg-orange-400/10 border-orange-400/30',
  SEBI:       'text-cyan-400  bg-cyan-400/10  border-cyan-400/30',
}

function CircularCard({ circular }) {
  const [expanded, setExpanded] = useState(false)
  const { priority, circular_title, regulator, summary, affected_clients, match_count } = circular
  const pc = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.LOW
  const rc = REGULATOR_COLORS[regulator] || 'text-slate-400 bg-slate-400/10 border-slate-400/30'

  return (
    <div className="bg-ink-800 border border-ink-600 rounded-xl overflow-hidden hover:border-ink-500 transition-colors">
      <div
        className="px-5 py-4 cursor-pointer flex items-start gap-4"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex flex-col gap-1.5 flex-shrink-0 mt-0.5">
          <span className={`text-xs font-mono px-2 py-0.5 rounded border ${pc.cls}`}>
            {pc.label}
          </span>
          <span className={`text-xs font-mono px-2 py-0.5 rounded border ${rc}`}>
            {regulator}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">{circular_title}</p>
          <p className="text-xs text-slate-500 mt-1 line-clamp-2">{summary}</p>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <Users size={12} />
              <span>{match_count} client{match_count !== 1 ? 's' : ''}</span>
            </div>
          </div>
          {match_count > 0 && (
            expanded
              ? <ChevronUp size={15} className="text-slate-500" />
              : <ChevronDown size={15} className="text-slate-500" />
          )}
        </div>
      </div>

      {/* Affected clients */}
      {expanded && affected_clients?.length > 0 && (
        <div className="border-t border-ink-700 bg-ink-900/50 px-5 py-4">
          <p className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-3">
            Affected Clients
          </p>
          <div className="space-y-2">
            {affected_clients.map((c) => (
              <div key={c.client_id} className="flex items-start gap-3 bg-ink-800 rounded-lg px-3 py-2.5">
                <div className="w-6 h-6 rounded-full bg-ink-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-mono text-gold-400">{c.client_id}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium">{c.name}</p>
                  <p className="text-xs text-slate-500">{c.business_type}</p>
                  <p className="text-xs text-slate-600 mt-0.5 italic">"{c.reason}"</p>
                </div>
                {c.urgent && (
                  <span className="flex items-center gap-1 text-xs text-crimson-400 flex-shrink-0">
                    <AlertCircle size={11} />
                    Urgent
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Circulars() {
  const { circulars, setCirculars, circularsLoading, setCircularsLoading } = useStore()
  const [filter, setFilter] = useState('ALL')

  const load = useCallback(async () => {
    setCircularsLoading(true)
    try {
      const { data } = await getSimulatedCirculars()
      setCirculars(data.circulars || [])
    } catch (e) {
      console.error(e)
    } finally {
      setCircularsLoading(false)
    }
  }, [setCirculars, setCircularsLoading])

  useEffect(() => { load() }, [load])

  const REGULATORS = ['ALL', 'RBI', 'GST', 'IncomeTax', 'MCA', 'SEBI']
  const filtered = filter === 'ALL'
    ? circulars
    : circulars.filter(c => c.regulator === filter)

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Regulatory Circulars</h1>
          <p className="text-slate-500 text-sm mt-0.5">New circulars matched to your client portfolio</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-2 border border-ink-600 hover:border-ink-500 text-slate-400 hover:text-slate-300 text-sm rounded-lg transition-all"
        >
          <RefreshCw size={13} className={circularsLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 flex-wrap">
        {REGULATORS.map(r => (
          <button
            key={r}
            onClick={() => setFilter(r)}
            className={`px-3 py-1.5 text-xs font-mono rounded-lg border transition-all ${
              filter === r
                ? 'bg-ink-700 border-gold-500/50 text-gold-400'
                : 'border-ink-600 text-slate-500 hover:text-slate-300 hover:border-ink-500'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {circularsLoading && (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-20 rounded-xl shimmer" />
          ))}
        </div>
      )}

      {!circularsLoading && filtered.length === 0 && (
        <div className="bg-ink-800 border border-dashed border-ink-600 rounded-xl p-12 text-center">
          <p className="text-slate-500 text-sm">No circulars found.</p>
          <p className="text-slate-600 text-xs mt-1">Run the pipeline from Dashboard to detect new circulars.</p>
        </div>
      )}

      <div className="space-y-3 stagger">
        {filtered.map((c, i) => (
          <CircularCard key={i} circular={c} />
        ))}
      </div>
    </div>
  )
}
