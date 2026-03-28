import React, { useMemo, useState } from "react";

function regulatorTone(regulator) {
  const tones = {
    GST: "bg-teal-100 text-teal-800",
    IncomeTax: "bg-amber-100 text-amber-800",
    MCA: "bg-sky-100 text-sky-800",
    RBI: "bg-slate-900 text-white",
    SEBI: "bg-emerald-100 text-emerald-800",
  };
  return tones[regulator] || "bg-slate-100 text-slate-700";
}

function urgencyTone(urgency) {
  if (urgency === "MISSED") return "bg-rose-600 text-white";
  if (urgency === "CRITICAL") return "border border-rose-300 text-rose-700 bg-white";
  if (urgency === "WARNING") return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-800";
}

function rowTone(urgency) {
  if (urgency === "MISSED") return "bg-rose-50/70 hover:bg-rose-50";
  if (urgency === "CRITICAL") return "bg-red-50/40 hover:bg-red-50/60";
  if (urgency === "WARNING") return "bg-amber-50/40 hover:bg-amber-50/70";
  return "bg-white hover:bg-slate-50";
}

function filterTone(active, kind = "pill") {
  if (kind === "square") {
    return active
      ? "bg-teal-700 text-white"
      : "bg-white text-slate-600 hover:bg-slate-100";
  }

  return active
    ? "bg-teal-700 text-white"
    : "bg-slate-200 text-slate-600 hover:bg-slate-300";
}

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
}

function formatDays(daysUntil) {
  if (typeof daysUntil !== "number") return "Unknown";
  if (daysUntil < 0) return `${Math.abs(daysUntil)} days overdue`;
  if (daysUntil === 0) return "Due today";
  if (daysUntil === 1) return "1 day";
  return `${daysUntil} days`;
}

function getClientName(client) {
  return client?.profile?.name || client?.name || "Unknown";
}

function normalizeValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildNeedles(entry) {
  const obligation = normalizeValue(entry?.obligation);
  const regulator = normalizeValue(entry?.regulator);
  const needles = new Set([obligation]);

  const aliases = {
    "gstr 1": ["gst_gstr1", "gstr1"],
    "gstr 3b": ["gst_gstr3b", "gstr3b"],
    "tds": ["tds_24q", "tds_26q", "24q", "26q", "tds return", "form 24q", "form 26q"],
    "tds return": ["tds_24q", "tds_26q", "24q", "26q", "form 24q", "form 26q"],
    "form 24q": ["tds_24q", "24q", "tds"],
    "form 26q": ["tds_26q", "26q", "tds"],
    "pf": ["pf_ecr", "epfo", "pf"],
    "esi": ["esic_return", "esic", "esi"],
    "softex": ["fema_softex", "softex", "export"],
    "export realisation": ["fema", "export", "forex"],
    "fema": ["fema", "softex", "export"],
    "lut": ["lut_renewal", "lut", "export"],
    "llp annual": ["mca_llp11", "mca_llp8", "llp", "form 11", "form 8"],
    "llp form 11": ["mca_llp11", "llp11", "form 11", "llp"],
    "llp form 8": ["mca_llp8", "llp8", "form 8", "llp"],
    "aoc 4": ["mca_aoc4", "aoc4", "aoc 4"],
    "mgt 7": ["mca_mgt7", "mgt7", "mgt 7"],
    "itr": ["it itr filing", "itr", "income tax"],
    "advance tax": ["it_advance_tax", "it_advance_tax_q4", "advance tax"],
    "transfer pricing": ["it_tp_report", "transfer pricing", "tp report"],
    "tp report": ["it_tp_report", "transfer pricing", "tp report"],
    "annual": ["sebi_half_yearly_audit", "sebi", "annual"],
    "half yearly": ["sebi_half_yearly_audit", "half yearly", "sebi"],
    "quarterly": ["quarterly"],
  };

  (aliases[obligation] || []).forEach((value) => needles.add(normalizeValue(value)));
  if (regulator) needles.add(regulator);
  return [...needles].filter(Boolean);
}

function clientMatchesEntry(client, entry) {
  const needles = buildNeedles(entry);
  const haystacks = [
    client?.tags || [],
    (client?.obligations || []).flatMap((obligation) => [
      obligation?.code,
      obligation?.regulator,
      obligation?.status,
      obligation?.frequency,
      ...(obligation?.periods || []),
    ]),
    [
      client?.client_type,
      client?.profile?.constitution,
      client?.profile?.industry,
      client?.notes,
    ],
  ]
    .flat(2)
    .map((value) => normalizeValue(value))
    .filter(Boolean);

  return needles.some((needle) => haystacks.some((value) => value.includes(needle)));
}

function MobileCard({ entry }) {
  return (
    <article className={`rounded-3xl border border-slate-200 p-5 shadow-panel ${rowTone(entry.urgency)}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-bold text-slate-950">{entry.obligation}</p>
          <p className="mt-1 text-sm text-slate-500">{entry.description}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${urgencyTone(entry.urgency)}`}>
          {entry.urgency === "OK" ? "On Track" : entry.urgency}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${regulatorTone(entry.regulator)}`}>
          {entry.regulator}
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700">
          {entry.frequency}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Next Due Date</p>
          <p className="mt-1 font-semibold text-slate-950">{formatDate(entry.next_due_date)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Days Left</p>
          <p className="mt-1 font-semibold text-slate-950">{formatDays(entry.days_until)}</p>
        </div>
      </div>
    </article>
  );
}

export default function ComplianceCalendarView({ calendarData, loading, clients = [], onSelectClient }) {
  const [regulatorFilter, setRegulatorFilter] = useState("All");
  const [frequencyFilter, setFrequencyFilter] = useState("All");
  const [urgencyOnly, setUrgencyOnly] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);

  const calendarEntries = calendarData?.calendar || [];
  const totalEntries = calendarData?.total || calendarEntries.length;
  const hasCalendarData = calendarEntries.length > 0;

  const regulatorCounts = useMemo(() => {
    const counts = calendarEntries.reduce((acc, entry) => {
      acc[entry.regulator] = (acc[entry.regulator] || 0) + 1;
      return acc;
    }, {});

    return {
      All: totalEntries,
      GST: counts.GST || 0,
      IncomeTax: counts.IncomeTax || 0,
      MCA: counts.MCA || 0,
      RBI: counts.RBI || 0,
      SEBI: counts.SEBI || 0,
    };
  }, [calendarEntries, totalEntries]);

  const filteredEntries = useMemo(() => {
    return calendarEntries.filter((entry) => {
      const matchesRegulator =
        regulatorFilter === "All" || entry.regulator === regulatorFilter;
      const matchesFrequency =
        frequencyFilter === "All" || entry.frequency === frequencyFilter;
      const matchesUrgency =
        !urgencyOnly || entry.urgency === "CRITICAL" || entry.urgency === "WARNING";
      return matchesRegulator && matchesFrequency && matchesUrgency;
    });
  }, [calendarEntries, regulatorFilter, frequencyFilter, urgencyOnly]);

  const selectedKey = selectedEntry
    ? `${selectedEntry.regulator}-${selectedEntry.obligation}`
    : null;

  const matchingClients = useMemo(() => {
    if (!selectedEntry) return [];
    return clients.filter((client) => clientMatchesEntry(client, selectedEntry));
  }, [clients, selectedEntry]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      {hasCalendarData ? (
        <section className="shrink-0 rounded-3xl bg-slate-100 p-5 shadow-panel">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                  Regulators
                </span>
                {Object.entries(regulatorCounts).map(([regulator, count]) => (
                  <button
                    key={regulator}
                    onClick={() => setRegulatorFilter(regulator)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filterTone(
                      regulatorFilter === regulator,
                    )}`}
                  >
                    {regulator} ({count})
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                  Frequency
                </span>
                {["All", "Monthly", "Quarterly", "Annual"].map((frequency) => (
                  <button
                    key={frequency}
                    onClick={() => setFrequencyFilter(frequency)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${filterTone(
                      frequencyFilter === frequency,
                      "square",
                    )}`}
                  >
                    {frequency}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4 border-t border-slate-200 pt-4 xl:flex-row xl:items-center xl:justify-between">
              <label className="inline-flex cursor-pointer items-center gap-3">
                <button
                  type="button"
                  onClick={() => setUrgencyOnly((value) => !value)}
                  className={`relative h-5 w-9 rounded-full transition ${
                    urgencyOnly ? "bg-teal-700" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
                      urgencyOnly ? "left-4" : "left-0.5"
                    }`}
                  />
                </button>
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Critical & Warning Only
                </span>
              </label>

              <div className="text-xs font-medium text-slate-500">
                Showing <strong>{filteredEntries.length}</strong> of <strong>{totalEntries}</strong> total obligations
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {loading && !hasCalendarData ? (
        <section className="rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center shadow-panel">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
            <span className="material-symbols-outlined text-slate-500">calendar_month</span>
          </div>
          <p className="mt-4 text-base font-bold text-slate-900">Loading compliance calendar...</p>
          <p className="mt-2 text-sm text-slate-500">
            Pulling statutory deadlines and urgency levels from the backend.
          </p>
        </section>
      ) : !hasCalendarData ? (
        <section className="rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center shadow-panel">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50">
            <span className="material-symbols-outlined text-rose-600">event_busy</span>
          </div>
          <p className="mt-4 text-base font-bold text-slate-900">
            Compliance calendar data is unavailable right now
          </p>
          <p className="mt-2 text-sm text-slate-500">
            The page is wired correctly, but the backend calendar response is empty or failing.
          </p>
        </section>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-panel">
          <div className="flex h-full flex-col overflow-hidden">
            <div className="overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-100">
                  <tr className="border-b border-slate-200">
                    {["Obligation", "Regulator", "Next Due Date", "Days Left", "Frequency", "Status"].map(
                      (label) => (
                        <th
                          key={label}
                          className="px-6 py-4 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500"
                        >
                          {label}
                        </th>
                      ),
                    )}
                    <th className="px-6 py-4" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70">
                  {filteredEntries.map((entry) => {
                    const entryKey = `${entry.regulator}-${entry.obligation}`;
                    const isExpanded = selectedKey === entryKey;
                    return (
                      <React.Fragment key={entryKey}>
                        <tr
                          className={`group cursor-pointer transition ${rowTone(entry.urgency)} ${isExpanded ? "!bg-teal-50" : ""}`}
                          onClick={() => setSelectedEntry(isExpanded ? null : entry)}
                        >
                          <td className="px-6 py-5">
                            <div className="flex items-start gap-3">
                              <div
                                className={`mt-1 h-10 w-1.5 rounded-full ${
                                  entry.urgency === "MISSED"
                                    ? "bg-rose-600"
                                    : entry.urgency === "CRITICAL"
                                      ? "bg-red-400"
                                      : entry.urgency === "WARNING"
                                        ? "bg-amber-400"
                                        : "bg-teal-600"
                                }`}
                              />
                              <div>
                                <span className={`text-left text-sm font-bold transition ${isExpanded ? "text-teal-700" : "text-slate-950 group-hover:text-teal-700"}`}>
                                  {entry.obligation}
                                </span>
                                <p className="mt-1 text-xs font-medium text-slate-500">{entry.description}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <span className={`rounded px-2 py-1 text-[10px] font-bold ${regulatorTone(entry.regulator)}`}>
                              {entry.regulator}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-sm font-semibold text-slate-900">
                            {formatDate(entry.next_due_date)}
                          </td>
                          <td className="px-6 py-5">
                            <span
                              className={`text-sm font-extrabold ${
                                entry.urgency === "MISSED" || entry.urgency === "CRITICAL"
                                  ? "text-rose-600"
                                  : entry.urgency === "WARNING"
                                    ? "text-amber-700"
                                    : "text-slate-900"
                              }`}
                            >
                              {formatDays(entry.days_until)}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-xs font-medium text-slate-500">{entry.frequency}</td>
                          <td className="px-6 py-5">
                            <span className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${urgencyTone(entry.urgency)}`}>
                              {entry.urgency === "CRITICAL" ? <span className="h-2 w-2 rounded-full bg-rose-500" /> : null}
                              {entry.urgency === "OK" ? "On Track" : entry.urgency}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-right">
                            <span className={`material-symbols-outlined text-slate-500 transition ${isExpanded ? "rotate-90" : ""}`}>
                              arrow_forward_ios
                            </span>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr>
                            <td colSpan={7} className="bg-teal-50/60 px-6 py-4">
                              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                                {matchingClients.length} client{matchingClients.length === 1 ? "" : "s"} with this obligation
                              </p>
                              {matchingClients.length ? (
                                <div className="flex flex-wrap gap-2">
                                  {matchingClients.map((client) => (
                                    <button
                                      key={client.id}
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); onSelectClient?.(client.id); }}
                                      className="flex items-center gap-2 rounded-xl border border-teal-200 bg-white px-3 py-2 text-left transition hover:border-teal-400 hover:shadow-sm"
                                    >
                                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-700 text-[10px] font-bold text-white">
                                        {getClientName(client).charAt(0)}
                                      </div>
                                      <div>
                                        <p className="text-xs font-bold text-slate-900">{getClientName(client)}</p>
                                        <p className="text-[10px] text-slate-500">{client?.profile?.constitution || client?.client_type || "Client"}</p>
                                      </div>
                                      <span className="material-symbols-outlined ml-1 text-teal-600" style={{ fontSize: 14 }}>open_in_new</span>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-500">No clients matched this obligation.</p>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Mobile view */}
      <div className="grid grid-cols-1 gap-4 overflow-y-auto xl:hidden">
        {filteredEntries.map((entry) => (
          <button
            key={`${entry.regulator}-${entry.obligation}`}
            type="button"
            onClick={() => setSelectedEntry(entry)}
            className="text-left"
          >
            <MobileCard entry={entry} />
          </button>
        ))}
      </div>
    </div>
  );
}
