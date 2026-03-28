import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionBanner,
  EmptyState,
  StatCard,
  formatCurrency,
  formatDate,
  levelBorder,
  levelText,
  levelTone,
  sourceTone,
} from "@/shared/ui";

const LEVEL_OPTIONS = ["All", "MISSED", "CRITICAL", "WARNING"];

function sourceLabel(source) {
  if (source === "draft") return "Draft";
  if (source === "clients_json") return "Client Profile";
  return "Unknown";
}

function DetailFact({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</p>
      <p className={`mt-1 text-sm font-bold ${tone || "text-slate-900"}`}>{value}</p>
    </div>
  );
}

export default function DeadlineWatchView({
  actionMessage,
  allDeadlines,
  deadlineSummary,
  loading,
  onSendAlert,
}) {
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("All");
  const [clientFilter, setClientFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(null);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [levelMenuOpen, setLevelMenuOpen] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [sentAlerts, setSentAlerts] = useState({});
  const clientMenuRef = useRef(null);
  const levelMenuRef = useRef(null);

  const clientOptions = useMemo(() => {
    const names = [...new Set(allDeadlines.map((alert) => alert.client_name).filter(Boolean))];
    return ["All", ...names];
  }, [allDeadlines]);

  const filtered = useMemo(() => {
    return allDeadlines.filter((alert) => {
      const haystack = [alert.client_name, alert.obligation_type, alert.level]
        .join(" ")
        .toLowerCase();
      const matchSearch = !search || haystack.includes(search.toLowerCase());
      const matchLevel = levelFilter === "All" || alert.level === levelFilter;
      const matchClient = clientFilter === "All" || alert.client_name === clientFilter;
      return matchSearch && matchLevel && matchClient;
    });
  }, [allDeadlines, search, levelFilter, clientFilter]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((alert) => alert.alert_id === selectedId)) {
      setSelectedId(filtered[0].alert_id);
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    function onClickOutside(event) {
      if (clientMenuRef.current && !clientMenuRef.current.contains(event.target)) {
        setClientMenuOpen(false);
      }
      if (levelMenuRef.current && !levelMenuRef.current.contains(event.target)) {
        setLevelMenuOpen(false);
      }
    }

    function onEscape(event) {
      if (event.key === "Escape") {
        setClientMenuOpen(false);
        setLevelMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  const selected = filtered.find((alert) => alert.alert_id === selectedId) || filtered[0] || null;

  const stats = {
    total: allDeadlines.length,
    missed: deadlineSummary?.missed || 0,
    critical: deadlineSummary?.critical || 0,
    warning: deadlineSummary?.warning || 0,
    exposure: deadlineSummary?.total_exposure || 0,
  };

  async function handleSendAlert(alertId) {
    if (sendingId) return;
    setSendingId(alertId);
    try {
      await onSendAlert(alertId);
      setSentAlerts((current) => ({
        ...current,
        [alertId]: new Date().toISOString(),
      }));
      setConfirmingId(null);
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="flex min-h-0 flex-col xl:col-span-4">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-panel">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-widest text-muted">
                Active Alerts
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {filtered.length}
              </span>
            </div>

            <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
              {filtered.length ? (
                filtered.map((alert) => {
                  const active = selected?.alert_id === alert.alert_id;
                  return (
                    <button
                      key={alert.alert_id}
                      onClick={() => setSelectedId(alert.alert_id)}
                      className={`w-full border-l-4 p-4 text-left transition ${
                        active
                          ? `${levelBorder(alert.level)} bg-slate-50`
                          : "border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900">
                            {alert.client_name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted">
                            {alert.obligation_type}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${levelTone(
                            alert.level,
                          )}`}
                        >
                          {alert.level}
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[11px]">
                        <span className="text-slate-600">{alert.due_date}</span>
                        <span className={`font-semibold ${levelText(alert.level)}`}>
                          {alert.exposure?.exposure_label || "No exposure"}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${sourceTone(
                            alert.source,
                          )}`}
                        >
                          {sourceLabel(alert.source)}
                        </span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="p-4">
                  <EmptyState
                    message={loading ? "Loading alerts..." : "No alerts match current filters."}
                  />
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
                  <div>
                    <p className="font-headline text-lg font-bold text-slate-950">
                      {selected.client_name}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-700">
                      {selected.obligation_type}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${levelTone(
                      selected.level,
                    )}`}
                  >
                    {selected.level}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <DetailFact label="Due Date" value={selected.due_date || "-"} />
                  <DetailFact
                    label="Exposure"
                    value={
                      selected.exposure?.exposure_label ||
                      formatCurrency(selected.exposure?.exposure_rupees)
                    }
                  />
                  <DetailFact
                    label="Risk Level"
                    value={selected.risk_level || "-"}
                    tone={levelText(selected.level)}
                  />
                  <DetailFact label="Source" value={sourceLabel(selected.source)} />
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                    Risk reasoning
                  </p>
                  <div
                    className={`rounded-xl border-l-4 ${levelBorder(
                      selected.level,
                    )} bg-slate-50 p-4 text-sm leading-7 text-slate-700`}
                  >
                    {selected.headline ||
                      (selected.level === "MISSED"
                        ? `${selected.obligation_type} is overdue for ${selected.client_name}. Handle immediately to reduce further penalty exposure.`
                        : selected.level === "CRITICAL"
                          ? `${selected.obligation_type} is approaching with material exposure. Prioritize this in the current review cycle.`
                          : `${selected.obligation_type} is upcoming. Early action keeps it out of the critical zone.`)}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                    Recommended action
                  </p>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm leading-7 text-slate-700">
                      {selected.recommended_action ||
                        (selected.level === "MISSED"
                          ? "Confirm filing status immediately, document the miss, and follow up with the client."
                          : selected.level === "CRITICAL"
                            ? "Validate readiness, gather missing information, and escalate before the due date."
                            : "Monitor progress and confirm preparatory steps are underway.")}
                    </p>

                    {onSendAlert ? (
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        {sentAlerts[selected.alert_id] ? (
                          <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800">
                            <span className="material-symbols-outlined text-base">
                              check_circle
                            </span>
                            Sent at{" "}
                            {new Intl.DateTimeFormat("en-IN", { timeStyle: "short" }).format(
                              new Date(sentAlerts[selected.alert_id]),
                            )}
                          </div>
                        ) : confirmingId === selected.alert_id ? (
                          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                            <p className="text-sm font-medium text-slate-700">
                              Send to {selected.client_email || "this client"}?
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleSendAlert(selected.alert_id)}
                                disabled={sendingId === selected.alert_id}
                                className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {sendingId === selected.alert_id ? "Sending..." : "Confirm"}
                              </button>
                              <button
                                onClick={() => setConfirmingId(null)}
                                disabled={sendingId === selected.alert_id}
                                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => setConfirmingId(selected.alert_id)}
                              disabled={!!sendingId}
                              className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Send Alert Email
                            </button>
                            {selected.client_email ? (
                              <span className="text-sm text-slate-600">
                                {selected.client_email}
                              </span>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted">
                    Details
                  </p>
                  <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-2">
                    {[
                      { label: "Client ID", value: selected.client_id },
                      { label: "Penalty", value: selected.penalty || "Not specified" },
                      { label: "Deadline format", value: selected.deadline_format },
                      { label: "Draft ID", value: selected.draft_id },
                      { label: "Generated", value: formatDate(selected.generated_at) },
                      { label: "Contact", value: selected.client_contact },
                    ]
                      .filter((row) => row.value)
                      .map((row) => (
                        <div
                          key={row.label}
                          className="flex justify-between gap-3 border-b border-slate-100 py-2 text-xs"
                        >
                          <span className="text-muted">{row.label}</span>
                          <span className="text-right font-semibold text-slate-900">
                            {row.value}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-10 shadow-panel">
              <EmptyState
                message={loading ? "Loading alerts..." : "Select an alert to see details."}
              />
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
          isOpen
            ? "pointer-events-auto scale-100 opacity-100"
            : "pointer-events-none scale-95 opacity-0"
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
