import { useEffect, useMemo, useState } from "react";
import { EmptyState, FilterChip, StatCard, formatDate } from "@/shared/ui";

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
      {/* Header */}
      <div>
        <h1 className="font-headline text-3xl font-extrabold text-slate-950">Audit Trail</h1>
        <p className="mt-1 text-sm text-muted">Immutable log of every system action, agent decision, and human approval.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard title="Total Events" value={stats.total} tone="border-accent" />
        <StatCard title="Monitoring" value={stats.monitoring} tone="border-emerald-500" />
        <StatCard title="Draft Events" value={stats.drafts} tone="border-sky-500" />
        <StatCard title="Approvals" value={stats.approvals} tone="border-amber-500" />
      </div>

      {/* Filters */}
      <div className="rounded-2xl bg-white p-4 shadow-panel space-y-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-line bg-slate-50 py-2.5 pl-9 pr-4 text-sm outline-none focus:border-accent focus:bg-white"
            placeholder="Search agent, action, or event details..."
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted self-center mr-1">Agent</span>
          {agentOptions.map((o) => (
            <FilterChip key={o} label={o} active={agentFilter === o} onClick={() => setAgentFilter(o)} />
          ))}
        </div>
      </div>

      {/* Split */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">

        {/* Event list */}
        <div className="xl:col-span-7 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-muted">Event Log</span>
            <span className="text-xs text-muted">{filtered.length} events</span>
          </div>

          {filtered.length ? filtered.map((event, idx) => {
            const active = selected?.timestamp === event.timestamp;
            const label = agentLabel(event.agent);
            return (
              <button
                key={`${event.timestamp}-${idx}`}
                onClick={() => setSelectedTs(event.timestamp)}
                className={`w-full rounded-2xl bg-white p-4 text-left shadow-panel transition border-l-4 ${
                  active ? "border-amber-400 ring-1 ring-amber-100" : "border-transparent hover:border-slate-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                    <span className="material-symbols-outlined text-sm text-slate-600">{agentIcon(label)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900">{event.action}</p>
                      <span className="text-[11px] text-muted shrink-0">{formatDate(event.timestamp)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${agentTone(label, event.action)}`}>
                        {label}
                      </span>
                      <p className="text-xs text-muted truncate">{eventSummary(event)}</p>
                    </div>
                  </div>
                </div>
              </button>
            );
          }) : (
            <EmptyState message={loading ? "Loading audit trail..." : "No events match current filters."} />
          )}
        </div>

        {/* Event detail */}
        <div className="xl:col-span-5">
          {selected ? (
            <div className="sticky top-24 rounded-2xl bg-white shadow-panel overflow-hidden">
              <div className="bg-slate-950 p-5 text-white">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
                    <span className="material-symbols-outlined text-amber-300 text-base">
                      {agentIcon(agentLabel(selected.agent))}
                    </span>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-900">
                    {agentLabel(selected.agent)}
                  </span>
                </div>
                <h3 className="font-headline text-lg font-bold">{selected.action}</h3>
                <p className="mt-1 text-xs text-slate-400">{formatDate(selected.timestamp)}</p>
              </div>

              <div className="p-5 space-y-5">
                {/* Key facts */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Agent", value: agentLabel(selected.agent) },
                    { label: "Action", value: selected.action },
                    ...(selected.user_approval !== null && selected.user_approval !== undefined
                      ? [{ label: "Approval", value: selected.user_approval ? "Approved" : "Rejected" }]
                      : []),
                    ...(selected.citation ? [{ label: "Citation", value: selected.citation }] : []),
                  ].map((f) => (
                    <div key={f.label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{f.label}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-900 break-words">{f.value}</p>
                    </div>
                  ))}
                </div>

                {/* Payload */}
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
