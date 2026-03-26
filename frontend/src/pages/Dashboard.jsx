import { useEffect, useState, useCallback } from 'react'
import { Play, RotateCcw, RefreshCw, Zap, FileText, Users, AlertTriangle, CheckCircle } from 'lucide-react'
import useStore from '../store/useStore'
import { runPipeline, getPipelineStatus } from '../api/client'

const PRIORITY_COLORS = {
  HIGH:   'text-crimson-400 bg-crimson-400/10 border-crimson-400/30',
  MEDIUM: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  LOW:    'text-slate-400 bg-slate-400/10 border-slate-400/30',
}

function StatCard({ label, value, sub, accent, icon: Icon }) {
  return (
    <div className="bg-ink-800 border border-ink-600 rounded-xl p-5 relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">{label}</p>
          <p className={`text-3xl font-display font-bold mt-1 ${accent || 'text-white'}`}>{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        {Icon && <Icon size={20} className="text-ink-600" />}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const {
    pipelineRunning, setPipelineRunning,
    setPipelineResult, pipelineResult,
    setCirculars, addNotification,
  } = useStore()

  const [polling, setPolling] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await getPipelineStatus()
      setPipelineResult(data)
      setCirculars(data.match_results || [])
    } catch (error) {
      console.error(error)
    }
  }, [setPipelineResult, setCirculars])

  // Poll while pipeline is running
  useEffect(() => {
    if (!polling) return
    const interval = setInterval(fetchStatus, 2000)
    return () => clearInterval(interval)
  }, [polling, fetchStatus])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const handleRun = async (simulate = true, reset = false) => {
    if (pipelineRunning) return
    setPipelineRunning(true)
    setPolling(true)
    addNotification(
      reset ? '🔄 Pipeline reset + running in simulate mode...' : '🚀 Pipeline triggered...',
      'info'
    )
    try {
      await runPipeline(simulate, reset)
      // Wait a moment then poll once more
      setTimeout(async () => {
        await fetchStatus()
        setPipelineRunning(false)
        setPolling(false)
        addNotification('✅ Pipeline complete!', 'success')
      }, 3000)
    } catch {
      setPipelineRunning(false)
      setPolling(false)
      addNotification('❌ Pipeline failed — is the backend running?', 'error')
    }
  }

  const stats = {
    circulars: pipelineResult?.total_circulars || 0,
    matches:   pipelineResult?.total_matches   || 0,
    drafts:    pipelineResult?.total_drafts    || 0,
    highPriority: (pipelineResult?.match_results || [])
      .filter(r => r.priority === 'HIGH').length,
  }

  const matchResults = pipelineResult?.match_results || []

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-white">
          Regulatory Intelligence
        </h1>
        <p className="text-slate-400 mt-1 text-sm">
          Autonomous compliance monitoring for Indian CA firms
        </p>
        {pipelineResult?.last_run && (
          <p className="text-xs font-mono text-slate-600 mt-2">
            Last run: {new Date(pipelineResult.last_run).toLocaleString()}
            {' '}·{' '}
            <span className="text-gold-500">{pipelineResult.run_mode}</span>
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 mb-8">
        <button
          onClick={() => handleRun(true, false)}
          disabled={pipelineRunning}
          className="flex items-center gap-2 px-5 py-2.5 bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-ink-950 font-medium text-sm rounded-lg transition-all duration-150"
        >
          {pipelineRunning
            ? <><RefreshCw size={15} className="animate-spin" /> Running...</>
            : <><Play size={15} /> Run Pipeline (Simulate)</>
          }
        </button>

        <button
          onClick={() => handleRun(true, true)}
          disabled={pipelineRunning}
          className="flex items-center gap-2 px-5 py-2.5 bg-ink-700 hover:bg-ink-600 disabled:opacity-50 border border-ink-500 text-slate-300 text-sm rounded-lg transition-all"
        >
          <RotateCcw size={15} /> Reset + Run
        </button>

        <button
          onClick={fetchStatus}
          className="flex items-center gap-2 px-4 py-2.5 border border-ink-600 hover:border-ink-500 text-slate-400 hover:text-slate-300 text-sm rounded-lg transition-all"
        >
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 stagger">
        <StatCard label="Circulars"     value={stats.circulars}    accent="text-gold-400"    icon={FileText}       sub="Detected this run" />
        <StatCard label="High Priority" value={stats.highPriority} accent="text-crimson-400" icon={AlertTriangle}  sub="Require attention" />
        <StatCard label="Client Matches" value={stats.matches}     accent="text-emerald-400" icon={Users}          sub="Pairs identified" />
        <StatCard label="Drafts Ready"  value={stats.drafts}       accent="text-white"       icon={CheckCircle}    sub="Pending review" />
      </div>

      {/* Circulars table */}
      {matchResults.length > 0 && (
        <div className="bg-ink-800 border border-ink-600 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-ink-700 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-white">Detected Circulars</h2>
            <span className="text-xs font-mono text-slate-500">{matchResults.length} total</span>
          </div>
          <div className="divide-y divide-ink-700">
            {matchResults.map((r, i) => (
              <div key={i} className="px-5 py-4 flex items-start gap-4 hover:bg-ink-700/50 transition-colors">
                <span className={`text-xs font-mono px-2 py-0.5 rounded border mt-0.5 flex-shrink-0 ${PRIORITY_COLORS[r.priority]}`}>
                  {r.priority}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">{r.circular_title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{r.summary}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-mono text-gold-500">{r.regulator}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{r.match_count} client{r.match_count !== 1 ? 's' : ''}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!pipelineRunning && matchResults.length === 0 && (
        <div className="bg-ink-800 border border-dashed border-ink-600 rounded-xl p-12 text-center">
          <Zap size={32} className="text-ink-600 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">No pipeline results yet.</p>
          <p className="text-slate-600 text-xs mt-1">Click "Run Pipeline" to detect new circulars.</p>
        </div>
      )}

      {/* Running state */}
      {pipelineRunning && (
        <div className="bg-ink-800 border border-gold-500/20 rounded-xl p-8 text-center mt-4">
          <div className="flex items-center justify-center gap-3 mb-3">
            <RefreshCw size={20} className="text-gold-400 animate-spin" />
            <span className="text-gold-400 font-medium text-sm">Pipeline Running</span>
          </div>
          <p className="text-xs text-slate-500">Monitor → Match → Draft in progress...</p>
          <div className="flex justify-center gap-6 mt-4 text-xs font-mono text-slate-600">
            <span>1. Monitoring Agent</span>
            <span>→</span>
            <span>2. Client Matcher</span>
            <span>→</span>
            <span>3. Drafter Agent</span>
          </div>
        </div>
      )}
    </div>
  )
}
