import { useEffect, useMemo, useState } from "react";

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function normalizeAgent(agent) {
  if (!agent) return "Unknown";
  const known = {
    MonitoringAgent: "Monitoring",
    MatcherAgent: "Matcher",
    DrafterAgent: "Drafter",
    DeadlineWatchAgent: "DeadlineWatchAgent",
  };
  return known[agent] || agent;
}

function categoryTone(agent, action) {
  const combined = `${agent} ${action}`.toLowerCase();
  if (combined.includes("approve") || combined.includes("reject")) return "bg-amber-100 text-amber-800";
  if (combined.includes("draft")) return "bg-sky-100 text-sky-800";
  if (combined.includes("deadline")) return "bg-rose-100 text-rose-800";
  if (combined.includes("match")) return "bg-teal-100 text-teal-800";
  return "bg-slate-100 text-slate-700";
}

function summaryFromEvent(event) {
  const details = event?.details || {};
  if (typeof details.message === "string") return details.message;
  if (typeof details.title === "string") return details.title;
  if (typeof details.client_name === "string") return details.client_name;
  if (typeof details.date === "string") return `Date: ${details.date}`;
  const keys = Object.keys(details);
  if (!keys.length) return "No detail payload available.";
  const firstKey = keys[0];
  return `${firstKey}: ${String(details[firstKey])}`;
}

function filterChipTone(value, current) {
  return value === current
    ? "bg-slate-950 text-white"
    : "bg-slate-100 text-slate-700 hover:bg-slate-200";
}

export default function AuditTrailView({ events, loading }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("All");
  const [selectedTimestamp, setSelectedTimestamp] = useState(null);

  const agentOptions = useMemo(() => {
    const dynamicAgents = [...new Set(events.map((event) => normalizeAgent(event.agent)).filter(Boolean))];
    const preferredOrder = ["Monitoring", "Matcher", "Drafter", "DeadlineWatchAgent"];
    const ordered = preferredOrder.filter((item) => dynamicAgents.includes(item));
    const remainder = dynamicAgents.filter((item) => !preferredOrder.includes(item));
    return ["All", ...ordered, ...remainder];
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      const normalizedAgent = normalizeAgent(event.agent);
      const haystack = [
        normalizedAgent,
        event.action,
        JSON.stringify(event.details || {}),
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = !searchQuery || haystack.includes(searchQuery.toLowerCase());
      const matchesAgent = agentFilter === "All" || normalizedAgent === agentFilter;
      return matchesSearch && matchesAgent;
    });
  }, [events, searchQuery, agentFilter]);

  useEffect(() => {
    if (!filteredEvents.length) {
      setSelectedTimestamp(null);
      return;
    }

    if (
      !selectedTimestamp ||
      !filteredEvents.some((event) => event.timestamp === selectedTimestamp)
    ) {
      setSelectedTimestamp(filteredEvents[0].timestamp);
    }
  }, [filteredEvents, selectedTimestamp]);

  const selectedEvent =
    filteredEvents.find((event) => event.timestamp === selectedTimestamp) || filteredEvents[0] || null;

  const stats = {
    total: events.length,
    monitoring: events.filter((event) => normalizeAgent(event.agent) === "Monitoring").length,
    draft: events.filter((event) =>
      `${event.agent} ${event.action}`.toLowerCase().includes("draft"),
    ).length,
    approval: events.filter((event) => {
      const combined = `${event.agent} ${event.action}`.toLowerCase();
      return combined.includes("approve") || combined.includes("reject");
    }).length,
  };

  return (
    <>
      <section className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <h1 className="font-headline text-4xl font-extrabold tracking-tight text-slate-950">
            Audit Trail
          </h1>
          <p className="mt-3 max-w-2xl text-lg leading-8 text-muted">
            Review system actions, agent activity, and compliance workflow history.
          </p>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-panel">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:items-end">
          <div className="relative xl:col-span-7">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
              search
            </span>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-teal-300 focus:bg-white"
              placeholder="Search agent, action, or event details..."
              type="text"
            />
          </div>

          <div className="xl:col-span-5">
            <FilterRow
              label="Agent"
              options={agentOptions}
              value={agentFilter}
              onChange={setAgentFilter}
            />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard title="Total Events" value={stats.total} meta="All recorded audit events" tone="border-accent" />
        <StatCard title="Monitoring Events" value={stats.monitoring} meta="Monitoring activity history" tone="border-slate-900" />
        <StatCard title="Draft Events" value={stats.draft} meta="Draft generation actions" tone="border-sky-500" />
        <StatCard title="Approval Events" value={stats.approval} meta="Human review decisions" tone="border-amber-500" />
      </section>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
        <section className="space-y-4 xl:col-span-7">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-headline font-bold uppercase tracking-[0.22em] text-slate-500">
              Event Log
            </h3>
            <span className="text-xs font-semibold text-slate-500">
              {filteredEvents.length} visible
            </span>
          </div>

          {filteredEvents.length ? (
            filteredEvents.map((event) => {
              const active = selectedEvent?.timestamp === event.timestamp;
              const agent = normalizeAgent(event.agent);
              return (
                <button
                  key={`${event.timestamp}-${event.action}`}
                  onClick={() => setSelectedTimestamp(event.timestamp)}
                  className={`w-full rounded-3xl border-l-4 bg-white p-5 text-left shadow-panel transition ${
                    active
                      ? "border-amber-400 ring-2 ring-amber-100"
                      : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                        <span className="material-symbols-outlined">history</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-950">{event.action}</p>
                        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                          {agent}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-xs font-semibold text-slate-800">{formatDate(event.timestamp)}</p>
                      <span
                        className={`mt-2 inline-block rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${categoryTone(
                          agent,
                          event.action,
                        )}`}
                      >
                        {agent}
                      </span>
                    </div>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-slate-600">{summaryFromEvent(event)}</p>
                </button>
              );
            })
          ) : (
            <EmptyState
              message={loading ? "Loading audit trail..." : "No audit events match the current filters."}
            />
          )}
        </section>

        <section className="sticky top-24 xl:col-span-5">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-panel">
            {selectedEvent ? (
              <>
                <div className="bg-slate-950 p-6 text-white">
                  <div className="mb-4 flex items-start justify-between">
                    <div className="rounded-xl bg-white/10 p-2">
                      <span className="material-symbols-outlined text-2xl text-amber-300">
                        fingerprint
                      </span>
                    </div>
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-900">
                      Event Detail
                    </span>
                  </div>
                  <h3 className="font-headline text-xl font-bold">
                    {selectedEvent.action}
                  </h3>
                  <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-400">
                    {normalizeAgent(selectedEvent.agent)}
                  </p>
                </div>

                <div className="space-y-6 p-6">
                  <div className="grid grid-cols-2 gap-4">
                    <DetailItem label="Timestamp" value={formatDate(selectedEvent.timestamp)} />
                    <DetailItem label="Agent" value={normalizeAgent(selectedEvent.agent)} />
                    <DetailItem label="Action" value={selectedEvent.action || "Unknown"} />
                    <DetailItem
                      label="Category"
                      value={`${normalizeAgent(selectedEvent.agent)} Event`}
                    />
                  </div>

                  {selectedEvent.user_approval !== null && selectedEvent.user_approval !== undefined ? (
                    <DetailItem
                      label="User Approval"
                      value={selectedEvent.user_approval ? "Approved" : "Not Approved"}
                    />
                  ) : null}

                  {selectedEvent.citation ? (
                    <DetailItem label="Citation" value={selectedEvent.citation} />
                  ) : null}

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                      Payload Data
                    </p>
                    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      {Object.keys(selectedEvent.details || {}).length ? (
                        <div className="space-y-3 text-xs">
                          {Object.entries(selectedEvent.details || {}).map(([key, value]) => (
                            <div key={key} className="flex gap-3">
                              <span className="w-28 flex-shrink-0 font-semibold text-teal-700">
                                {key}
                              </span>
                              <span className="break-words text-slate-700">
                                {renderValue(value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-600">No structured details available.</p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-10">
                <EmptyState message={loading ? "Loading event detail..." : "Select an event to inspect details."} />
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function renderValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function FilterRow({ label, options, value, onChange }) {
  return (
    <div>
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filterChipTone(
              option,
              value,
            )}`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatCard({ title, value, meta, tone }) {
  return (
    <div className={`rounded-2xl border-l-4 ${tone} bg-white p-5 shadow-panel`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <p className="mt-2 font-headline text-3xl font-extrabold text-slate-950">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{meta}</p>
    </div>
  );
}

function DetailItem({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900 break-words">{value}</p>
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
