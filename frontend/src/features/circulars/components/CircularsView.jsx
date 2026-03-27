import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionBanner,
  EmptyState,
  priorityTone,
  regulatorTone,
} from "@/shared/ui";

const REGULATOR_OPTIONS = ["All", "RBI", "GST", "IncomeTax", "MCA", "SEBI"];
const PRIORITY_OPTIONS = ["All", "HIGH", "MEDIUM", "LOW"];

function statusTone(status) {
  if (status === "drafted") return "bg-emerald-100 text-emerald-800";
  if (status === "matched") return "bg-sky-100 text-sky-800";
  return "bg-slate-100 text-slate-600";
}

function statusFromItem(item, draftCount) {
  if (draftCount > 0) return "drafted";
  if ((item.match_count || 0) > 0) return "matched";
  return "detected";
}

export default function CircularsView({
  actionMessage,
  allCirculars,
  allDrafts,
  loading,
  pipeline,
}) {
  const [search, setSearch] = useState("");
  const [regFilter, setRegFilter] = useState("All");
  const [priFilter, setPriFilter] = useState("All");
  const [selectedTitle, setSelectedTitle] = useState(null);
  const [openDropdown, setOpenDropdown] = useState(null);
  const filterRef = useRef(null);

  const sourceMap = useMemo(() => {
    const docs = pipeline?.new_documents || [];
    return new Map(docs.map((d) => [d.title, d.source || "unknown"]));
  }, [pipeline]);

  const circulars = useMemo(
    () =>
      allCirculars.map((item) => {
        const draftCount = allDrafts.filter(
          (d) => d.circular_title === item.circular_title,
        ).length;
        return {
          ...item,
          draftCount,
          source: sourceMap.get(item.circular_title) || "unknown",
          status: statusFromItem(item, draftCount),
        };
      }),
    [allCirculars, allDrafts, sourceMap],
  );

  const filtered = useMemo(
    () =>
      circulars.filter((item) => {
        const hay = `${item.circular_title} ${item.summary} ${item.regulator}`.toLowerCase();
        return (
          (!search || hay.includes(search.toLowerCase())) &&
          (regFilter === "All" || item.regulator === regFilter) &&
          (priFilter === "All" || item.priority === priFilter)
        );
      }),
    [circulars, search, regFilter, priFilter],
  );

  useEffect(() => {
    if (!filtered.length) {
      setSelectedTitle(null);
      return;
    }
    if (!selectedTitle || !filtered.some((i) => i.circular_title === selectedTitle)) {
      setSelectedTitle(filtered[0].circular_title);
    }
  }, [filtered, selectedTitle]);

  useEffect(() => {
    function onClickOutside(event) {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setOpenDropdown(null);
      }
    }

    function onEscape(event) {
      if (event.key === "Escape") {
        setOpenDropdown(null);
      }
    }

    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  const selected =
    filtered.find((i) => i.circular_title === selectedTitle) || filtered[0] || null;

  const summary = useMemo(() => {
    return {
      total: circulars.length,
      highPriority: circulars.filter((item) => item.priority === "HIGH").length,
      matchedClients: circulars.reduce((sum, item) => sum + (item.match_count || 0), 0),
      drafted: circulars.filter((item) => item.draftCount > 0).length,
    };
  }, [circulars]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-muted">
            Circular Intelligence
          </p>
          <h1 className="font-headline text-[2.15rem] font-extrabold leading-tight tracking-tight text-slate-950">
            Circulars Monitor
          </h1>
          <p className="text-sm text-slate-600">
            Track regulator updates, assess client impact, and route actions.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            { title: "Total", value: summary.total, tone: "border-slate-400" },
            { title: "High Priority", value: summary.highPriority, tone: "border-rose-500" },
            { title: "Matched Clients", value: summary.matchedClients, tone: "border-accent" },
            { title: "Drafted", value: summary.drafted, tone: "border-emerald-500" },
          ].map((item) => (
            <div
              key={item.title}
              className={`rounded-2xl border-l-4 ${item.tone} bg-white px-4 py-4 shadow-panel`}
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                {item.title}
              </p>
              <p className="mt-2 font-headline text-2xl font-extrabold text-slate-950">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      <ActionBanner message={actionMessage} />

      <div className="rounded-2xl bg-white px-4 py-4 shadow-panel">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="relative min-w-0 flex-[1.35]">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">
              search
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-[46px] w-full rounded-xl border border-line bg-slate-50 pl-9 pr-4 text-sm outline-none focus:border-accent focus:bg-white"
              placeholder="Search circular title, regulator, or summary..."
            />
          </div>

          <div ref={filterRef} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:w-[320px]">
            <FilterSelect
              label="Regulator"
              value={regFilter}
              options={REGULATOR_OPTIONS}
              onChange={setRegFilter}
              isOpen={openDropdown === "regulator"}
              onToggle={() => setOpenDropdown((current) => current === "regulator" ? null : "regulator")}
              onClose={() => setOpenDropdown(null)}
            />
            <FilterSelect
              label="Priority"
              value={priFilter}
              options={PRIORITY_OPTIONS}
              onChange={setPriFilter}
              isOpen={openDropdown === "priority"}
              onToggle={() => setOpenDropdown((current) => current === "priority" ? null : "priority")}
              onClose={() => setOpenDropdown(null)}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-3 xl:col-span-7">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-muted">
              {filtered.length} circular{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>

          {filtered.length ? (
            filtered.map((item) => {
              const active = selected?.circular_title === item.circular_title;
              return (
                <button
                  key={item.circular_title}
                  onClick={() => setSelectedTitle(item.circular_title)}
                  className={`w-full rounded-2xl border-l-4 bg-white p-5 text-left shadow-panel transition ${
                    active
                      ? "border-accent ring-1 ring-teal-100"
                      : "border-transparent hover:border-slate-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold ${regulatorTone(
                          item.regulator,
                        )}`}
                      >
                        {item.regulator}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold leading-snug text-slate-900">
                          {item.circular_title}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted">
                          {item.summary}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${priorityTone(
                          item.priority,
                        )}`}
                      >
                        {item.priority}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${statusTone(
                          item.status,
                        )}`}
                      >
                        {item.status}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-4 text-xs text-muted">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">group</span>
                      {item.match_count || 0} client{item.match_count !== 1 ? "s" : ""} affected
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">edit_document</span>
                      {item.draftCount} draft{item.draftCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                </button>
              );
            })
          ) : (
            <EmptyState
              message={
                loading
                  ? "Loading circulars..."
                  : "No circulars match the current filters."
              }
            />
          )}
        </div>

        <div className="xl:col-span-5">
          {selected ? (
            <div className="sticky top-24 overflow-hidden rounded-2xl shadow-panel">
              <div className="bg-hero p-6 text-white">
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${regulatorTone(
                      selected.regulator,
                    )}`}
                  >
                    {selected.regulator}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${priorityTone(
                      selected.priority,
                    )}`}
                  >
                    {selected.priority}
                  </span>
                </div>
                <h3 className="font-headline text-lg font-bold leading-snug">
                  {selected.circular_title}
                </h3>
              </div>

              <div className="space-y-5 bg-white p-5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
                    Summary
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {selected.summary || "No summary available."}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Clients matched", value: selected.match_count || 0 },
                    { label: "Drafts generated", value: selected.draftCount },
                    { label: "Status", value: selected.status },
                    {
                      label: "Source",
                      value: selected.source === "simulated" ? "Simulated" : "Real",
                    },
                  ].map((field) => (
                    <div key={field.label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
                        {field.label}
                      </p>
                      <p className="mt-1 text-sm font-bold text-slate-900">
                        {field.value}
                      </p>
                    </div>
                  ))}
                </div>

                {selected.affected_clients?.length > 0 ? (
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                      Matched clients
                    </p>
                    <div className="space-y-2">
                      {selected.affected_clients.slice(0, 4).map((client) => (
                        <div
                          key={client.client_id}
                          className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 p-3"
                        >
                          <span className="material-symbols-outlined mt-0.5 text-sm text-amber-600">
                            check_circle
                          </span>
                          <div>
                            <p className="text-xs font-bold text-slate-900">{client.name}</p>
                            <p className="text-xs text-muted">{client.reason}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="border-t border-slate-100 pt-2">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                    Next action
                  </p>
                  <p className="text-sm text-slate-700">
                    {selected.draftCount > 0
                      ? `${selected.draftCount} draft${
                          selected.draftCount > 1 ? "s" : ""
                        } ready — go to Draft Review to approve.`
                      : "Run the pipeline to generate client advisories for this circular."}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-8 shadow-panel">
              <EmptyState message="Select a circular to see details." />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, options, onChange, isOpen, onToggle, onClose }) {
  return (
    <div className="relative">
      <span className="mb-1 block pl-1 text-[10px] font-bold uppercase tracking-widest text-muted">
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
