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
  if (urgency === "MISSED") return "bg-rose-100 text-rose-800";
  if (urgency === "CRITICAL") return "bg-red-100 text-red-800";
  if (urgency === "WARNING") return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-800";
}

function rowTone(urgency) {
  if (urgency === "MISSED") return "bg-rose-50/60";
  if (urgency === "CRITICAL") return "bg-red-50/50";
  if (urgency === "WARNING") return "bg-amber-50/50";
  return "bg-white";
}

function filterChipTone(active) {
  return active
    ? "bg-slate-950 text-white"
    : "bg-slate-100 text-slate-700 hover:bg-slate-200";
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

export default function ComplianceCalendarView({ calendarData, loading }) {
  const [regulatorFilter, setRegulatorFilter] = useState("All");
  const [frequencyFilter, setFrequencyFilter] = useState("All");
  const [urgencyOnly, setUrgencyOnly] = useState(false);

  const calendarEntries = calendarData?.calendar || [];

  const regulatorCounts = useMemo(() => {
    const counts = calendarEntries.reduce((acc, entry) => {
      acc[entry.regulator] = (acc[entry.regulator] || 0) + 1;
      return acc;
    }, {});
    return {
      All: calendarEntries.length,
      GST: counts.GST || 0,
      IncomeTax: counts.IncomeTax || 0,
      MCA: counts.MCA || 0,
      RBI: counts.RBI || 0,
      SEBI: counts.SEBI || 0,
    };
  }, [calendarEntries]);

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
    <>
      <section className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <h1 className="font-headline text-4xl font-extrabold tracking-tight text-slate-950">
            Compliance Calendar
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-lg leading-8 text-muted">
              Statutory deadlines for Indian regulatory filings.
            </p>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-slate-600">
              As of {calendarData?.as_of || "Unknown"}
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-panel">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              Regulators
            </span>
            {Object.entries(regulatorCounts).map(([regulator, count]) => (
              <button
                key={regulator}
                onClick={() => setRegulatorFilter(regulator)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filterChipTone(
                  regulatorFilter === regulator,
                )}`}
              >
                {regulator} ({count})
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                Frequency
              </span>
              {["All", "Monthly", "Quarterly", "Annual"].map((frequency) => (
                <button
                  key={frequency}
                  onClick={() => setFrequencyFilter(frequency)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filterChipTone(
                    frequencyFilter === frequency,
                  )}`}
                >
                  {frequency}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={() => setUrgencyOnly(false)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filterChipTone(
                  !urgencyOnly,
                )}`}
              >
                Show All
              </button>
              <button
                onClick={() => setUrgencyOnly(true)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filterChipTone(
                  urgencyOnly,
                )}`}
              >
                Critical & Warning only
              </button>
              <span className="text-xs font-medium text-slate-500">
                Showing <strong>{filteredEntries.length}</strong> of{" "}
                <strong>{calendarData?.total || calendarEntries.length}</strong>
              </span>
            </div>
          </div>
        </div>
      </section>

      {loading && !calendarEntries.length ? (
        <section className="rounded-3xl bg-white p-10 shadow-panel">
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            Loading compliance calendar...
          </div>
        </section>
      ) : !calendarEntries.length ? (
        <section className="rounded-3xl bg-white p-10 shadow-panel">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-700">
            Compliance calendar data is unavailable right now.
          </div>
        </section>
      ) : (
        <>
          <section className="hidden overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-panel xl:block">
            <table className="w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  {["Obligation", "Regulator", "Next Due Date", "Days Left", "Frequency", "Status"].map(
                    (label) => (
                      <th
                        key={label}
                        className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500"
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredEntries.map((entry) => (
                  <tr
                    key={`${entry.regulator}-${entry.obligation}`}
                    className={`${rowTone(entry.urgency)} transition hover:bg-slate-50`}
                  >
                    <td className="px-6 py-5">
                      <p className="text-sm font-bold text-slate-900">{entry.obligation}</p>
                      <p className="mt-1 text-xs text-slate-500">{entry.description}</p>
                    </td>
                    <td className="px-6 py-5">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${regulatorTone(
                          entry.regulator,
                        )}`}
                      >
                        {entry.regulator}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-sm font-semibold text-slate-900">
                      {formatDate(entry.next_due_date)}
                    </td>
                    <td className="px-6 py-5 text-sm font-semibold text-slate-700">
                      {formatDays(entry.days_until)}
                    </td>
                    <td className="px-6 py-5 text-sm text-slate-600">{entry.frequency}</td>
                    <td className="px-6 py-5">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${urgencyTone(
                          entry.urgency,
                        )}`}
                      >
                        {entry.urgency}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:hidden">
            {filteredEntries.map((entry) => (
              <article
                key={`${entry.regulator}-${entry.obligation}`}
                className={`rounded-3xl border border-slate-200 p-5 shadow-panel ${rowTone(entry.urgency)}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-bold text-slate-900">{entry.obligation}</p>
                    <p className="mt-1 text-sm text-slate-500">{entry.description}</p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${urgencyTone(
                      entry.urgency,
                    )}`}
                  >
                    {entry.urgency}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${regulatorTone(
                      entry.regulator,
                    )}`}
                  >
                    {entry.regulator}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700">
                    {entry.frequency}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                      Next Due Date
                    </p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {formatDate(entry.next_due_date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                      Days Left
                    </p>
                    <p className="mt-1 font-semibold text-slate-900">{formatDays(entry.days_until)}</p>
                  </div>
                </div>
              </article>
            ))}
          </section>
        </>
      )}
    </>
  );
}
