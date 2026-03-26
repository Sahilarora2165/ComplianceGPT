import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Activity, CheckCircle, XCircle, FileText, Users, Edit3 } from 'lucide-react'
import useStore from '../store/useStore'
import { getAuditLog } from '../api/client'

const AGENT_ICONS = {
  IngestAgent:    FileText,
  AnalystAgent:   Activity,
  ClientMatcher:  Users,
  DrafterAgent:   Edit3,
  MonitoringAgent: Activity,
  Orchestrator:   Activity,
  Pipeline:       Activity,
}

const ACTION_COLORS = {
  pdf_ingested:     'text-emerald-400',
  query_answered:   'text-emerald-400',
  query_abstained:  'text-amber-400',
  clients_matched:  'text-blue-400',
  draft_generated:  'text-purple-400',
  draft_approved:   'text-emerald-400',
  draft_rejected:   'text-crimson-400',
  pdf_skipped:      'text-amber-400',
  pipeline_complete:'text-gold-400',
  monitor_complete: 'text-blue-400',
}

const AGENTS = ['All', 'IngestAgent', 'AnalystAgent', 'ClientMatcher', 'DrafterAgent', 'MonitoringAgent', 'Orchestrator']

export default function AuditLog() {
  const { auditEvents, setAuditEvents, auditLoading, setAuditLoading } = useStore()
  const [agentFilter, setAgentFilter] = useState('All')

  const load = useCallback(async () => {
    setAuditLoading(true)
    try {
      const { data } = await getAuditLog(200)
      setAuditEvents(data.events || [])
    } catch (e) {
      console.error(e)
    } finally {
      setAuditLoading(false)
    }
  }, [setAuditEvents, setAuditLoading])

  useEffect(() => { load() }, [load])

  const filtered = agentFilter === 'All'
    ? auditEvents
    : auditEvents.filter(e => e.agent === agentFilter)

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Audit Trail</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Every agent decision logged — {auditEvents.length} total events
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-2 border border-ink-600 hover:border-ink-500 text-slate-400 hover:text-slate-300 text-sm rounded-lg transition-all"
        >
          <RefreshCw size={13} className={auditLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Agent filter */}
      <div className="flex gap-1 mb-6 flex-wrap">
        {AGENTS.map(a => (
          <button
            key={a}
            onClick={() => setAgentFilter(a)}
            className={`px-3 py-1.5 text-xs font-mono rounded-lg border transition-all ${
              agentFilter === a
                ? 'bg-ink-700 border-gold-500/50 text-gold-400'
                : 'border-ink-600 text-slate-500 hover:text-slate-300'
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {auditLoading && (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => <div key={i} className="h-14 rounded-lg shimmer" />)}
        </div>
      )}

      {!auditLoading && filtered.length === 0 && (
        <div className="bg-ink-800 border border-dashed border-ink-600 rounded-xl p-12 text-center">
          <Activity size={28} className="text-ink-600 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No audit events yet.</p>
          <p className="text-slate-600 text-xs mt-1">Run the pipeline to generate audit trail entries.</p>
        </div>
      )}

      {!auditLoading && filtered.length > 0 && (
        <div className="bg-ink-800 border border-ink-600 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-ink-700 flex items-center gap-3">
            <span className="text-xs font-mono text-slate-500 w-48">TIMESTAMP</span>
            <span className="text-xs font-mono text-slate-500 w-36">AGENT</span>
            <span className="text-xs font-mono text-slate-500 w-40">ACTION</span>
            <span className="text-xs font-mono text-slate-500 flex-1">DETAILS</span>
            <span className="text-xs font-mono text-slate-500 w-20 text-right">APPROVAL</span>
          </div>
          <div className="divide-y divide-ink-700/50 max-h-[600px] overflow-y-auto">
            {filtered.map((event, i) => {
              const Icon = AGENT_ICONS[event.agent] || Activity
              const ac = ACTION_COLORS[event.action] || 'text-slate-400'

              return (
                <div key={i} className="px-5 py-3 flex items-start gap-3 hover:bg-ink-700/30 transition-colors">
                  <span className="text-xs font-mono text-slate-600 w-48 flex-shrink-0 mt-0.5">
                    {new Date(event.timestamp).toLocaleString('en-IN', {
                      month: 'short', day: '2-digit',
                      hour: '2-digit', minute: '2-digit', second: '2-digit'
                    })}
                  </span>
                  <div className="flex items-center gap-1.5 w-36 flex-shrink-0">
                    <Icon size={11} className="text-slate-600" />
                    <span className="text-xs font-mono text-slate-400">{event.agent}</span>
                  </div>
                  <span className={`text-xs font-mono w-40 flex-shrink-0 ${ac}`}>
                    {event.action}
                  </span>
                  <div className="flex-1 min-w-0">
                    {event.citation && (
                      <span className="text-xs text-slate-600 italic mr-2">
                        [{event.citation}]
                      </span>
                    )}
                    <span className="text-xs text-slate-600 font-mono">
                      {event.details && Object.keys(event.details).length > 0
                        ? Object.entries(event.details)
                            .filter(([k]) => !['started_at', 'finished_at'].includes(k))
                            .slice(0, 3)
                            .map(([k, v]) => `${k}:${typeof v === 'object' ? JSON.stringify(v).slice(0, 30) : v}`)
                            .join(' · ')
                        : '—'
                      }
                    </span>
                  </div>
                  <div className="w-20 text-right flex-shrink-0">
                    {event.user_approval === true && <CheckCircle size={13} className="text-emerald-400 ml-auto" />}
                    {event.user_approval === false && <XCircle size={13} className="text-crimson-400 ml-auto" />}
                    {event.user_approval === null && <span className="text-xs text-slate-700">—</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
