import { useEffect, useMemo, useState } from "react";
import { EmptyState, FilterChip, StatCard, initials } from "@/shared/ui";

function scoreTone(score) {
  if (score <= 70) return "text-danger";
  if (score <= 85) return "text-warning";
  return "text-accent";
}

function scoreBar(score) {
  if (score <= 70) return "bg-danger";
  if (score <= 85) return "bg-warning";
  return "bg-accent";
}

function priorityTone(p) {
  if (p === "HIGH") return "bg-orange-100 text-orange-800";
  if (p === "MEDIUM") return "bg-amber-100 text-amber-800";
  return "bg-teal-100 text-teal-800";
}

function getScore(client) { return client?.risk_profile?.compliance_score ?? 100; }
function getMisses(client) { return client?.risk_profile?.recent_misses ?? 0; }

export default function ClientProfilesView({ clients, loading }) {
  const [search, setSearch] = useState("");
  const [priFilter, setPriFilter] = useState("All");
  const [industryFilter, setIndustryFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(null);

  const industries = useMemo(() =>
    ["All", ...new Set(clients.map((c) => c.industry).filter(Boolean))],
  [clients]);

  const filtered = useMemo(() =>
    clients.filter((c) => {
      const hay = [c.id, c.name, c.constitution, c.industry, ...(c.tags || [])].join(" ").toLowerCase();
      return (
        (!search || hay.includes(search.toLowerCase())) &&
        (priFilter === "All" || c.priority === priFilter) &&
        (industryFilter === "All" || c.industry === industryFilter)
      );
    }),
  [clients, search, priFilter, industryFilter]);

  useEffect(() => {
    if (!filtered.length) { setSelectedId(null); return; }
    if (!selectedId || !filtered.some((c) => c.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selected = filtered.find((c) => c.id === selectedId) || filtered[0] || null;

  const avgScore = clients.length
    ? Math.round(clients.reduce((s, c) => s + getScore(c), 0) / clients.length)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-headline text-3xl font-extrabold text-slate-950">Client Profiles</h1>
        <p className="mt-1 text-sm text-muted">Review compliance footprint, obligations, and risk context per client.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard title="Total Clients" value={clients.length} tone="border-accent" />
        <StatCard title="High Priority" value={clients.filter((c) => c.priority === "HIGH").length} tone="border-warning" />
        <StatCard title="Obligations" value={clients.reduce((s, c) => s + (c.active_obligations || []).length, 0)} tone="border-slate-400" />
        <StatCard title="Avg Score" value={`${avgScore}/100`} tone="border-teal-500" />
      </div>

      {/* Filters */}
      <div className="rounded-2xl bg-white p-4 shadow-panel space-y-3">
        <div className="flex flex-col gap-3 xl:flex-row">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-line bg-slate-50 py-2.5 pl-9 pr-4 text-sm outline-none focus:border-accent focus:bg-white"
              placeholder="Search client name, industry, or tag..."
            />
          </div>
          <select
            value={industryFilter}
            onChange={(e) => setIndustryFilter(e.target.value)}
            className="rounded-xl border border-line bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-accent xl:w-52"
          >
            {industries.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted self-center mr-1">Priority</span>
          {["All", "HIGH", "MEDIUM", "LOW"].map((o) => (
            <FilterChip key={o} label={o} active={priFilter === o} onClick={() => setPriFilter(o)} />
          ))}
        </div>
      </div>

      {/* Split */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">

        {/* Client list */}
        <div className="xl:col-span-4">
          <div className="rounded-2xl bg-white shadow-panel overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-widest text-muted">Clients</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {filtered.length}
              </span>
            </div>
            <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-100">
              {filtered.length ? filtered.map((c) => {
                const active = selected?.id === c.id;
                const score = getScore(c);
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full p-4 text-left transition ${
                      active ? "bg-slate-50 border-l-4 border-accent" : "border-l-4 border-transparent hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                        {initials(c.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{c.name}</p>
                        <p className="text-xs text-muted truncate">{c.industry}</p>
                      </div>
                      <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${priorityTone(c.priority)}`}>
                        {c.priority}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-200">
                        <div className={`h-1.5 rounded-full ${scoreBar(score)}`} style={{ width: `${score}%` }} />
                      </div>
                      <span className={`text-[11px] font-bold ${scoreTone(score)}`}>{score}</span>
                    </div>
                  </button>
                );
              }) : (
                <div className="p-4">
                  <EmptyState message={loading ? "Loading clients..." : "No clients match filters."} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Client detail */}
        <div className="xl:col-span-8">
          {selected ? (
            <div className="space-y-4">
              {/* Client header card */}
              <div className="rounded-2xl bg-white shadow-panel p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-white">
                      {initials(selected.name)}
                    </div>
                    <div>
                      <h2 className="font-headline text-xl font-bold text-slate-950">{selected.name}</h2>
                      <p className="text-sm text-muted">{selected.constitution} · {selected.industry}</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${priorityTone(selected.priority)}`}>
                    {selected.priority}
                  </span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
                  {[
                    { label: "Client ID", value: selected.id },
                    { label: "Constitution", value: selected.constitution },
                    { label: "Compliance Score", value: `${getScore(selected)}/100` },
                    { label: "Recent Misses", value: getMisses(selected) },
                  ].map((f) => (
                    <div key={f.label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{f.label}</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">{f.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tags and identifiers */}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="rounded-2xl bg-white shadow-panel p-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">Regulatory Tags</p>
                  {(selected.tags || []).length ? (
                    <div className="flex flex-wrap gap-2">
                      {selected.tags.map((t) => (
                        <span key={t} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{t}</span>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted">No tags assigned.</p>}
                </div>

                <div className="rounded-2xl bg-white shadow-panel p-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">Identifiers</p>
                  <div className="space-y-2">
                    {Object.entries(selected.identifiers || {}).filter(([, v]) => v).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs">
                        <span className="font-bold uppercase text-muted">{k}</span>
                        <span className="font-mono text-slate-700">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Risk areas */}
              {(selected.risk_profile?.high_risk_areas || []).length > 0 && (
                <div className="rounded-2xl bg-white shadow-panel p-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">High Risk Areas</p>
                  <div className="flex flex-wrap gap-2">
                    {selected.risk_profile.high_risk_areas.map((area) => (
                      <span key={area} className="flex items-center gap-1.5 rounded-xl bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-800">
                        <span className="material-symbols-outlined text-sm">warning</span>
                        {area}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Obligations */}
              <div className="rounded-2xl bg-white shadow-panel overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Active Obligations</p>
                  <span className="text-xs text-muted">{(selected.active_obligations || []).length} total</span>
                </div>
                {(selected.active_obligations || []).length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[500px] text-left">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          {["Obligation", "Due Date", "Status", "Risk", "Penalty"].map((h) => (
                            <th key={h} className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selected.active_obligations.map((ob) => (
                          <tr key={ob.id} className="hover:bg-slate-50 transition">
                            <td className="px-4 py-3">
                              <p className="text-sm font-semibold text-slate-900">{ob.type}</p>
                              <p className="text-[11px] text-muted font-mono">{ob.id}</p>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700">{ob.due_date}</td>
                            <td className="px-4 py-3 text-sm text-slate-700">{ob.status}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${priorityTone(ob.risk_level)}`}>
                                {ob.risk_level}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted">{ob.penalty_if_missed || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-5"><EmptyState message="No active obligations recorded." /></div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white shadow-panel p-10">
              <EmptyState message={loading ? "Loading client data..." : "Select a client to view their profile."} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
