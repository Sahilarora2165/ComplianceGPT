import { useEffect, useMemo, useRef, useState } from "react";
import {
  DetailRow,
  EmptyState,
  StatCard,
  initials,
} from "@/shared/ui";

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

function priorityTone(priority) {
  if (priority === "HIGH") return "bg-orange-100 text-orange-800";
  if (priority === "MEDIUM") return "bg-amber-100 text-amber-800";
  return "bg-teal-100 text-teal-800";
}

function getScore(client) {
  return client?.risk_profile?.compliance_score ?? 100;
}

function getMisses(client) {
  return client?.risk_profile?.recent_misses ?? 0;
}

function getIndustry(client) {
  return client?.industry || "Unspecified";
}

const PRIORITY_OPTIONS = ["All", "HIGH", "MEDIUM", "LOW"];

export default function ClientProfilesView({ clients, loading }) {
  const [search, setSearch] = useState("");
  const [priFilter, setPriFilter] = useState("All");
  const [industryFilter, setIndustryFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(null);
  const [openDropdown, setOpenDropdown] = useState(null);
  const filterRef = useRef(null);

  const industries = useMemo(
    () => ["All", ...new Set(clients.map((client) => client.industry).filter(Boolean))],
    [clients],
  );

  const filtered = useMemo(
    () =>
      clients.filter((client) => {
        const haystack = [
          client.id,
          client.name,
          client.constitution,
          client.industry,
          ...(client.tags || []),
        ]
          .join(" ")
          .toLowerCase();

        return (
          (!search || haystack.includes(search.toLowerCase())) &&
          (priFilter === "All" || client.priority === priFilter) &&
          (industryFilter === "All" || client.industry === industryFilter)
        );
      }),
    [clients, search, priFilter, industryFilter],
  );

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !filtered.some((client) => client.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    function onClickOutside(event) {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setOpenDropdown(null);
      }
    }

    function onEscape(event) {
      if (event.key === "Escape") {
        setOpenDropdown(null);
      }
    }

    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);

    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  const selected = filtered.find((client) => client.id === selectedId) || filtered[0] || null;

  const stats = {
    total: clients.length,
    highPriority: clients.filter((client) => client.priority === "HIGH").length,
    obligations: clients.reduce(
      (sum, client) => sum + (client.active_obligations || []).length,
      0,
    ),
    avgScore: clients.length
      ? Math.round(clients.reduce((sum, client) => sum + getScore(client), 0) / clients.length)
      : 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-muted">
            Client Intelligence
          </p>
          <h1 className="font-headline text-[2.15rem] font-extrabold leading-tight tracking-tight text-slate-950">
            Client Profiles
          </h1>
          <p className="text-sm text-slate-600">
            Review compliance footprint, obligations, and risk context per client.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard title="Total" value={stats.total} tone="border-slate-400" />
          <StatCard title="High Priority" value={stats.highPriority} tone="border-warning" />
          <StatCard title="Obligations" value={stats.obligations} tone="border-accent" />
          <StatCard title="Avg Score" value={`${stats.avgScore}/100`} tone="border-teal-500" />
        </div>
      </div>

      <div className="rounded-2xl bg-white px-4 pb-4 pt-6 shadow-panel">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-[1.35]">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">
              search
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-xl border border-line bg-slate-50 py-2.5 pl-9 pr-4 text-sm outline-none focus:border-accent focus:bg-white"
              placeholder="Search client name, industry, or tag..."
            />
          </div>

          <div ref={filterRef} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:w-[320px] xl:self-center">
            <FilterSelect
              label="Industry"
              value={industryFilter}
              options={industries}
              isOpen={openDropdown === "industry"}
              onChange={setIndustryFilter}
              onToggle={() =>
                setOpenDropdown((current) => (current === "industry" ? null : "industry"))
              }
              onClose={() => setOpenDropdown(null)}
            />
            <FilterSelect
              label="Priority"
              value={priFilter}
              options={PRIORITY_OPTIONS}
              isOpen={openDropdown === "priority"}
              onChange={setPriFilter}
              onToggle={() =>
                setOpenDropdown((current) => (current === "priority" ? null : "priority"))
              }
              onClose={() => setOpenDropdown(null)}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-4">
          <div className="rounded-2xl bg-white shadow-panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-widest text-muted">
                Clients
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {filtered.length}
              </span>
            </div>

            <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-100">
              {filtered.length ? (
                filtered.map((client) => {
                  const active = selected?.id === client.id;
                  const score = getScore(client);
                  return (
                    <button
                      key={client.id}
                      onClick={() => setSelectedId(client.id)}
                      className={`w-full border-l-4 p-4 text-left transition ${
                        active
                          ? `${score <= 70 ? "border-danger" : score <= 85 ? "border-warning" : "border-accent"} bg-slate-50`
                          : "border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xs font-bold text-white">
                            {initials(client.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate">
                              {client.name}
                            </p>
                            <p className="mt-0.5 text-xs text-muted truncate">
                              {getIndustry(client)}
                            </p>
                          </div>
                        </div>

                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${priorityTone(
                            client.priority,
                          )}`}
                        >
                          {client.priority}
                        </span>
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-slate-200">
                          <div
                            className={`h-1.5 rounded-full ${scoreBar(score)}`}
                            style={{ width: `${score}%` }}
                          />
                        </div>
                        <span className={`text-[11px] font-bold ${scoreTone(score)}`}>
                          {score}
                        </span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="p-4">
                  <EmptyState
                    message={loading ? "Loading clients..." : "No clients match filters."}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="xl:col-span-8">
          {selected ? (
            <div className="rounded-2xl bg-white shadow-panel overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white">
                      {initials(selected.name)}
                    </div>
                    <div>
                      <p className="font-headline text-lg font-bold text-slate-950">
                        {selected.name}
                      </p>
                      <p className="text-xs text-muted">
                        {selected.constitution || "Unknown constitution"} · {getIndustry(selected)}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${priorityTone(
                        selected.priority,
                      )}`}
                    >
                      {selected.priority}
                    </span>
                    <p className="mt-1 font-mono text-[11px] text-muted">{selected.id}</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <FactPill label="Compliance Score" value={`${getScore(selected)}/100`} highlight={scoreTone(getScore(selected))} />
                  <FactPill label="Recent Misses" value={getMisses(selected)} />
                  <FactPill label="Tags" value={(selected.tags || []).length} />
                  <FactPill label="Obligations" value={(selected.active_obligations || []).length} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 p-6 xl:grid-cols-2">
                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                    Client Details
                  </p>
                  <DetailRow label="Client ID" value={selected.id} />
                  <DetailRow label="Constitution" value={selected.constitution} />
                  <DetailRow label="Industry" value={getIndustry(selected)} />
                  <DetailRow label="Priority" value={selected.priority} />
                </div>

                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                    Identifiers
                  </p>
                  {Object.entries(selected.identifiers || {}).filter(([, value]) => value).length ? (
                    Object.entries(selected.identifiers || {})
                      .filter(([, value]) => value)
                      .map(([key, value]) => (
                        <DetailRow key={key} label={key.toUpperCase()} value={value} />
                      ))
                  ) : (
                    <EmptyState message="No identifiers recorded." />
                  )}
                </div>
              </div>

              <div className="border-t border-slate-200 p-6">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted">
                  Regulatory Tags
                </p>
                {(selected.tags || []).length ? (
                  <div className="flex flex-wrap gap-2">
                    {selected.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No tags assigned." />
                )}
              </div>

              {(selected.risk_profile?.high_risk_areas || []).length > 0 ? (
                <div className="border-t border-slate-200 p-6">
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted">
                    High Risk Areas
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selected.risk_profile.high_risk_areas.map((area) => (
                      <span
                        key={area}
                        className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"
                      >
                        <span className="material-symbols-outlined text-sm">warning</span>
                        {area}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="border-t border-slate-200 p-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
                    Active Obligations
                  </p>
                  <span className="text-xs text-muted">
                    {(selected.active_obligations || []).length} total
                  </span>
                </div>

                {(selected.active_obligations || []).length ? (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[540px] text-left">
                      <thead className="border-b border-slate-200 bg-slate-50">
                        <tr>
                          {["Obligation", "Due Date", "Status", "Risk", "Penalty"].map((heading) => (
                            <th
                              key={heading}
                              className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted"
                            >
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {selected.active_obligations.map((obligation) => (
                          <tr key={obligation.id} className="transition hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <p className="text-sm font-semibold text-slate-900">
                                {obligation.type}
                              </p>
                              <p className="font-mono text-[11px] text-muted">{obligation.id}</p>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700">
                              {obligation.due_date}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700">
                              {obligation.status}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${priorityTone(
                                  obligation.risk_level,
                                )}`}
                              >
                                {obligation.risk_level}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted">
                              {obligation.penalty_if_missed || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState message="No active obligations recorded." />
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-10 shadow-panel">
              <EmptyState
                message={loading ? "Loading client data..." : "Select a client to view their profile."}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FactPill({ label, value, highlight }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold ${highlight || "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function FilterSelect({ label, value, options, onChange, isOpen, onToggle, onClose }) {
  return (
    <div className="relative block pt-0">
      <span className="pointer-events-none absolute -top-4 left-3 text-[10px] font-bold uppercase tracking-widest text-muted">
        {label}
      </span>
      <button
        type="button"
        onClick={onToggle}
        className={`flex h-[46px] w-full items-center justify-between rounded-xl border bg-slate-50 px-3 text-sm text-slate-700 outline-none transition ${
          isOpen ? "border-accent bg-white shadow-sm" : "border-line hover:bg-white"
        }`}
      >
        <span className="truncate text-sm font-medium text-slate-800">{value}</span>
        <span
          className={`material-symbols-outlined text-sm text-muted transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          expand_more
        </span>
      </button>

      <div
        className={`absolute left-0 right-0 top-full z-20 mt-2 origin-top rounded-2xl border border-slate-200 bg-white p-1 shadow-xl transition duration-200 ${
          isOpen ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              onChange(option);
              onClose();
            }}
            className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
              option === value
                ? "bg-slate-950 text-white"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
