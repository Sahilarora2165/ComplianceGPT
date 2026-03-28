import { useEffect, useMemo, useState } from "react";
import { EmptyState, formatDate } from "@/shared/ui";

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
  const [selectedTs, setSelectedTs] = useState(null);

  const filtered = useMemo(() => events, [events]);

  useEffect(() => {
    if (!filtered.length) { setSelectedTs(null); return; }
    if (!selectedTs || !filtered.some((e) => e.timestamp === selectedTs)) {
      setSelectedTs(filtered[0].timestamp);
    }
  }, [filtered, selectedTs]);

  const selected = filtered.find((e) => e.timestamp === selectedTs) || filtered[0] || null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="flex min-h-0 flex-col xl:col-span-4">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-panel">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-widest text-muted">Event Log</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {filtered.length}
              </span>
            </div>

            <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
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
                      <span className="shrink-0 text-[11px] text-muted">{formatDate(event.timestamp)}</span>
                    </div>
                    <p className="mt-2 text-sm font-bold leading-snug text-slate-900">{event.action}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">{eventSummary(event)}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm text-slate-400">
                        {agentIcon(label)}
                      </span>
                    </div>
                  </button>
                );
              }) : (
                <div className="p-4">
                  <EmptyState message={loading ? "Loading audit trail..." : "No events found."} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col xl:col-span-8">
          {selected ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-panel">
              <div className="border-b border-slate-200 bg-slate-50 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
                      {agentIcon(agentLabel(selected.agent))}
                    </div>
                    <div>
                      <p className="font-headline text-lg font-bold text-slate-950">{selected.action}</p>
                      <p className="text-xs text-muted">{formatDate(selected.timestamp)}</p>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
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
                    <div key={f.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{f.label}</p>
                      <p className="mt-1 break-words text-xs font-semibold text-slate-900">{f.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">Payload</p>
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
            <div className="rounded-2xl bg-white p-10 shadow-panel">
              <EmptyState message={loading ? "Loading..." : "Select an event to inspect details."} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
