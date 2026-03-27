import { useEffect, useMemo, useState } from "react";

function regulatorTone(regulator) {
  const tones = {
    RBI: "bg-slate-900 text-white",
    GST: "bg-teal-700 text-white",
    IncomeTax: "bg-amber-700 text-white",
    MCA: "bg-sky-900 text-white",
    SEBI: "bg-emerald-900 text-white",
  };
  return tones[regulator] || "bg-slate-700 text-white";
}

function priorityTone(priority) {
  if (priority === "HIGH") return "bg-orange-100 text-orange-800";
  if (priority === "MEDIUM") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

function sourceTone(source) {
  if (source === "real_scrape") return "bg-emerald-100 text-emerald-800";
  if (source === "simulated") return "bg-sky-100 text-sky-800";
  return "bg-slate-100 text-slate-600";
}

function formatDate(value) {
  if (!value) return "No run yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sourceLabel(source) {
  if (source === "real_scrape") return "Real Scrape";
  if (source === "simulated") return "Simulated";
  return "Unknown";
}

function statusFromItem(item, draftCount) {
  if (draftCount > 0) return "drafted";
  if ((item.match_count || 0) > 0) return "matched";
  return "detected";
}

export default function CircularsView({
  actionMessage,
  allCirculars,
  allDrafts,
  loading,
  pipeline,
  onRunDemo,
  onRunReal,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [regulatorFilter, setRegulatorFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [selectedCircularTitle, setSelectedCircularTitle] = useState(null);

  const sourceMap = useMemo(() => {
    const docs = pipeline?.new_documents || [];
    return new Map(docs.map((doc) => [doc.title, doc.source || "unknown"]));
  }, [pipeline]);

  const circulars = useMemo(() => {
    return allCirculars.map((item) => {
      const draftCount = allDrafts.filter((draft) => draft.circular_title === item.circular_title).length;
      const source = sourceMap.get(item.circular_title) || "unknown";
      return {
        ...item,
        draftCount,
        source,
        status: statusFromItem(item, draftCount),
      };
    });
  }, [allCirculars, allDrafts, sourceMap]);

  const filteredCirculars = useMemo(() => {
    return circulars.filter((item) => {
      const haystack = `${item.circular_title} ${item.summary} ${item.regulator} ${item.affected_clients
        .map((client) => `${client.name} ${client.reason}`)
        .join(" ")}`.toLowerCase();

      const matchesSearch = !searchQuery || haystack.includes(searchQuery.toLowerCase());
      const matchesRegulator = regulatorFilter === "All" || item.regulator === regulatorFilter;
      const matchesPriority = priorityFilter === "All" || item.priority === priorityFilter;
      const matchesSource =
        sourceFilter === "All" ||
        (sourceFilter === "Simulated" && item.source === "simulated") ||
        (sourceFilter === "Real Scrape" && item.source === "real_scrape");

      return matchesSearch && matchesRegulator && matchesPriority && matchesSource;
    });
  }, [circulars, searchQuery, regulatorFilter, priorityFilter, sourceFilter]);

  useEffect(() => {
    if (!filteredCirculars.length) {
      setSelectedCircularTitle(null);
      return;
    }

    if (!selectedCircularTitle || !filteredCirculars.some((item) => item.circular_title === selectedCircularTitle)) {
      setSelectedCircularTitle(filteredCirculars[0].circular_title);
    }
  }, [filteredCirculars, selectedCircularTitle]);

  const selectedCircular =
    filteredCirculars.find((item) => item.circular_title === selectedCircularTitle) || filteredCirculars[0] || null;

  const metrics = {
    totalCirculars: circulars.length,
    highPriority: circulars.filter((item) => item.priority === "HIGH").length,
    clientsImpacted: circulars.reduce((sum, item) => sum + (item.match_count || 0), 0),
    draftsGenerated: allDrafts.length,
  };

  return (
    <>
      <section className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <h1 className="font-headline text-4xl font-extrabold tracking-tight text-slate-950">
            Circulars Monitor
          </h1>
          <p className="mt-3 max-w-2xl text-lg leading-8 text-muted">
            Track new regulator updates, assess impact, and route action faster.
          </p>
        </div>
      </section>

      {actionMessage ? (
        <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
          {actionMessage}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Total Circulars" value={metrics.totalCirculars} meta="Current pipeline result" icon="article" tone="accent" />
        <MetricCard title="High Priority" value={metrics.highPriority} meta="Immediate review recommended" icon="priority_high" tone="danger" />
        <MetricCard title="Clients Impacted" value={metrics.clientsImpacted} meta="Affected client matches" icon="groups" tone="accent" />
        <MetricCard title="Drafts Generated" value={metrics.draftsGenerated} meta="Available in draft queue" icon="edit_note" tone="warning" />
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full xl:max-w-xl">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                search
              </span>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-teal-300 focus:bg-white"
                placeholder="Search title, regulator, client, or keyword..."
                type="text"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={onRunDemo}
                className="rounded-xl bg-slate-950 px-5 py-3 text-xs font-bold uppercase tracking-[0.16em] text-white transition hover:bg-slate-800"
              >
                Run Demo Pipeline
              </button>
              <button
                onClick={onRunReal}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
              >
                Run Real Monitoring
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-slate-200 pt-4">
            <FilterRow
              label="Regulator"
              options={["All", "RBI", "GST", "IncomeTax", "MCA", "SEBI"]}
              value={regulatorFilter}
              onChange={setRegulatorFilter}
            />
            <FilterRow
              label="Priority"
              options={["All", "HIGH", "MEDIUM", "LOW"]}
              value={priorityFilter}
              onChange={setPriorityFilter}
            />
            <FilterRow
              label="Source"
              options={["All", "Simulated", "Real Scrape"]}
              value={sourceFilter}
              onChange={setSourceFilter}
            />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
        <section className="space-y-4 xl:col-span-8">
          {filteredCirculars.length ? (
            filteredCirculars.map((item) => {
              const active = selectedCircular?.circular_title === item.circular_title;
              const previewNames = item.affected_clients.slice(0, 2).map((client) => client.name);
              const remaining = Math.max(0, item.affected_clients.length - previewNames.length);

              return (
                <button
                  key={item.circular_title}
                  onClick={() => setSelectedCircularTitle(item.circular_title)}
                  className={`w-full rounded-3xl border-l-4 bg-white p-6 text-left shadow-panel transition ${
                    active ? "border-accent ring-2 ring-teal-100" : "border-slate-200 hover:border-accent/60"
                  }`}
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${regulatorTone(item.regulator)}`}>
                          {item.regulator}
                        </span>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${priorityTone(item.priority)}`}>
                          {item.priority}
                        </span>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${sourceTone(item.source)}`}>
                          {sourceLabel(item.source)}
                        </span>
                      </div>

                      <h3 className="mt-3 text-lg font-bold text-slate-950">{item.circular_title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {item.summary || "No summary available for this circular yet."}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <StatusBadge status={item.status} />
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700">
                        {item.match_count} impacted
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-col gap-4 border-t border-slate-200 pt-4 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Matched Clients</p>
                      <p className="mt-1 text-sm font-medium text-slate-800">
                        {previewNames.length ? `${previewNames.join(", ")}${remaining ? ` +${remaining} more` : ""}` : "No matched clients"}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 text-xs font-bold">
                      <button className="text-teal-700 hover:underline">View Details</button>
                      <button className="text-slate-700 hover:text-slate-900">View Drafts</button>
                      <button className="text-slate-700 hover:text-slate-900">Match Review</button>
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <EmptyState message={loading ? "Loading circulars..." : "No circulars match the current filters."} />
          )}
        </section>

        <aside className="xl:col-span-4">
          <section className="sticky top-24 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-panel">
            <div className="bg-hero p-6 text-white">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-100/70">Selected Circular Insights</p>
              <h3 className="mt-2 font-headline text-xl font-bold">
                {selectedCircular ? selectedCircular.circular_title : "No circular selected"}
              </h3>
            </div>

            <div className="space-y-6 p-6">
              {selectedCircular ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <InsightItem label="Regulator" value={selectedCircular.regulator} />
                    <InsightItem label="Priority" value={selectedCircular.priority} />
                    <InsightItem label="Source" value={sourceLabel(selectedCircular.source)} />
                    <InsightItem label="Affected Clients" value={selectedCircular.match_count} />
                  </div>

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Summary</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">
                      {selectedCircular.summary || "No summary available for this circular yet."}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">Why Clients Matched</p>
                    <div className="mt-3 space-y-3">
                      {selectedCircular.affected_clients.slice(0, 3).map((client) => (
                        <div key={client.client_id} className="flex gap-2 text-sm text-slate-800">
                          <span className="material-symbols-outlined text-base text-amber-700">check_circle</span>
                          <div>
                            <p className="font-semibold">{client.name}</p>
                            <p className="text-xs text-slate-600">{client.reason}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Recommended Next Action</p>
                    <p className="mt-2 text-sm text-slate-700">
                      {selectedCircular.draftCount > 0
                        ? `Drafts already exist for this circular. Review ${selectedCircular.draftCount} advisory draft(s) in the draft queue.`
                        : "Run the full pipeline to generate drafts after client matching completes."}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <button className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-bold text-white transition hover:bg-teal-700">
                      {selectedCircular.draftCount > 0 ? "Open Draft Queue" : "Generate via Pipeline"}
                    </button>
                    <button className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50">
                      View Matched Clients
                    </button>
                  </div>
                </>
              ) : (
                <EmptyState message="Select a circular to view impact insights." />
              )}
            </div>
          </section>
        </aside>
      </div>

      <section className="rounded-3xl bg-white p-8 shadow-panel">
        <h3 className="flex items-center gap-2 font-headline text-xl font-bold text-slate-950">
          <span className="material-symbols-outlined text-accent">history</span>
          Latest Pipeline Snapshot
        </h3>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <TimelineCard
            title={pipeline?.run_mode === "simulate" ? "Demo Pipeline Run" : "Real Monitoring Run"}
            subtitle={`Last run: ${formatDate(pipeline?.last_run)}`}
            meta={`${pipeline?.total_circulars || 0} circulars • ${pipeline?.total_matches || 0} matches`}
            tone={pipeline?.run_mode === "simulate" ? "bg-sky-500" : "bg-emerald-500"}
          />
          <TimelineCard
            title="Draft Output"
            subtitle={`${pipeline?.total_drafts || 0} drafts generated`}
            meta="Review queue reflects latest saved draft files"
            tone="bg-amber-500"
          />
          <TimelineCard
            title="Processing State"
            subtitle={pipeline?.run_mode ? "Pipeline status available" : "Waiting for first completed run"}
            meta={pipeline?.run_mode ? `Mode: ${pipeline.run_mode}` : "No pipeline snapshot yet"}
            tone="bg-slate-500"
          />
        </div>
      </section>
    </>
  );
}

function MetricCard({ title, value, meta, icon, tone }) {
  const accentClass = tone === "danger" ? "border-danger" : tone === "warning" ? "border-warning" : "border-accent";
  const iconClass = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-accent";

  return (
    <section className={`rounded-3xl border-l-4 ${accentClass} bg-card p-5 shadow-panel`}>
      <div className="mb-4 flex items-start justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">{title}</span>
        <span className={`material-symbols-outlined opacity-60 ${iconClass}`}>{icon}</span>
      </div>
      <div className="text-3xl font-bold text-slate-950">{value}</div>
      <p className="mt-2 text-xs font-medium text-slate-500">{meta}</p>
    </section>
  );
}

function FilterRow({ label, options, value, onChange }) {
  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              value === option ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const tone =
    status === "drafted"
      ? "bg-emerald-100 text-emerald-800"
      : status === "matched"
        ? "bg-sky-100 text-sky-800"
        : "bg-slate-100 text-slate-700";

  return <span className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${tone}`}>{status}</span>;
}

function InsightItem({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function TimelineCard({ title, subtitle, meta, tone }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${tone}`} />
        <p className="text-sm font-bold text-slate-900">{title}</p>
      </div>
      <p className="mt-3 text-sm text-slate-700">{subtitle}</p>
      <p className="mt-1 text-xs text-slate-500">{meta}</p>
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
