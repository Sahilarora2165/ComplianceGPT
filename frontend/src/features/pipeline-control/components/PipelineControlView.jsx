import { ActionBanner, EmptyState, StatCard, formatDate, priorityTone } from "@/shared/ui";

function sourceTone(s) {
  if (s === "simulated") return "bg-sky-100 text-sky-800";
  if (s === "real_scrape") return "bg-emerald-100 text-emerald-800";
  return "bg-slate-100 text-slate-600";
}

function sourceLabel(s) {
  if (s === "simulated") return "Simulated";
  if (s === "real_scrape") return "Real Scrape";
  return "Unknown";
}

export default function PipelineControlView({
  actionMessage,
  loading,
  pipeline,
  scheduler,
  onRunDemo,
  onRunReal,
  onResetPipeline,
  onTriggerScheduler,
}) {
  const docs = pipeline?.new_documents || [];
  const isRunning = pipeline?.status === "running";

  const stats = [
    { title: "Last Run", value: formatDate(pipeline?.last_run), tone: "border-accent" },
    { title: "Mode", value: pipeline?.run_mode || "—", tone: "border-slate-400" },
    { title: "Circulars", value: pipeline?.total_circulars || 0, tone: "border-slate-400" },
    { title: "Matches", value: pipeline?.total_matches || 0, tone: "border-accent" },
    { title: "Drafts", value: pipeline?.total_drafts || 0, tone: "border-warning" },
    {
      title: "Scheduler",
      value: scheduler?.scheduler_running ? "Active" : "Stopped",
      tone: scheduler?.scheduler_running ? "border-emerald-500" : "border-rose-500",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-extrabold text-slate-950">Pipeline Control</h1>
          <p className="mt-1 text-sm text-muted">Run monitoring, inspect execution state, and manage the scheduler.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={onRunDemo}
            disabled={isRunning}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning ? "Running..." : "Run Demo Pipeline"}
          </button>
          <button
            onClick={onRunReal}
            disabled={isRunning}
            className="rounded-xl border border-accent px-5 py-2.5 text-sm font-semibold text-accent hover:bg-teal-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Run Real Monitoring
          </button>
        </div>
      </div>

      <ActionBanner message={actionMessage} />

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        {stats.map((s) => (
          <StatCard key={s.title} title={s.title} value={s.value} tone={s.tone} />
        ))}
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">

        {/* Documents table */}
        <div className="xl:col-span-8 space-y-4">
          <div className="rounded-2xl bg-white shadow-panel overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="font-headline text-base font-bold text-slate-950">Latest Pipeline Run</h3>
              {docs.length > 0 && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                  {docs.length} documents
                </span>
              )}
            </div>

            {docs.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left">
                  <thead className="border-b border-slate-100 bg-slate-50">
                    <tr>
                      {["Regulator", "Circular Title", "Priority", "Source"].map((h) => (
                        <th key={h} className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {docs.map((doc) => (
                      <tr key={`${doc.regulator}-${doc.title}`} className="hover:bg-slate-50 transition">
                        <td className="px-5 py-3.5">
                          <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">
                            {doc.regulator}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm font-medium text-slate-900">{doc.title}</td>
                        <td className="px-5 py-3.5">
                          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${priorityTone(doc.priority)}`}>
                            {doc.priority}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${sourceTone(doc.source)}`}>
                            {sourceLabel(doc.source)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6">
                <EmptyState message={loading ? "Loading pipeline result..." : "No documents from the latest run yet. Run the pipeline to see results."} />
              </div>
            )}
          </div>

          {/* 3 compact metrics */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Circulars Processed", value: pipeline?.total_circulars || 0, icon: "description" },
              { label: "Client Matches", value: pipeline?.total_matches || 0, icon: "handshake" },
              { label: "Drafts Generated", value: pipeline?.total_drafts || 0, icon: "edit_document" },
            ].map((m) => (
              <div key={m.label} className="flex items-center gap-4 rounded-2xl bg-white p-5 shadow-panel">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100">
                  <span className="material-symbols-outlined text-slate-600">{m.icon}</span>
                </div>
                <div>
                  <p className="text-2xl font-extrabold text-slate-950">{m.value}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{m.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="xl:col-span-4 space-y-4">

          {/* Quick operations */}
          <div className="rounded-2xl bg-slate-950 p-5 text-white shadow-panel">
            <h3 className="font-headline text-base font-bold mb-4">Quick Operations</h3>
            <div className="space-y-2">
              <button
                onClick={onTriggerScheduler}
                className="flex w-full items-center justify-between rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-medium hover:bg-white/10 transition"
              >
                Trigger Scheduler
                <span className="material-symbols-outlined text-base">arrow_forward</span>
              </button>
              <button
                onClick={onResetPipeline}
                className="flex w-full items-center justify-between rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200 hover:bg-rose-500/20 transition"
              >
                Reset Pipeline State
                <span className="material-symbols-outlined text-base">restart_alt</span>
              </button>
            </div>
          </div>

          {/* Scheduler status */}
          <div className="rounded-2xl bg-white p-5 shadow-panel">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-headline text-base font-bold text-slate-950">Scheduler</h3>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${
                scheduler?.scheduler_running
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-rose-100 text-rose-800"
              }`}>
                {scheduler?.scheduler_running ? "Active" : "Stopped"}
              </span>
            </div>

            {(scheduler?.jobs || []).length ? (
              <div className="space-y-2">
                {scheduler.jobs.map((job) => (
                  <div key={job.id} className="rounded-xl border border-slate-200 p-3">
                    <p className="text-sm font-semibold text-slate-900 truncate">{job.name}</p>
                    <p className="mt-1 text-xs text-muted">Next: {job.next_run || "—"}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message={loading ? "Loading jobs..." : "No scheduler jobs active."} />
            )}
          </div>

          {/* Status notes */}
          <div className="rounded-2xl bg-slate-50 p-5 shadow-panel space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted">Execution Notes</h3>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Run mode</p>
              <p className="mt-1 text-sm text-slate-800">
                {pipeline?.run_mode ? `Last pipeline ran in ${pipeline.run_mode} mode.` : "No run recorded yet."}
              </p>
            </div>
            {pipeline?.total_drafts ? (
              <div className="rounded-xl border-l-4 border-warning bg-amber-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-warning">Drafts ready</p>
                <p className="mt-1 text-sm text-amber-900">
                  {pipeline.total_drafts} drafts from the latest run are awaiting CA review.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
