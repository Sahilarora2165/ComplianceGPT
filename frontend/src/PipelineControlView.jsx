function formatDate(value) {
  if (!value) return "No run yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function priorityTone(priority) {
  if (priority === "HIGH") return "bg-amber-100 text-amber-800";
  if (priority === "MEDIUM") return "bg-slate-100 text-slate-700";
  return "bg-teal-100 text-teal-800";
}

function sourceLabel(source) {
  if (source === "simulated") return "Simulated";
  if (source === "real_scrape") return "Real Scrape";
  return "Unknown";
}

function sourceTone(source) {
  if (source === "simulated") return "bg-sky-100 text-sky-800";
  if (source === "real_scrape") return "bg-emerald-100 text-emerald-800";
  return "bg-slate-100 text-slate-700";
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
  const newDocuments = pipeline?.new_documents || [];
  const hasStoredResult = Boolean(pipeline?.last_run);

  const stats = [
    {
      title: "Last Run Time",
      value: formatDate(pipeline?.last_run),
      tone: "border-accent",
    },
    {
      title: "Run Mode",
      value: pipeline?.run_mode || "Waiting",
      tone: "border-slate-900",
    },
    {
      title: "Total Circulars",
      value: pipeline?.total_circulars || 0,
      tone: "border-slate-400",
    },
    {
      title: "Total Matches",
      value: pipeline?.total_matches || 0,
      tone: "border-teal-500",
    },
    {
      title: "Total Drafts",
      value: pipeline?.total_drafts || 0,
      tone: "border-amber-500",
    },
    {
      title: "Scheduler Running",
      value: scheduler?.scheduler_running ? "Active" : "Stopped",
      tone: scheduler?.scheduler_running ? "border-emerald-500" : "border-rose-500",
    },
  ];

  return (
    <>
      <section className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <h1 className="font-headline text-4xl font-extrabold tracking-tight text-slate-950">
            Pipeline Control
          </h1>
          <p className="mt-3 max-w-2xl text-lg leading-8 text-muted">
            Operate monitoring runs, inspect latest execution state, and manage scheduler visibility.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={onRunDemo}
            className="rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-800"
          >
            Run Demo Pipeline
          </button>
          <button
            onClick={onRunReal}
            className="rounded-xl border border-teal-700 px-5 py-3 text-sm font-semibold text-teal-700 transition hover:bg-teal-50"
          >
            Run Real Monitoring
          </button>
        </div>
      </section>

      {actionMessage ? (
        <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
          {actionMessage}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        {stats.map((item) => (
          <StatCard key={item.title} title={item.title} value={item.value} tone={item.tone} />
        ))}
      </section>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
        <div className="space-y-8 xl:col-span-8">
          <section className="rounded-3xl bg-white p-8 shadow-panel">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="font-headline text-xl font-bold text-slate-950">
                Latest Pipeline Result
              </h3>
            </div>

            {newDocuments.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left">
                  <thead className="border-b border-slate-200">
                    <tr>
                      {["Regulator", "Circular Title", "Priority", "Source"].map((label) => (
                        <th
                          key={label}
                          className="pb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {newDocuments.map((doc) => (
                      <tr key={`${doc.regulator}-${doc.title}`} className="hover:bg-slate-50">
                        <td className="py-4">
                          <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white">
                            {doc.regulator}
                          </span>
                        </td>
                        <td className="py-4 text-sm font-semibold text-slate-900">{doc.title}</td>
                        <td className="py-4">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${priorityTone(
                              doc.priority,
                            )}`}
                          >
                            {doc.priority}
                          </span>
                        </td>
                        <td className="py-4 text-right">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${sourceTone(
                              doc.source,
                            )}`}
                          >
                            {sourceLabel(doc.source)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                message={loading ? "Loading latest pipeline result..." : "No pipeline documents available yet."}
              />
            )}
          </section>

          <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <CompactMetricCard
              title="Total Circulars"
              value={pipeline?.total_circulars || 0}
              icon="description"
            />
            <CompactMetricCard
              title="Matches Found"
              value={pipeline?.total_matches || 0}
              icon="handshake"
            />
            <CompactMetricCard
              title="Drafts Prepared"
              value={pipeline?.total_drafts || 0}
              icon="edit_document"
            />
          </section>
        </div>

        <div className="space-y-8 xl:col-span-4">
          <section className="rounded-3xl bg-slate-950 p-6 text-white shadow-panel">
            <h3 className="mb-4 font-headline text-lg font-bold">Quick Operations</h3>
            <div className="space-y-3">
              <button
                onClick={onTriggerScheduler}
                className="flex w-full items-center justify-between rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-medium transition hover:bg-white/10"
              >
                Trigger Scheduler Monitoring
                <span className="material-symbols-outlined text-lg">arrow_forward</span>
              </button>
              <button
                onClick={onResetPipeline}
                className="flex w-full items-center justify-between rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20"
              >
                Reset Pipeline State
                <span className="material-symbols-outlined text-lg">history</span>
              </button>
            </div>
          </section>

          <section className="rounded-3xl bg-white p-6 shadow-panel">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="font-headline text-lg font-bold text-slate-950">Scheduler Status</h3>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${
                  scheduler?.scheduler_running
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-rose-100 text-rose-800"
                }`}
              >
                {scheduler?.scheduler_running ? "Active" : "Stopped"}
              </span>
            </div>

            <div className="space-y-4">
              {(scheduler?.jobs || []).length ? (
                scheduler.jobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center gap-4 rounded-2xl border border-slate-200 p-3"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-[10px] font-bold text-slate-600">
                      {job.id}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-900">{job.name}</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Next: {job.next_run || "Unavailable"}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  message={loading ? "Loading scheduler state..." : "No scheduler jobs available."}
                />
              )}
            </div>
          </section>

          <section className="rounded-3xl bg-slate-50 p-6 shadow-panel">
            <h3 className="mb-4 font-headline text-base font-bold text-slate-950">Execution Notes</h3>
            <div className="space-y-4">
              <NoteBlock
                label="Latest Run Mode"
                value={pipeline?.run_mode ? `Latest pipeline ran in ${pipeline.run_mode} mode.` : "No pipeline run mode recorded yet."}
              />
              <NoteBlock
                label="Stored Result Status"
                value={
                  hasStoredResult
                    ? "A persisted latest pipeline result is available for the frontend to display."
                    : "No stored pipeline result is available yet."
                }
              />
              <div className="rounded-2xl border-l-4 border-amber-400 bg-amber-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-800">
                  Pipeline Run Status
                </p>
                <p className="mt-2 text-sm font-medium text-amber-900">
                  {pipeline?.total_drafts
                    ? `${pipeline.total_drafts} drafts are available from the latest run.`
                    : "No drafts have been produced from the latest run yet."}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function StatCard({ title, value, tone }) {
  return (
    <div className={`rounded-2xl border-l-4 ${tone} bg-white p-4 shadow-panel`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <p className="mt-2 text-lg font-bold text-slate-950">{value}</p>
    </div>
  );
}

function CompactMetricCard({ title, value, icon }) {
  return (
    <div className="flex items-center gap-5 rounded-3xl bg-slate-50 p-6 shadow-panel">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm">
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-950">{value}</p>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{title}</p>
      </div>
    </div>
  );
}

function NoteBlock({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium leading-6 text-slate-800">{value}</p>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}
