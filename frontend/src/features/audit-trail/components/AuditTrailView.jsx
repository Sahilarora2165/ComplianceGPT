import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, StatCard, formatDate } from "@/shared/ui";

function agentLabel(agent) {
  const map = {
    MonitoringAgent: "Monitoring",
    MatcherAgent: "Matcher",
    DrafterAgent: "Drafter",
    DeadlineWatchAgent: "Deadline",
    Orchestrator: "Orchestrator",
    ClientMatcher: "Matcher",
  };
  return map[agent] || agent || "Unknown";
}

function agentTone(agent, action) {
  const combined = `${agent} ${action}`.toLowerCase();
  if (combined.includes("approv") || combined.includes("reject")) return "bg-amber-100 text-amber-800";
  if (combined.includes("draft")) return "bg-sky-100 text-sky-800";
  if (combined.includes("deadline")) return "bg-rose-100 text-rose-800";
  if (combined.includes("match")) return "bg-teal-100 text-teal-800";
  if (combined.includes("monitor") || combined.includes("pipeline")) return "bg-emerald-100 text-emerald-800";
  return "bg-slate-100 text-slate-600";
}

function agentIcon(agent) {
  const a = (agent || "").toLowerCase();
  if (a.includes("monitor")) return "radar";
  if (a.includes("match") || a.includes("client")) return "join_inner";
  if (a.includes("draft")) return "edit_document";
  if (a.includes("deadline")) return "alarm";
  if (a.includes("orchestrat")) return "account_tree";
  return "history";
}

function eventSummary(event) {
  const d = event?.details || {};
  if (d.client_name) return d.client_name;
  if (d.circular) return d.circular;
  if (d.message) return d.message;
  if (d.title) return d.title;
  const keys = Object.keys(d);
  if (keys.length) return `${keys[0]}: ${String(d[keys[0]])}`;
  return "No details available.";
}

function renderValue(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export default function AuditTrailView({ events, loading }) {
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("All");
  const [selectedTs, setSelectedTs] = useState(null);
  const [openDropdown, setOpenDropdown] = useState(false);
  const filterRef = useRef(null);

  const agentOptions = useMemo(() => {
    const labels = [...new Set(events.map((e) => agentLabel(e.agent)).filter(Boolean))];
    const order = ["Monitoring", "Matcher", "Drafter", "Deadline", "Orchestrator"];
    const sorted = [...order.filter((l) => labels.includes(l)), ...labels.filter((l) => !order.includes(l))];
    return ["All", ...sorted];
  }, [events]);

  const filtered = useMemo(() =>
    events.filter((e) => {
      const hay = [agentLabel(e.agent), e.action, JSON.stringify(e.details || {})].join(" ").toLowerCase();
      return (
        (!search || hay.includes(search.toLowerCase())) &&
        (agentFilter === "All" || agentLabel(e.agent) === agentFilter)
      );
    }),
  [events, search, agentFilter]);

  useEffect(() => {
    if (!filtered.length) { setSelectedTs(null); return; }
    if (!selectedTs || !filtered.some((e) => e.timestamp === selectedTs)) {
      setSelectedTs(filtered[0].timestamp);
    }
  }, [filtered, selectedTs]);

  useEffect(() => {
    function onClickOutside(event) {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setOpenDropdown(false);
      }
    }

    function onEscape(event) {
      if (event.key === "Escape") {
        setOpenDropdown(false);
      }
    }

    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);

    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  const selected = filtered.find((e) => e.timestamp === selectedTs) || filtered[0] || null;

  const stats = {
    total: events.length,
    monitoring: events.filter((e) => agentLabel(e.agent) === "Monitoring").length,
    drafts: events.filter((e) => `${e.agent} ${e.action}`.toLowerCase().includes("draft")).length,
    approvals: events.filter((e) => {
      const s = `${e.agent} ${e.action}`.toLowerCase();
      return s.includes("approv") || s.includes("reject");
    }).length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-muted">
            Workflow Traceability
          </p>
          <h1 className="font-headline text-[2.15rem] font-extrabold leading-tight tracking-tight text-slate-950">
            Audit Trail
          </h1>
          <p className="text-sm text-slate-600">
            Immutable log of every system action, agent decision, and human approval.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard title="Total" value={stats.total} tone="border-slate-400" />
          <StatCard title="Monitoring" value={stats.monitoring} tone="border-emerald-500" />
          <StatCard title="Draft Events" value={stats.drafts} tone="border-sky-500" />
          <StatCard title="Approvals" value={stats.approvals} tone="border-amber-500" />
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
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-line bg-slate-50 py-2.5 pl-9 pr-4 text-sm outline-none focus:border-accent focus:bg-white"
              placeholder="Search agent, action, or event details..."
            />
          </div>

          <div ref={filterRef} className="xl:w-[220px] xl:self-center">
            <FilterSelect
              label="Agent"
              value={agentFilter}
              options={agentOptions}
              isOpen={openDropdown}
              onToggle={() => setOpenDropdown((current) => !current)}
              onChange={setAgentFilter}
              onClose={() => setOpenDropdown(false)}
            />
          </div>
        </div>
      </div>

      {/* Split */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">

        <div className="xl:col-span-4">
          <div className="rounded-2xl bg-white shadow-panel overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-widest text-muted">Event Log</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {filtered.length}
              </span>
            </div>

            <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-100">
              {filtered.length ? filtered.map((event, idx) => {
                const active = selected?.timestamp === event.timestamp;
                const label = agentLabel(event.agent);
                return (
                  <button
                    key={`${event.timestamp}-${idx}`}
                    onClick={() => setSelectedTs(event.timestamp)}
                    className={`w-full border-l-4 p-4 text-left transition ${
                      active
                        ? "border-amber-400 bg-slate-50"
                        : "border-transparent hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${agentTone(label, event.action)}`}>
                        {label}
                      </span>
                      <span className="text-[11px] text-muted shrink-0">{formatDate(event.timestamp)}</span>
                    </div>
                    <p className="mt-2 text-sm font-bold text-slate-900 leading-snug">{event.action}</p>
                    <p className="mt-0.5 text-xs text-muted truncate">{eventSummary(event)}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm text-slate-400">
                        {agentIcon(label)}
                      </span>
                    </div>
                  </button>
                );
              }) : (
                <div className="p-4">
                  <EmptyState message={loading ? "Loading audit trail..." : "No events match current filters."} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="xl:col-span-8">
          {selected ? (
            <div className="rounded-2xl bg-white shadow-panel overflow-hidden">
              <div className="bg-slate-50 border-b border-slate-200 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white shrink-0">
                      {agentIcon(agentLabel(selected.agent))}
                    </div>
                    <div>
                      <p className="font-headline text-lg font-bold text-slate-950">{selected.action}</p>
                      <p className="text-xs text-muted">{formatDate(selected.timestamp)}</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${agentTone(agentLabel(selected.agent), selected.action)}`}>
                      {agentLabel(selected.agent)}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                  {[
                    { label: "Agent", value: agentLabel(selected.agent) },
                    { label: "Action", value: selected.action },
                    ...(selected.user_approval !== null && selected.user_approval !== undefined
                      ? [{ label: "Approval", value: selected.user_approval ? "Approved" : "Rejected" }]
                      : []),
                    ...(selected.citation ? [{ label: "Citation", value: selected.citation }] : []),
                  ].map((f) => (
                    <div key={f.label} className="rounded-xl bg-white border border-slate-200 px-3 py-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{f.label}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-900 break-words">{f.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-6 space-y-6">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Payload</p>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    {Object.keys(selected.details || {}).length ? (
                      <div className="space-y-2">
                        {Object.entries(selected.details).map(([k, v]) => (
                          <div key={k} className="flex gap-3 text-xs">
                            <span className="w-28 shrink-0 font-bold text-accent">{k}</span>
                            <span className="break-words text-slate-700">{renderValue(v)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted">No payload data.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white shadow-panel p-10">
              <EmptyState message={loading ? "Loading..." : "Select an event to inspect details."} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, options, isOpen, onToggle, onChange, onClose }) {
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
        <span className={`material-symbols-outlined text-sm text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}>
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
