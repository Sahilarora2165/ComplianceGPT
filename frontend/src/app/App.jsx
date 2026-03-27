import { useEffect, useMemo, useState } from "react";
import {
  approveDraft,
  getDashboardData,
  sendDeadlineAlert,
  resetPipelineState,
  runPipeline,
  triggerDeadlineScan,
  triggerSchedulerMonitoring,
} from "@/services/complianceApi";
import AuditTrailView from "@/features/audit-trail";
import AnalystQueryView from "@/features/analyst-query";
import ClientProfilesView from "@/features/client-profiles";
import CircularsView from "@/features/circulars";
import DeadlineWatchView from "@/features/deadline-watch";
import DraftReviewView from "@/features/draft-review";
import PipelineControlView from "@/features/pipeline-control";

const NAV = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "circulars", label: "Circulars", icon: "visibility" },
  { key: "drafts", label: "Draft Review", icon: "edit_document" },
  { key: "deadlines", label: "Deadline Watch", icon: "alarm" },
  { key: "clients", label: "Clients", icon: "group" },
  { key: "analyst", label: "Analyst Query", icon: "psychology" },
  { key: "audit", label: "Audit Trail", icon: "history_edu" },
  { key: "pipeline", label: "Pipeline", icon: "account_tree" },
];

// ─── helpers ──────────────────────────────────────────────────
function getClientName(c) { return c?.name || c?.business_profile?.name || "Unknown"; }
function getClientIndustry(c) { return c?.industry || c?.business_profile?.industry || "—"; }
function getClientRiskScore(c) {
  if (typeof c?.risk_profile?.compliance_score === "number") return c.risk_profile.compliance_score;
  const l = (c?.compliance_profile?.risk_level || c?.risk_profile?.risk_level || c?.priority || "").toUpperCase();
  if (l === "HIGH") return 60;
  if (l === "MEDIUM") return 78;
  if (l === "LOW") return 90;
  return 85;
}
function currency(v) {
  if (!v) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
}
function formatDate(v) {
  if (!v) return "No run yet";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(d);
}
function regulatorTone(r) {
  const m = { RBI: "bg-slate-900 text-white", GST: "bg-teal-700 text-white", IncomeTax: "bg-amber-700 text-white", MCA: "bg-sky-900 text-white", SEBI: "bg-emerald-900 text-white" };
  return m[r] || "bg-slate-700 text-white";
}

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [data, setData] = useState({ pipeline: null, circulars: null, drafts: null, deadlines: null, clients: null, audit: null, scheduler: null });
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState("");

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      const next = await getDashboardData();
      if (!ignore) { setData(next); setLoading(false); }
    }
    load();
    return () => { ignore = true; };
  }, []);

  async function reloadDashboard() {
    const next = await getDashboardData();
    setData(next);
    setLoading(false);
    return next;
  }

  // ─── derived data ────────────────────────────────────────────
  const allDrafts   = useMemo(() => data.drafts?.drafts || [], [data.drafts]);
  const allDeadlines = useMemo(() => data.deadlines?.alerts || [], [data.deadlines]);
  const allCirculars = useMemo(() => data.pipeline?.match_results || [], [data.pipeline]);
  const clients     = useMemo(() => data.clients?.clients || [], [data.clients]);
  const auditEvents = useMemo(() => data.audit?.events || [], [data.audit]);
  const scheduler   = useMemo(() => data.scheduler || null, [data.scheduler]);

  const metrics = useMemo(() => ({
    circulars: data.pipeline?.total_circulars || allCirculars.length,
    affectedClients: data.pipeline?.total_matches || 0,
    pendingDrafts: allDrafts.filter((d) => d.status === "pending_review").length,
    deadlineAlerts: data.deadlines?.total || allDeadlines.length,
    totalExposure: data.deadlines?.summary?.total_exposure || 0,
  }), [data, allCirculars, allDrafts, allDeadlines]);

  const urgentCirculars = useMemo(() =>
    allCirculars.filter((i) => i.priority === "HIGH").slice(0, 3),
  [allCirculars]);

  const urgentDraftQueue = useMemo(() =>
    allDrafts
      .filter((d) => d.status === "pending_review")
      .sort((a, b) => (a.risk_level === "HIGH" ? 0 : 1) - (b.risk_level === "HIGH" ? 0 : 1))
      .slice(0, 3),
  [allDrafts]);

  const urgentDeadlines = useMemo(() =>
    allDeadlines.filter((a) => a.level === "MISSED" || a.level === "CRITICAL").slice(0, 3),
  [allDeadlines]);

  const topRiskClients = useMemo(() =>
    [...clients].sort((a, b) => getClientRiskScore(a) - getClientRiskScore(b)).slice(0, 4),
  [clients]);

  // ─── actions ─────────────────────────────────────────────────
  async function refresh(action, label, successLabel) {
    setActionMessage(`${label} in progress...`);
    try {
      await action();
      await reloadDashboard();
      setActionMessage(successLabel || `${label} completed`);
    } catch {
      setActionMessage(`${label} failed`);
    }
  }

  async function handleRunPipeline({ simulateMode, reset, label }) {
    setActionMessage(`${label} starting...`);
    try {
      await runPipeline({ simulateMode, reset });
      setActionMessage(`${label} started — monitoring for completion...`);
      pollCompletion(label);
    } catch {
      setActionMessage(`${label} failed to start`);
    }
  }

  function pollCompletion(label) {
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      try {
        const next = await reloadDashboard();
        const status = next.pipeline?.status;
        if (next.pipeline?.status_message) setActionMessage(next.pipeline.status_message);
        if (status === "completed") {
          clearInterval(timer);
          setActionMessage(`${label} finished — ${next.pipeline?.total_circulars || 0} circulars, ${next.pipeline?.total_matches || 0} matches`);
        } else if (status === "failed") {
          clearInterval(timer);
          setActionMessage(`${label} failed`);
        }
      } catch { /* keep polling */ }
      if (attempts >= 180) { clearInterval(timer); setActionMessage("Pipeline still running — check back shortly."); }
    }, 2000);
  }

  async function handleDraftDecision(draftId, approved) {
    setActionMessage(approved ? "Approving draft..." : "Rejecting draft...");
    try {
      await approveDraft(draftId, approved, "CA");
      await reloadDashboard();
      setActionMessage(approved ? "Draft approved" : "Draft rejected");
    } catch {
      setActionMessage("Action failed");
    }
  }

  // ─── page metadata ────────────────────────────────────────────
  const pageMeta = {
    circulars:  { eyebrow: "Circular Intelligence", subtitle: "Track regulator updates and assess client impact" },
    drafts:     { eyebrow: "Draft Governance", subtitle: "Review AI-generated advisories before client delivery" },
    deadlines:  { eyebrow: "Deadline Intelligence", subtitle: "Track obligations, exposure, and filing risk" },
    clients:    { eyebrow: "Client Intelligence", subtitle: "Review compliance footprint and risk context" },
    audit:      { eyebrow: "Workflow Traceability", subtitle: "Immutable log of every system and agent action" },
    analyst:    { eyebrow: "Research Intelligence", subtitle: "Ask compliance questions grounded in the knowledge base" },
    pipeline:   { eyebrow: "Execution Control", subtitle: "Operate monitoring runs and inspect pipeline state" },
    dashboard:  { eyebrow: "Compliance Operations", subtitle: "Overview of monitoring, drafting, and deadline response" },
  }[page] || { eyebrow: "ComplianceGPT", subtitle: "" };

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 hidden h-screen w-64 flex-col border-r border-white/10 bg-hero px-4 py-7 text-white lg:flex">
        <div className="mb-7 px-2">
          <p className="font-headline text-lg font-extrabold tracking-widest">ComplianceGPT</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.35em] text-teal-100/50">Sovereign Auditor</p>
        </div>

        <nav className="space-y-0.5 flex-1">
          {NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => setPage(item.key)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                page === item.key
                  ? "bg-white/12 text-white"
                  : "text-slate-300/70 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className="material-symbols-outlined text-lg">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-[10px] uppercase tracking-widest text-teal-100/50">Last Sync</p>
          <p className="mt-2 text-sm font-semibold">{data.pipeline?.last_run ? "Synced" : "Not run yet"}</p>
          <p className="mt-0.5 text-xs text-slate-300/60">{formatDate(data.pipeline?.last_run)}</p>
        </div>
      </aside>

      {/* Main */}
      <main className="min-h-screen lg:ml-64">
        {/* Header */}
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-canvas/90 px-5 py-4 backdrop-blur md:px-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-muted">{pageMeta.eyebrow}</p>
              <p className="mt-0.5 text-xs text-slate-600">{pageMeta.subtitle}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <span className="material-symbols-outlined cursor-pointer text-muted hover:text-ink transition">notifications</span>
                {metrics.deadlineAlerts > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-danger" />
                )}
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-shell text-xs font-bold text-white">CA</div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="px-5 py-7 md:px-8">
          {page === "circulars" ? (
            <CircularsView actionMessage={actionMessage} allCirculars={allCirculars} allDrafts={allDrafts} loading={loading} pipeline={data.pipeline}
              onRunDemo={() => handleRunPipeline({ simulateMode: true, reset: true, label: "Demo pipeline" })}
              onRunReal={() => handleRunPipeline({ simulateMode: false, reset: false, label: "Real monitoring" })}
            />
          ) : page === "drafts" ? (
            <DraftReviewView actionMessage={actionMessage} allDrafts={allDrafts} loading={loading}
              onApproveDraft={(id) => handleDraftDecision(id, true)}
              onRejectDraft={(id) => handleDraftDecision(id, false)}
            />
          ) : page === "deadlines" ? (
            <DeadlineWatchView actionMessage={actionMessage} allDeadlines={allDeadlines} deadlineSummary={data.deadlines?.summary} loading={loading}
              onSendAlert={(id) => refresh(() => sendDeadlineAlert(id, "CA"), "Sending alert", "Alert sent")}
              onTriggerScan={() => refresh(triggerDeadlineScan, "Deadline scan")}
            />
          ) : page === "clients" ? (
            <ClientProfilesView clients={clients} loading={loading} />
          ) : page === "audit" ? (
            <AuditTrailView events={auditEvents} loading={loading} />
          ) : page === "analyst" ? (
            <AnalystQueryView />
          ) : page === "pipeline" ? (
            <PipelineControlView actionMessage={actionMessage} loading={loading} pipeline={data.pipeline} scheduler={scheduler}
              onRunDemo={() => handleRunPipeline({ simulateMode: true, reset: true, label: "Demo pipeline" })}
              onRunReal={() => handleRunPipeline({ simulateMode: false, reset: false, label: "Real monitoring" })}
              onResetPipeline={() => refresh(resetPipelineState, "Pipeline reset", "Pipeline reset")}
              onTriggerScheduler={() => refresh(triggerSchedulerMonitoring, "Scheduler trigger", "Scheduler triggered")}
            />
          ) : (
            /* ─── DASHBOARD ─── */
            <div className="space-y-6">
              {/* Title + actions */}
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h1 className="font-headline text-3xl font-extrabold text-slate-950">Compliance Command Center</h1>
                  <p className="mt-1 text-sm text-muted">AI monitoring, client matching, advisory drafts, and deadline tracking for CA firms.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => handleRunPipeline({ simulateMode: true, reset: true, label: "Demo pipeline" })}
                    className="rounded-xl bg-shell px-5 py-2.5 text-sm font-semibold text-white hover:bg-shellSoft transition">
                    Run Demo Pipeline
                  </button>
                  <button onClick={() => handleRunPipeline({ simulateMode: false, reset: false, label: "Real monitoring" })}
                    className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition">
                    Run Real Monitoring
                  </button>
                  <button onClick={() => refresh(triggerDeadlineScan, "Deadline scan")}
                    className="rounded-xl border border-line px-5 py-2.5 text-sm font-semibold text-muted hover:text-ink hover:border-slate-300 transition">
                    Trigger Scan
                  </button>
                </div>
              </div>

              {actionMessage && (
                <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
                  {actionMessage}
                </div>
              )}

              {/* 5 metrics */}
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
                {[
                  { title: "New Circulars", value: metrics.circulars, tone: "border-accent", icon: "policy" },
                  { title: "Clients Affected", value: metrics.affectedClients, tone: "border-accent", icon: "group" },
                  { title: "Pending Reviews", value: metrics.pendingDrafts, tone: "border-warning", icon: "pending_actions" },
                  { title: "Deadline Alerts", value: metrics.deadlineAlerts, tone: "border-danger", icon: "alarm" },
                  { title: "Exposure at Risk", value: currency(metrics.totalExposure), tone: "border-warning", icon: "monetization_on" },
                ].map((m) => (
                  <div key={m.title} className={`rounded-2xl border-l-4 ${m.tone} bg-white p-4 shadow-panel`}>
                    <div className="flex items-start justify-between mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted">{m.title}</span>
                      <span className="material-symbols-outlined text-base text-muted opacity-50">{m.icon}</span>
                    </div>
                    <p className="text-2xl font-extrabold text-slate-950">{m.value}</p>
                  </div>
                ))}
              </div>

              {/* 3-column middle row */}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                {/* What changed */}
                <div className="rounded-2xl bg-white shadow-panel overflow-hidden">
                  <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
                    <span className="material-symbols-outlined text-base text-accent">rss_feed</span>
                    <h3 className="text-sm font-bold text-slate-950">What Changed Today</h3>
                    <button onClick={() => setPage("circulars")} className="ml-auto text-[11px] font-bold text-accent hover:underline">View all</button>
                  </div>
                  <div className="p-4 space-y-2">
                    {urgentCirculars.length ? urgentCirculars.map((item) => (
                      <button key={item.circular_title} onClick={() => setPage("circulars")}
                        className="w-full flex items-start gap-3 rounded-xl p-2 hover:bg-slate-50 text-left transition">
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${regulatorTone(item.regulator)}`}>
                          {item.regulator}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 leading-snug truncate">{item.circular_title}</p>
                          <p className="mt-0.5 text-[11px] text-muted">{item.match_count || 0} clients matched</p>
                        </div>
                      </button>
                    )) : <p className="text-sm text-center text-muted py-5">{loading ? "Loading..." : "No high-priority circulars."}</p>}
                  </div>
                </div>

                {/* Critical now */}
                <div className="rounded-2xl bg-white shadow-panel overflow-hidden">
                  <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
                    <span className="material-symbols-outlined text-base text-danger">radar</span>
                    <h3 className="text-sm font-bold text-slate-950">Critical Now</h3>
                    <button onClick={() => setPage("deadlines")} className="ml-auto text-[11px] font-bold text-accent hover:underline">View all</button>
                  </div>
                  <div className="p-4 space-y-2">
                    {urgentDeadlines.length ? urgentDeadlines.map((alert) => (
                      <button key={alert.alert_id} onClick={() => setPage("deadlines")}
                        className="w-full border-l-4 border-rose-400 pl-3 pr-2 py-2 text-left hover:bg-slate-50 rounded-r-xl transition">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-rose-700">{alert.level} · {alert.due_date}</p>
                        <p className="mt-0.5 text-xs font-semibold text-slate-900">{alert.client_name}</p>
                        <p className="text-[11px] text-muted">{alert.obligation_type}</p>
                      </button>
                    )) : <p className="text-sm text-center text-muted py-5">{loading ? "Loading..." : "No critical alerts."}</p>}
                  </div>
                </div>

                {/* Needs review */}
                <div className="rounded-2xl bg-white shadow-panel overflow-hidden">
                  <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
                    <span className="material-symbols-outlined text-base text-warning">assignment</span>
                    <h3 className="text-sm font-bold text-slate-950">Needs Review</h3>
                    <button onClick={() => setPage("drafts")} className="ml-auto text-[11px] font-bold text-accent hover:underline">View all</button>
                  </div>
                  <div className="p-4 space-y-2">
                    {urgentDraftQueue.length ? urgentDraftQueue.map((draft) => (
                      <button key={draft.draft_id} onClick={() => setPage("drafts")}
                        className="w-full rounded-xl bg-slate-50 p-3 text-left hover:bg-slate-100 transition">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-bold text-slate-900 truncate">{draft.client_name}</p>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            draft.risk_level === "HIGH" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"
                          }`}>{draft.risk_level}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted truncate">{draft.regulator} · {draft.circular_title}</p>
                      </button>
                    )) : <p className="text-sm text-center text-muted py-5">{loading ? "Loading..." : "No pending approvals."}</p>}
                  </div>
                </div>
              </div>

              {/* Bottom row */}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                {/* Top risk clients */}
                <div className="rounded-2xl bg-white shadow-panel p-5">
                  <h3 className="text-sm font-bold text-slate-950 mb-4">Top Risk Clients</h3>
                  <div className="space-y-3">
                    {topRiskClients.length ? topRiskClients.map((c) => {
                      const score = getClientRiskScore(c);
                      const name = getClientName(c);
                      const ini = name.split(" ").slice(0, 2).map((p) => p[0] || "").join("").toUpperCase();
                      return (
                        <div key={c.id} className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-700">{ini}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">{name}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <div className="flex-1 h-1 rounded-full bg-slate-200">
                                <div className={`h-1 rounded-full ${score < 70 ? "bg-danger" : score < 85 ? "bg-warning" : "bg-accent"}`} style={{ width: `${score}%` }} />
                              </div>
                              <span className="text-[11px] font-bold text-muted">{score}</span>
                            </div>
                          </div>
                        </div>
                      );
                    }) : <p className="text-sm text-muted text-center py-3">No clients loaded.</p>}
                  </div>
                </div>

                {/* Ask analyst */}
                <div className="rounded-2xl bg-white shadow-panel p-5 flex flex-col">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 mb-3">
                    <span className="material-symbols-outlined text-accent">psychology</span>
                  </div>
                  <h3 className="font-headline text-base font-bold text-slate-950">Ask the Analyst</h3>
                  <p className="mt-2 text-sm text-muted leading-6 flex-1">
                    Get grounded answers on regulatory changes, filing obligations, and circular interpretations — sourced directly from ingested documents.
                  </p>
                  <button onClick={() => setPage("analyst")} className="mt-4 text-sm font-bold text-accent hover:underline text-left">
                    Open Analyst Query →
                  </button>
                </div>

                {/* Pipeline status */}
                <div className="rounded-2xl shadow-panel overflow-hidden" style={{ background: "linear-gradient(135deg, #0b1a2f 0%, #112747 48%, #153455 100%)" }}>
                  <div className="p-5 text-white">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="h-2 w-2 rounded-full bg-teal-300 shadow-[0_0_8px_rgba(94,234,212,0.8)]" />
                      <h3 className="text-sm font-bold">Pipeline Status</h3>
                    </div>
                    <div className="space-y-2.5 text-xs">
                      {[
                        { label: "Last Run", value: formatDate(data.pipeline?.last_run) },
                        { label: "Mode", value: data.pipeline?.run_mode || "—" },
                        { label: "Circulars", value: `${data.pipeline?.total_circulars || 0} processed` },
                        { label: "Drafts", value: `${data.pipeline?.total_drafts || 0} generated` },
                      ].map((r) => (
                        <div key={r.label} className="flex justify-between gap-4">
                          <span className="uppercase tracking-widest text-slate-400">{r.label}</span>
                          <span className="font-semibold text-white">{r.value}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => handleRunPipeline({ simulateMode: true, reset: true, label: "Demo pipeline" })}
                      className="mt-5 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/20 transition"
                    >
                      Run Demo Pipeline
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="border-t border-slate-200 bg-slate-50 px-5 py-5 md:px-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between text-xs font-medium text-muted">
            <p>AI-assisted compliance workflow · Human review required before client communication</p>
            <div className="flex gap-4">
              <a href="#" className="hover:text-slate-900 transition">Privacy</a>
              <a href="#" className="hover:text-slate-900 transition">Terms</a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
