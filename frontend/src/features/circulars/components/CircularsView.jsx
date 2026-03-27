import { useEffect, useMemo, useState } from "react";
import {
  ActionBanner,
  EmptyState,
  FilterChip,
  StatCard,
  formatDate,
  priorityTone,
  regulatorTone,
} from "@/shared/ui";

function statusTone(status) {
  if (status === "drafted") return "bg-emerald-100 text-emerald-800";
  if (status === "matched") return "bg-sky-100 text-sky-800";
  return "bg-slate-100 text-slate-600";
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
  const [search, setSearch] = useState("");
  const [regFilter, setRegFilter] = useState("All");
  const [priFilter, setPriFilter] = useState("All");
  const [selectedTitle, setSelectedTitle] = useState(null);

  const sourceMap = useMemo(() => {
    const docs = pipeline?.new_documents || [];
    return new Map(docs.map((d) => [d.title, d.source || "unknown"]));
  }, [pipeline]);

  const circulars = useMemo(() =>
    allCirculars.map((item) => {
      const draftCount = allDrafts.filter((d) => d.circular_title === item.circular_title).length;
      return {
        ...item,
        draftCount,
        source: sourceMap.get(item.circular_title) || "unknown",
        status: statusFromItem(item, draftCount),
      };
    }),
  [allCirculars, allDrafts, sourceMap]);

  const filtered = useMemo(() =>
    circulars.filter((item) => {
      const hay = `${item.circular_title} ${item.summary} ${item.regulator}`.toLowerCase();
      return (
        (!search || hay.includes(search.toLowerCase())) &&
        (regFilter === "All" || item.regulator === regFilter) &&
        (priFilter === "All" || item.priority === priFilter)
      );
    }),
  [circulars, search, regFilter, priFilter]);

  useEffect(() => {
    if (!filtered.length) { setSelectedTitle(null); return; }
    if (!selectedTitle || !filtered.some((i) => i.circular_title === selectedTitle)) {
      setSelectedTitle(filtered[0].circular_title);
    }
  }, [filtered, selectedTitle]);

  const selected = filtered.find((i) => i.circular_title === selectedTitle) || filtered[0] || null;

  const metrics = {
    total: circulars.length,
    high: circulars.filter((i) => i.priority === "HIGH").length,
    clients: circulars.reduce((s, i) => s + (i.match_count || 0), 0),
    drafts: allDrafts.length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-extrabold text-slate-950">Circulars Monitor</h1>
          <p className="mt-1 text-sm text-muted">Track regulator updates, assess client impact, and route actions.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onRunDemo} className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition">
            Run Demo
          </button>
          <button onClick={onRunReal} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition">
            Run Real
          </button>
        </div>
      </div>

      <ActionBanner message={actionMessage} />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard title="Circulars" value={metrics.total} tone="border-accent" />
        <StatCard title="High Priority" value={metrics.high} tone="border-danger" />
        <StatCard title="Clients Impacted" value={metrics.clients} tone="border-accent" />
        <StatCard title="Drafts Generated" value={metrics.drafts} tone="border-warning" />
      </div>

      {/* Filters */}
      <div className="rounded-2xl bg-white p-4 shadow-panel space-y-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-line bg-slate-50 py-2.5 pl-9 pr-4 text-sm outline-none focus:border-accent focus:bg-white"
            placeholder="Search circular title, regulator, or summary..."
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted self-center mr-1">Regulator</span>
          {["All", "RBI", "GST", "IncomeTax", "MCA", "SEBI"].map((o) => (
            <FilterChip key={o} label={o} active={regFilter === o} onClick={() => setRegFilter(o)} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted self-center mr-1">Priority</span>
          {["All", "HIGH", "MEDIUM", "LOW"].map((o) => (
            <FilterChip key={o} label={o} active={priFilter === o} onClick={() => setPriFilter(o)} />
          ))}
        </div>
      </div>

      {/* Split */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">

        {/* List */}
        <div className="xl:col-span-7 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-muted">
              {filtered.length} circular{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>

          {filtered.length ? filtered.map((item) => {
            const active = selected?.circular_title === item.circular_title;
            return (
              <button
                key={item.circular_title}
                onClick={() => setSelectedTitle(item.circular_title)}
                className={`w-full rounded-2xl bg-white p-5 text-left shadow-panel transition border-l-4 ${
                  active ? "border-accent ring-1 ring-teal-100" : "border-transparent hover:border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold ${regulatorTone(item.regulator)}`}>
                      {item.regulator}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 leading-snug">{item.circular_title}</p>
                      <p className="mt-1 text-xs text-muted line-clamp-2">{item.summary}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${priorityTone(item.priority)}`}>
                      {item.priority}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${statusTone(item.status)}`}>
                      {item.status}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-muted">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">group</span>
                    {item.match_count || 0} client{item.match_count !== 1 ? "s" : ""} affected
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">edit_document</span>
                    {item.draftCount} draft{item.draftCount !== 1 ? "s" : ""}
                  </span>
                </div>
              </button>
            );
          }) : (
            <EmptyState message={loading ? "Loading circulars..." : "No circulars match the current filters."} />
          )}
        </div>

        {/* Detail panel */}
        <div className="xl:col-span-5">
          {selected ? (
            <div className="sticky top-24 rounded-2xl overflow-hidden shadow-panel">
              <div className="bg-hero p-6 text-white">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${regulatorTone(selected.regulator)}`}>
                    {selected.regulator}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${priorityTone(selected.priority)}`}>
                    {selected.priority}
                  </span>
                </div>
                <h3 className="font-headline text-lg font-bold leading-snug">{selected.circular_title}</h3>
              </div>

              <div className="bg-white p-5 space-y-5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Summary</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{selected.summary || "No summary available."}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Clients matched", value: selected.match_count || 0 },
                    { label: "Drafts generated", value: selected.draftCount },
                    { label: "Status", value: selected.status },
                    { label: "Source", value: selected.source === "simulated" ? "Simulated" : "Real" },
                  ].map((f) => (
                    <div key={f.label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{f.label}</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">{f.value}</p>
                    </div>
                  ))}
                </div>

                {selected.affected_clients?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Matched clients</p>
                    <div className="space-y-2">
                      {selected.affected_clients.slice(0, 4).map((c) => (
                        <div key={c.client_id} className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 p-3">
                          <span className="material-symbols-outlined text-sm text-amber-600 mt-0.5">check_circle</span>
                          <div>
                            <p className="text-xs font-bold text-slate-900">{c.name}</p>
                            <p className="text-xs text-muted">{c.reason}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Next action</p>
                  <p className="text-sm text-slate-700">
                    {selected.draftCount > 0
                      ? `${selected.draftCount} draft${selected.draftCount > 1 ? "s" : ""} ready — go to Draft Review to approve.`
                      : "Run the pipeline to generate client advisories for this circular."}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white shadow-panel p-8">
              <EmptyState message="Select a circular to see details." />
            </div>
          )}
        </div>
      </div>

      {/* Pipeline snapshot */}
      <div className="rounded-2xl bg-white p-5 shadow-panel">
        <p className="text-xs font-bold uppercase tracking-widest text-muted mb-4">Last Pipeline Run</p>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {[
            {
              label: pipeline?.run_mode === "simulate" ? "Demo Run" : "Real Run",
              value: formatDate(pipeline?.last_run),
              dot: pipeline?.run_mode === "simulate" ? "bg-sky-500" : "bg-emerald-500",
            },
            {
              label: "Output",
              value: `${pipeline?.total_circulars || 0} circulars · ${pipeline?.total_matches || 0} matches`,
              dot: "bg-amber-500",
            },
            {
              label: "Drafts",
              value: `${pipeline?.total_drafts || 0} drafts generated`,
              dot: "bg-accent",
            },
          ].map((item) => (
            <div key={item.label} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.dot}`} />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{item.label}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
