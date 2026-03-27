import { useEffect, useMemo, useRef, useState } from "react";

function levelTone(level) {
  if (level === "MISSED") return "bg-rose-100 text-rose-800";
  if (level === "CRITICAL") return "bg-orange-100 text-orange-800";
  return "bg-amber-100 text-amber-800";
}

function borderTone(level) {
  if (level === "MISSED") return "border-rose-500";
  if (level === "CRITICAL") return "border-orange-500";
  return "border-amber-500";
}

function textTone(level) {
  if (level === "MISSED") return "text-rose-700";
  if (level === "CRITICAL") return "text-orange-700";
  return "text-amber-700";
}

function sourceTone(source) {
  if (source === "draft") return "bg-sky-100 text-sky-800";
  if (source === "clients_json") return "bg-emerald-100 text-emerald-800";
  return "bg-slate-100 text-slate-700";
}

function sourceLabel(source) {
  if (source === "draft") return "Generated Draft";
  if (source === "clients_json") return "Client Profile";
  return "Unknown Source";
}

function filterChipTone(value, current) {
  return value === current
    ? "bg-slate-950 text-white"
    : "bg-slate-100 text-slate-700 hover:bg-slate-200";
}

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatCurrency(value) {
  if (typeof value !== "number") return "Rs 0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function DeadlineWatchView({
  actionMessage,
  allDeadlines,
  deadlineSummary,
  loading,
  onSendAlert,
  onTriggerScan,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("All");
  const [clientFilter, setClientFilter] = useState("All");
  const [selectedAlertId, setSelectedAlertId] = useState(null);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const clientMenuRef = useRef(null);

  const clientOptions = useMemo(() => {
    const names = [...new Set(allDeadlines.map((alert) => alert.client_name).filter(Boolean))];
    return ["All", ...names];
  }, [allDeadlines]);

  const filteredAlerts = useMemo(() => {
    return allDeadlines.filter((alert) => {
      const haystack = [
        alert.client_name,
        alert.obligation_type,
        alert.level,
        alert.client_id,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = !searchQuery || haystack.includes(searchQuery.toLowerCase());
      const matchesLevel = levelFilter === "All" || alert.level === levelFilter;
      const matchesClient = clientFilter === "All" || alert.client_name === clientFilter;
      return matchesSearch && matchesLevel && matchesClient;
    });
  }, [allDeadlines, searchQuery, levelFilter, clientFilter]);

  useEffect(() => {
    if (!filteredAlerts.length) {
      setSelectedAlertId(null);
      return;
    }

    if (!selectedAlertId || !filteredAlerts.some((alert) => alert.alert_id === selectedAlertId)) {
      setSelectedAlertId(filteredAlerts[0].alert_id);
    }
  }, [filteredAlerts, selectedAlertId]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (clientMenuRef.current && !clientMenuRef.current.contains(event.target)) {
        setClientMenuOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setClientMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const selectedAlert =
    filteredAlerts.find((alert) => alert.alert_id === selectedAlertId) || filteredAlerts[0] || null;

  const stats = {
    total: allDeadlines.length,
    missed: deadlineSummary?.missed || 0,
    critical: deadlineSummary?.critical || 0,
    warning: deadlineSummary?.warning || 0,
    exposure: deadlineSummary?.total_exposure || 0,
  };

  return (
    <>
      <section className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <h1 className="font-headline text-4xl font-extrabold tracking-tight text-slate-950">
            Deadline Watch
          </h1>
          <p className="mt-3 max-w-2xl text-lg leading-8 text-muted">
            Track filing risk, upcoming obligations, and exposure across clients.
          </p>
        </div>

        <button
          onClick={onTriggerScan}
          className="rounded-xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Trigger Deadline Scan
        </button>
      </section>

      {actionMessage ? (
        <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
          {actionMessage}
        </div>
      ) : null}

      <section className="rounded-3xl bg-white p-5 shadow-panel">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:items-start">
          <div className="xl:col-span-8">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                search
              </span>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 py-0 pl-10 pr-4 text-sm outline-none transition focus:border-teal-300 focus:bg-white"
                placeholder="Search client, obligation, or alert level..."
                type="text"
              />
            </div>
          </div>

          <div className="xl:col-span-4 xl:self-start">
            <div ref={clientMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setClientMenuOpen((open) => !open)}
                className={`flex h-14 w-full items-center gap-3 rounded-2xl border px-4 py-0 text-left transition duration-200 ${
                  clientMenuOpen
                    ? "border-teal-300 bg-white shadow-lg shadow-teal-100/60"
                    : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                }`}
              >
                <span className="material-symbols-outlined text-slate-500">group</span>
                <span className="flex-1 text-sm font-medium text-slate-800">{clientFilter}</span>
                <span
                  className={`material-symbols-outlined text-slate-500 transition duration-200 ${
                    clientMenuOpen ? "rotate-180" : ""
                  }`}
                >
                  expand_more
                </span>
              </button>

              <div
                className={`absolute right-0 z-20 mt-2 w-full origin-top rounded-2xl border border-slate-200 bg-white p-2 shadow-xl transition duration-200 ${
                  clientMenuOpen
                    ? "pointer-events-auto translate-y-0 opacity-100"
                    : "pointer-events-none -translate-y-1 opacity-0"
                }`}
              >
                {clientOptions.map((option) => {
                  const active = option === clientFilter;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setClientFilter(option);
                        setClientMenuOpen(false);
                      }}
                      className={`flex w-full items-center rounded-xl px-3 py-2.5 text-sm transition ${
                        active
                          ? "bg-slate-950 text-white"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="xl:col-span-8 -mt-1">
            <FilterRow
              label={null}
              options={["All", "MISSED", "CRITICAL", "WARNING"]}
              value={levelFilter}
              onChange={setLevelFilter}
            />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <StatCard title="Total Alerts" value={stats.total} meta="Current deadline snapshot" tone="border-slate-900" />
        <StatCard title="Missed" value={stats.missed} meta="Immediate attention required" tone="border-rose-500" />
        <StatCard title="Critical" value={stats.critical} meta="High near-term exposure" tone="border-orange-500" />
        <StatCard title="Warning" value={stats.warning} meta="Upcoming filing risk" tone="border-amber-500" />
        <StatCard
          title="Exposure At Risk"
          value={formatCurrency(stats.exposure)}
          meta="Aggregated from alert exposure"
          tone="border-accent"
        />
      </section>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
        <section className="space-y-4 xl:col-span-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-headline font-bold uppercase tracking-[0.22em] text-slate-500">
              Active Alerts
            </h3>
            <span className="text-xs font-semibold text-slate-500">
              {filteredAlerts.length} visible
            </span>
          </div>

          {filteredAlerts.length ? (
            filteredAlerts.map((alert) => {
              const active = selectedAlert?.alert_id === alert.alert_id;
              return (
                <button
                  key={alert.alert_id}
                  onClick={() => setSelectedAlertId(alert.alert_id)}
                  className={`w-full rounded-3xl border-l-4 bg-white p-5 text-left shadow-panel transition ${
                    active
                      ? `${borderTone(alert.level)} ring-2 ring-teal-100`
                      : `${borderTone(alert.level)} border-opacity-50 hover:translate-x-1`
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-headline text-lg font-extrabold text-slate-950">
                          {alert.client_name}
                        </h4>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${sourceTone(
                            alert.source,
                          )}`}
                        >
                          {sourceLabel(alert.source)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-slate-600">
                        {alert.obligation_type}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${levelTone(
                        alert.level,
                      )}`}
                    >
                      {alert.level}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
                    <div className="flex flex-wrap items-center gap-4">
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-sm">event</span>
                        {alert.due_date}
                      </span>
                      <span className={`flex items-center gap-1 font-bold ${textTone(alert.level)}`}>
                        <span className="material-symbols-outlined text-sm">warning</span>
                        {alert.exposure?.exposure_label || "Exposure not available"}
                      </span>
                    </div>
                    <span className="italic text-slate-500">{formatDate(alert.generated_at)}</span>
                  </div>

                  <p className={`mt-4 rounded-2xl p-3 text-xs font-medium ${levelTone(alert.level)}`}>
                    {alert.headline ||
                      (alert.level === "MISSED"
                        ? "Obligation is already overdue. Immediate resolution is recommended."
                        : alert.level === "CRITICAL"
                          ? "Deadline is close and exposure is significant."
                          : "Upcoming obligation should be reviewed before due date.")}
                  </p>
                </button>
              );
            })
          ) : (
            <EmptyState
              message={loading ? "Loading deadline alerts..." : "No deadline alerts match the current filters."}
            />
          )}
        </section>

        <section className="sticky top-24 xl:col-span-7">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-panel">
            {selectedAlert ? (
              <>
                <div className="border-b border-slate-200 bg-slate-50 p-8">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-headline text-2xl font-extrabold text-slate-950">
                          {selectedAlert.client_name}
                        </h2>
                        <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white">
                          ID: {selectedAlert.client_id}
                        </span>
                      </div>
                      <p className="mt-2 text-base font-semibold text-slate-700">
                        {selectedAlert.obligation_type}
                      </p>
                    </div>

                    <span
                      className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] ${levelTone(
                        selectedAlert.level,
                      )}`}
                    >
                      {selectedAlert.level}
                    </span>
                  </div>
                </div>

                <div className="p-8">
                  <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                    <MetaCard label="Due Date" value={selectedAlert.due_date || "Unknown"} tone="bg-slate-50" />
                    <MetaCard label="Level" value={selectedAlert.level || "Unknown"} tone="bg-slate-50" />
                    <MetaCard
                      label="Exposure"
                      value={selectedAlert.exposure?.exposure_label || formatCurrency(selectedAlert.exposure?.exposure_rupees)}
                      tone="bg-rose-50"
                    />
                    <MetaCard
                      label="Generated At"
                      value={formatDate(selectedAlert.generated_at)}
                      tone="bg-slate-50"
                    />
                  </div>

                  <div className="mt-8 space-y-8">
                    <section>
                      <div className="mb-3 flex items-center gap-2">
                        <span className="material-symbols-outlined text-accent">psychology</span>
                        <h3 className="text-[11px] font-headline font-bold uppercase tracking-[0.2em] text-slate-500">
                          Risk Reasoning
                        </h3>
                      </div>
                      <div className={`rounded-2xl border-l-4 p-5 ${borderTone(selectedAlert.level)} bg-slate-50`}>
                        <p className="text-sm leading-7 text-slate-700">
                          {selectedAlert.headline ||
                            (selectedAlert.level === "MISSED"
                              ? `${selectedAlert.obligation_type} is past due for ${selectedAlert.client_name}. The current exposure suggests the filing should be handled immediately to contain further risk.`
                              : selectedAlert.level === "CRITICAL"
                                ? `${selectedAlert.obligation_type} is approaching due date with material exposure. This alert should be prioritized in the current review cycle.`
                                : `${selectedAlert.obligation_type} is upcoming for ${selectedAlert.client_name}. This is an early warning to complete the obligation before it turns critical.`)}
                        </p>
                      </div>
                    </section>

                    <section>
                      <div className="mb-3 flex items-center gap-2">
                        <span className="material-symbols-outlined text-accent">assignment_turned_in</span>
                        <h3 className="text-[11px] font-headline font-bold uppercase tracking-[0.2em] text-slate-500">
                          Recommended Action
                        </h3>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                        <p className="text-sm leading-7 text-slate-700">
                          {selectedAlert.recommended_action ||
                            (selectedAlert.level === "MISSED"
                              ? "Confirm filing status immediately, document the miss, and prioritize the client follow-up."
                              : selectedAlert.level === "CRITICAL"
                                ? "Validate readiness, gather any missing information, and escalate within the CA team before the due date."
                                : "Monitor progress, confirm preparatory steps, and keep the obligation in the active watchlist.")}
                        </p>
                        {onSendAlert ? (
                          <div className="mt-5 flex flex-wrap gap-3">
                            <button
                              onClick={() => onSendAlert(selectedAlert.alert_id)}
                              className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                            >
                              Send Alert Email
                            </button>
                            {selectedAlert.advisory_email?.subject ? (
                              <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600">
                                Draft subject ready
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </section>

                    <section className="grid grid-cols-1 gap-8 border-t border-slate-200 pt-8 xl:grid-cols-2">
                      <div>
                        <h3 className="text-[11px] font-headline font-bold uppercase tracking-[0.2em] text-slate-500">
                          Metadata
                        </h3>
                        <div className="mt-4 space-y-3 text-sm">
                          <MetadataRow label="Client Name" value={selectedAlert.client_name} />
                          <MetadataRow label="Client ID" value={selectedAlert.client_id} />
                          <MetadataRow label="Obligation" value={selectedAlert.obligation_type} />
                          <MetadataRow label="Level" value={selectedAlert.level} />
                          <MetadataRow
                            label="Risk Level"
                            value={selectedAlert.risk_level || "Unknown"}
                          />
                          <MetadataRow
                            label="Penalty"
                            value={selectedAlert.penalty || "Not specified"}
                          />
                          <MetadataRow
                            label="Source"
                            value={sourceLabel(selectedAlert.source)}
                          />
                          {selectedAlert.draft_id ? (
                            <MetadataRow label="Draft ID" value={selectedAlert.draft_id} />
                          ) : null}
                          {selectedAlert.deadline_format ? (
                            <MetadataRow
                              label="Deadline Format"
                              value={selectedAlert.deadline_format}
                            />
                          ) : null}
                        </div>
                      </div>

                      <div className="xl:text-right">
                        <p className="text-[11px] font-headline font-bold uppercase tracking-[0.2em] text-slate-500">
                          Exposure Value
                        </p>
                        <p className="mt-4 text-2xl font-headline font-extrabold text-slate-950">
                          {formatCurrency(selectedAlert.exposure?.exposure_rupees)}
                        </p>
                        <p className="mt-2 text-sm text-slate-600">
                          {selectedAlert.exposure?.exposure_label || "No exposure label available"}
                        </p>
                        {selectedAlert.client_email ? (
                          <p className="mt-4 text-sm text-slate-600">
                            Client email: {selectedAlert.client_email}
                          </p>
                        ) : null}
                        {selectedAlert.client_contact ? (
                          <p className="mt-1 text-sm text-slate-600">
                            Contact: {selectedAlert.client_contact}
                          </p>
                        ) : null}
                      </div>
                    </section>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-10">
                <EmptyState message={loading ? "Loading alert details..." : "Select an alert to inspect details."} />
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function FilterRow({ label, options, value, onChange }) {
  return (
    <div>
      {label ? (
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</span>
      ) : null}
      <div className={`${label ? "mt-3" : ""} flex flex-wrap gap-2`}>
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

function MetaCard({ label, value, tone }) {
  return (
    <div className={`rounded-2xl ${tone} p-4`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-bold text-slate-900">{value}</p>
    </div>
  );
}

function MetadataRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
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
