import { useCallback, useEffect, useState } from 'react'
import { CheckCircle, XCircle, ChevronDown, ChevronUp, RefreshCw, Clock, Mail, FileText } from 'lucide-react'
import useStore from '../store/useStore'
import { getDrafts, approveDraft } from '../api/client'

const RISK_CONFIG = {
  HIGH:   'text-crimson-400 border-crimson-400/30 bg-crimson-400/10',
  MEDIUM: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  LOW:    'text-slate-400 border-slate-400/30 bg-slate-400/10',
}

const STATUS_CONFIG = {
  pending_review: { label: 'Pending',  cls: 'text-gold-400 bg-gold-400/10 border-gold-400/30' },
  approved:       { label: 'Approved', cls: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
  rejected:       { label: 'Rejected', cls: 'text-crimson-400 bg-crimson-400/10 border-crimson-400/30' },
}

function DraftCard({ draft, onApprove, onReject }) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const sc = STATUS_CONFIG[draft.status] || STATUS_CONFIG.pending_review
  const rc = RISK_CONFIG[draft.risk_level] || RISK_CONFIG.LOW

  const handleApprove = async (approved) => {
    setLoading(true)
    await (approved ? onApprove(draft.draft_id) : onReject(draft.draft_id))
    setLoading(false)
  }

  return (
    <div className="bg-ink-800 border border-ink-600 rounded-xl overflow-hidden hover:border-ink-500 transition-colors">
      <div
        className="px-5 py-4 cursor-pointer flex items-start gap-4"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Tags */}
        <div className="flex flex-col gap-1.5 flex-shrink-0 mt-0.5">
          <span className={`text-xs font-mono px-2 py-0.5 rounded border ${rc}`}>
            {draft.risk_level}
          </span>
          <span className={`text-xs font-mono px-2 py-0.5 rounded border ${sc.cls}`}>
            {sc.label}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">{draft.client_name}</p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{draft.circular_title}</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-xs font-mono text-gold-500">{draft.regulator}</span>
            <span className="text-slate-600">·</span>
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Clock size={10} />
              {draft.deadline}
            </span>
            {draft.source_chunks?.length > 0 && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-xs text-slate-600">{draft.source_chunks.length} source{draft.source_chunks.length !== 1 ? 's' : ''}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {draft.status === 'pending_review' && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); handleApprove(true) }}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs rounded-lg transition-all disabled:opacity-50"
              >
                <CheckCircle size={12} /> Approve
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleApprove(false) }}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-crimson-400/10 hover:bg-crimson-400/20 border border-crimson-400/30 text-crimson-400 text-xs rounded-lg transition-all disabled:opacity-50"
              >
                <XCircle size={12} /> Reject
              </button>
            </>
          )}
          {expanded ? <ChevronUp size={14} className="text-slate-600" /> : <ChevronDown size={14} className="text-slate-600" />}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-ink-700 bg-ink-900/50">
          {/* Actions */}
          {draft.actions?.length > 0 && (
            <div className="px-5 py-4 border-b border-ink-700">
              <p className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <FileText size={11} /> Required Actions
              </p>
              <ol className="space-y-1.5">
                {draft.actions.map((action, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-ink-700 text-gold-400 text-xs flex items-center justify-center font-mono mt-0.5">
                      {i + 1}
                    </span>
                    {action}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Email preview */}
          {draft.email_body && (
            <div className="px-5 py-4 border-b border-ink-700">
              <p className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Mail size={11} /> Advisory Email Draft
              </p>
              <div className="bg-ink-800 rounded-lg p-4 border border-ink-700">
                <p className="text-xs text-slate-500 mb-1">Subject: <span className="text-slate-300">{draft.email_subject}</span></p>
                <hr className="border-ink-700 my-2" />
                <pre className="text-xs text-slate-400 whitespace-pre-wrap font-body leading-relaxed">
                  {draft.email_body}
                </pre>
              </div>
            </div>
          )}

          {/* Sources */}
          {draft.source_chunks?.length > 0 && (
            <div className="px-5 py-4">
              <p className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-2">Sources</p>
              <div className="space-y-1">
                {draft.source_chunks.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs font-mono text-slate-600">
                    <span className="text-gold-600">[{i+1}]</span>
                    <span>{s.source}</span>
                    <span>·</span>
                    <span>Page {s.page}</span>
                    <span>·</span>
                    <span>Score {s.score}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Internal notes */}
          {draft.internal_notes && (
            <div className="px-5 py-3 bg-amber-400/5 border-t border-amber-400/10">
              <p className="text-xs font-mono text-amber-400/70 uppercase tracking-wider mb-1">Internal Notes</p>
              <p className="text-xs text-slate-500 italic">{draft.internal_notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Drafts() {
  const { drafts, setDrafts, draftsLoading, setDraftsLoading, updateDraftStatus, addNotification } = useStore()
  const [statusFilter, setStatusFilter] = useState('all')

  const load = useCallback(async () => {
    setDraftsLoading(true)
    try {
      const { data } = await getDrafts()
      setDrafts(data.drafts || [])
    } catch (e) {
      console.error(e)
    } finally {
      setDraftsLoading(false)
    }
  }, [setDrafts, setDraftsLoading])

  useEffect(() => { load() }, [load])

  const handleApprove = async (draftId) => {
    try {
      await approveDraft(draftId, true, 'CA')
      updateDraftStatus(draftId, 'approved')
      addNotification('✅ Draft approved', 'success')
    } catch { addNotification('Failed to approve', 'error') }
  }

  const handleReject = async (draftId) => {
    try {
      await approveDraft(draftId, false, 'CA')
      updateDraftStatus(draftId, 'rejected')
      addNotification('Draft rejected', 'info')
    } catch { addNotification('Failed to reject', 'error') }
  }

  const filters = ['all', 'pending_review', 'approved', 'rejected']
  const filtered = statusFilter === 'all'
    ? drafts
    : drafts.filter(d => d.status === statusFilter)

  const counts = {
    all: drafts.length,
    pending_review: drafts.filter(d => d.status === 'pending_review').length,
    approved:       drafts.filter(d => d.status === 'approved').length,
    rejected:       drafts.filter(d => d.status === 'rejected').length,
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Advisory Drafts</h1>
          <p className="text-slate-500 text-sm mt-0.5">Review and approve client advisory notes</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-2 border border-ink-600 hover:border-ink-500 text-slate-400 hover:text-slate-300 text-sm rounded-lg transition-all"
        >
          <RefreshCw size={13} className={draftsLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Status filter */}
      <div className="flex gap-1 mb-6">
        {filters.map(f => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 text-xs font-mono rounded-lg border transition-all capitalize ${
              statusFilter === f
                ? 'bg-ink-700 border-gold-500/50 text-gold-400'
                : 'border-ink-600 text-slate-500 hover:text-slate-300'
            }`}
          >
            {f.replace('_', ' ')}
            <span className="ml-1.5 opacity-60">({counts[f]})</span>
          </button>
        ))}
      </div>

      {draftsLoading && (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-24 rounded-xl shimmer" />)}
        </div>
      )}

      {!draftsLoading && filtered.length === 0 && (
        <div className="bg-ink-800 border border-dashed border-ink-600 rounded-xl p-12 text-center">
          <p className="text-slate-500 text-sm">No drafts found.</p>
          <p className="text-slate-600 text-xs mt-1">Run the pipeline to generate advisory drafts.</p>
        </div>
      )}

      <div className="space-y-3 stagger">
        {filtered.map(draft => (
          <DraftCard
            key={draft.draft_id}
            draft={draft}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        ))}
      </div>
    </div>
  )
}
