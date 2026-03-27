import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionBanner,
  EmptyState,
  FilterChip,
  StatCard,
  formatCurrency,
  formatDate,
  levelBorder,
  levelText,
  levelTone,
  sourceTone,
} from "@/shared/ui";

const LEVEL_OPTIONS = ["All", "MISSED", "CRITICAL", "WARNING"];

function sourceLabel(s) {
  if (s === "draft") return "Draft";
  if (s === "clients_json") return "Client Profile";
  return "Unknown";
}

export default function DeadlineWatchView({
  actionMessage,
  allDeadlines,
  deadlineSummary,
  loading,
  onSendAlert,
  onTriggerScan,
}) {
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("All");
  const [clientFilter, setClientFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(null);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const menuRef = useRef(null);

  const clientOptions = useMemo(() => {
    const names = [...new Set(allDeadlines.map((a) => a.client_name).filter(Boolean))];
    return ["All", ...names];
  }, [allDeadlines]);

  const filtered = useMemo(() => {
    return allDeadlines.filter((a) => {
      const hay = [a.client_name, a.obligation_type, a.level].join(" ").toLowerCase();
      const matchSearch = !search || hay.includes(search.toLowerCase());
      const matchLevel = levelFilter === "All" || a.level === levelFilter;
      const matchClient = clientFilter === "All" || a.client_name === clientFilter;
      return matchSearch && matchLevel && matchClient;
    });
  }, [allDeadlines, search, levelFilter, clientFilter]);

  useEffect(() => {
    if (!filtered.length) { setSelectedId(null); return; }
    if (!selectedId || !filtered.some((a) => a.alert_id === selectedId)) {
      setSelectedId(filtered[0].alert_id);
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setClientMenuOpen(false);
    }
    function onEscape(e) { if (e.key === "Escape") setClientMenuOpen(false); }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  const selected = filtered.find((a) => a.alert_id === selectedId) || filtered[0] || null;

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
    await onSendAlert(alertId);
    setSendingId(null);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-extrabold text-slate-950">Deadline Watch</h1>
          <p className="mt-1 text-sm text-muted">Track filing obligations, exposure, and missed deadlines across all clients.</p>
        </div>
        <button
          onClick={onTriggerScan}
          className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition self-start xl:self-auto"
        >
          Trigger Scan
        </button>
      </div>

      <ActionBanner message={actionMessage} />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard title="Total Alerts" value={stats.total} tone="border-slate-400" />
        <StatCard title="Missed" value={stats.missed} tone="border-rose-500" />
        <StatCard title="Critical" value={stats.critical} tone="border-orange-500" />
        <StatCard title="Warning" value={stats.warning} tone="border-amber-400" />
        <StatCard title="Exposure" value={formatCurrency(stats.exposure)} tone="border-accent" />
      </div>

      {/* Filters */}
      <div className="rounded-2xl bg-white p-4 shadow-panel space-y-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-line bg-slate-50 py-2.5 pl-9 pr-4 text-sm outline-none focus:border-accent focus:bg-white"
              placeholder="Search client or obligation..."
            />
          </div>

          {/* Client dropdown */}
          <div ref={menuRef} className="relative xl:w-52">
            <button
              type="button"
              onClick={() => setClientMenuOpen((o) => !o)}
              className="flex h-10 w-full items-center gap-2 rounded-xl border border-line bg-slate-50 px-3 text-sm text-slate-700 hover:bg-white transition"
            >
              <span className="material-symbols-outlined text-sm text-muted">group</span>
              <span className="flex-1 truncate text-left">{clientFilter}</span>
              <span className={`material-symbols-outlined text-sm text-muted transition ${clientMenuOpen ? "rotate-180" : ""}`}>
                expand_more
              </span>
            </button>
            {clientMenuOpen && (
              <div className="absolute right-0 z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                {clientOptions.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => { setClientFilter(opt); setClientMenuOpen(false); }}
                    className={`w-full px-3 py-2 text-left text-sm transition ${
                      opt === clientFilter ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted self-center mr-1">Level</span>
          {LEVEL_OPTIONS.map((o) => (
            <FilterChip key={o} label={o} active={levelFilter === o} onClick={() => setLevelFilter(o)} />
          ))}
        </div>
      </div>

      {/* Split layout */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">

        {/* LEFT — alert list */}
        <div className="xl:col-span-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-muted">Active Alerts</span>
            <span className="text-xs text-muted">{filtered.length} visible</span>
          </div>

          {filtered.length ? filtered.map((alert) => {
            const active = selected?.alert_id === alert.alert_id;
            return (
              <button
                key={alert.alert_id}
                onClick={() => setSelectedId(alert.alert_id)}
                className={`w-full rounded-2xl border-l-4 bg-white p-4 text-left shadow-panel transition ${
                  levelBorder(alert.level)
                } ${active ? "ring-2 ring-teal-100" : "hover:translate-x-0.5"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900 text-sm">{alert.client_name}</p>
                    <p className="text-xs text-muted mt-0.5">{alert.obligation_type}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${levelTone(alert.level)}`}>
                    {alert.level}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  <span className="flex items-center gap-1 text-slate-600">
                    <span className="material-symbols-outlined text-sm">event</span>
                    {alert.due_date}
                  </span>
                  <span className={`flex items-center gap-1 font-semibold ${levelText(alert.level)}`}>
                    <span className="material-symbols-outlined text-sm">monetization_on</span>
                    {alert.exposure?.exposure_label || "—"}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${sourceTone(alert.source)}`}>
                    {sourceLabel(alert.source)}
                  </span>
                </div>
              </button>
            );
          }) : (
            <EmptyState message={loading ? "Loading alerts..." : "No alerts match current filters."} />
          )}
        </div>

        {/* RIGHT — detail panel */}
        <div className="xl:col-span-7">
          {selected ? (
            <div className="sticky top-24 rounded-2xl bg-white shadow-panel overflow-hidden">
              {/* Alert header */}
              <div className={`border-l-4 ${levelBorder(selected.level)} bg-slate-50 border-b border-slate-200 p-6`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-headline text-xl font-extrabold text-slate-950">{selected.client_name}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-700">{selected.obligation_type}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${levelTone(selected.level)}`}>
                    {selected.level}
                  </span>
                </div>

                {/* 4-fact grid */}
                <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                  {[
                    { label: "Due Date", value: selected.due_date || "—" },
                    { label: "Exposure", value: selected.exposure?.exposure_label || formatCurrency(selected.exposure?.exposure_rupees) },
                    { label: "Risk Level", value: selected.risk_level || "—" },
                    { label: "Source", value: sourceLabel(selected.source) },
                  ].map((f) => (
                    <div key={f.label} className="rounded-xl bg-white border border-slate-200 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{f.label}</p>
                      <p className="mt-0.5 text-sm font-bold text-slate-900">{f.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Risk reasoning */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Risk reasoning</p>
                  <div className={`rounded-xl border-l-4 ${levelBorder(selected.level)} bg-slate-50 p-4 text-sm leading-7 text-slate-700`}>
                    {selected.headline ||
                      (selected.level === "MISSED"
                        ? `${selected.obligation_type} is overdue for ${selected.client_name}. Handle immediately to contain further penalty exposure.`
                        : selected.level === "CRITICAL"
                        ? `${selected.obligation_type} deadline is approaching with material exposure. Prioritise in the current review cycle.`
                        : `${selected.obligation_type} is upcoming. Early action keeps this out of the critical zone.`)}
                  </div>
                </div>

                {/* Recommended action + send button */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Recommended action</p>
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                    <p className="text-sm leading-7 text-slate-700">
                      {selected.recommended_action ||
                        (selected.level === "MISSED"
                          ? "Confirm filing status immediately, document the miss, and follow up with the client."
                          : selected.level === "CRITICAL"
                          ? "Validate readiness, gather missing information, and escalate before the due date."
                          : "Monitor progress and confirm preparatory steps are underway.")}
                    </p>

                    {onSendAlert && (
                      <div className="mt-4 flex items-center gap-3">
                        <button
                          onClick={() => handleSendAlert(selected.alert_id)}
                          disabled={!!sendingId}
                          className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {sendingId === selected.alert_id ? "Sending..." : "Send Alert Email"}
                        </button>
                        {selected.client_email && (
                          <p className="text-xs text-muted">→ {selected.client_email}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Metadata */}
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">Details</p>
                  <div className="grid grid-cols-2 gap-x-6">
                    {[
                      { label: "Client ID", value: selected.client_id },
                      { label: "Penalty", value: selected.penalty || "Not specified" },
                      { label: "Deadline format", value: selected.deadline_format },
                      { label: "Draft ID", value: selected.draft_id },
                      { label: "Generated", value: formatDate(selected.generated_at) },
                      { label: "Contact", value: selected.client_contact },
                    ].filter((r) => r.value).map((r) => (
                      <div key={r.label} className="flex justify-between gap-2 py-2 border-b border-slate-100 text-xs">
                        <span className="text-muted">{r.label}</span>
                        <span className="font-semibold text-slate-900 text-right">{r.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white shadow-panel p-10">
              <EmptyState message={loading ? "Loading alerts..." : "Select an alert to see details."} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
