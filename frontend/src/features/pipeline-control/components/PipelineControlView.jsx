import { EmptyState, StatCard, formatDate, priorityTone } from "@/shared/ui";

function sourceTone(source) {
  if (source === "simulated") return "bg-sky-100 text-sky-800";
  if (source === "real_scrape") return "bg-emerald-100 text-emerald-800";
  if (source === "manual_upload") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

function sourceLabel(source) {
  if (source === "simulated") return "Simulated";
  if (source === "real_scrape") return "Real Scrape";
  if (source === "manual_upload") return "Manual Upload";
  return "Unknown";
}

export default function PipelineControlView({
  actionMessage,
  loading,
  pipeline,
  scheduler,
  onResetPipeline,
  onTriggerScheduler,
  onOpenDocumentIntake,
}) {
  const docs = pipeline?.new_documents || [];
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
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-muted">
          Monitoring Control
        </p>
        <h1 className="font-headline text-[2.15rem] font-extrabold leading-tight tracking-tight text-slate-950">
          Operations Center
        </h1>
        <p className="text-sm text-slate-600">
          Run monitoring workflows, review the latest execution results, and manage scheduler operations.
        </p>
      </div>

      {actionMessage ? (
        <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
          {actionMessage}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 p-5 text-white shadow-panel">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-300">
              Document Intake Shortcut
            </p>
            <p className="mt-1 text-sm text-slate-200">
              Upload circulars from Analyst Query to ingest instantly into the knowledge base.
            </p>
          </div>
          <button
            onClick={onOpenDocumentIntake}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
          >
            <span className="material-symbols-outlined text-base">open_in_new</span>
            Open Document Intake
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        {stats.map((item) => (
          <StatCard key={item.title} title={item.title} value={item.value} tone={item.tone} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-8 space-y-4">
          <div className="rounded-2xl bg-white shadow-panel overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="font-headline text-base font-bold text-slate-950">Latest Monitoring Run</h3>
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
                      {["Regulator", "Circular Title", "Priority", "Source"].map((header) => (
                        <th key={header} className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {docs.map((doc) => (
                      <tr key={`${doc.regulator}-${doc.title}-${doc.filename || ""}`} className="hover:bg-slate-50 transition">
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
                <EmptyState
                  message={
                    loading
                      ? "Loading monitoring result..."
                      : "No documents from the latest run yet. Trigger monitoring to see results."
                  }
                />
              </div>
            )}
          </div>
        </div>

        <div className="xl:col-span-4 space-y-4">
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
                Reset Monitoring State
                <span className="material-symbols-outlined text-base">restart_alt</span>
              </button>
            </div>
          </div>

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
        </div>
      </div>
    </div>
  );
}
