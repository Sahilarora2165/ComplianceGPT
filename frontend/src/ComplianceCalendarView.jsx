import { useMemo, useState } from "react";

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

export default function ComplianceCalendarView({ calendarData, loading }) {
  const [regulatorFilter, setRegulatorFilter] = useState("All");
  const [frequencyFilter, setFrequencyFilter] = useState("All");
  const [urgencyOnly, setUrgencyOnly] = useState(false);

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

  return (
    <div className="space-y-8">
      {hasCalendarData ? (
        <section className="rounded-3xl bg-slate-100 p-5 shadow-panel">
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
        <>
          <section className="hidden overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-panel xl:block">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100">
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
                {filteredEntries.map((entry) => (
                  <tr key={`${entry.regulator}-${entry.obligation}`} className={`group transition ${rowTone(entry.urgency)}`}>
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
                          <p className="text-sm font-bold text-slate-950">{entry.obligation}</p>
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
                      <span className="material-symbols-outlined opacity-0 transition group-hover:opacity-100 text-slate-500">
                        arrow_forward_ios
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:hidden">
            {filteredEntries.map((entry) => (
              <MobileCard key={`${entry.regulator}-${entry.obligation}`} entry={entry} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
