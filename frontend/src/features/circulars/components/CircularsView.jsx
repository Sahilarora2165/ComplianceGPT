import { useEffect, useMemo, useState } from "react";
import {
  EmptyState,
  priorityTone,
  regulatorTone,
} from "@/shared/ui";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:8000";

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

function sourceLabel(source) {
  if (source === "simulated") return "Simulated";
  if (source === "real_scrape") return "Real Scrape";
  if (source === "manual_upload") return "Manual Upload";
  return "Unknown";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function localDocumentUrl(filename) {
  const clean = normalizeText(filename);
  if (!clean) return "";
  return `${API_BASE_URL}/documents/file/${encodeURIComponent(clean)}`;
}

export default function CircularsView({
  allCirculars,
  allDrafts,
  loading,
  pipeline,
  onRunDemo,
  onRunReal,
}) {
  const [selectedTitle, setSelectedTitle] = useState(null);

  const sourceMap = useMemo(() => {
    const docs = pipeline?.new_documents || [];
    return new Map(
      docs.map((d) => [
        d.title,
        {
          source: d.source || "unknown",
          url: d.url || "",
          filename: d.filename || "",
          document_id: d.document_id || "",
        },
      ]),
    );
  }, [pipeline]);

  const circulars = useMemo(
    () =>
      allCirculars.map((item) => {
        const sourceMeta = sourceMap.get(item.circular_title) || {};
        const draftCount = allDrafts.filter(
          (d) => d.circular_title === item.circular_title,
        ).length;
        return {
          ...item,
          draftCount,
          source: item.source || sourceMeta.source || "unknown",
          url: item.url || sourceMeta.url || "",
          filename: item.filename || sourceMeta.filename || "",
          document_id: item.document_id || sourceMeta.document_id || "",
          status: statusFromItem(item, draftCount),
        };
      }),
    [allCirculars, allDrafts, sourceMap],
  );

  useEffect(() => {
    if (!circulars.length) {
      setSelectedTitle(null);
      return;
    }
    if (!selectedTitle || !circulars.some((i) => i.circular_title === selectedTitle)) {
      setSelectedTitle(circulars[0].circular_title);
    }
  }, [circulars, selectedTitle]);

  const selected =
    circulars.find((i) => i.circular_title === selectedTitle) || circulars[0] || null;
  const selectedLocalUrl = selected ? localDocumentUrl(selected.filename) : "";
  const selectedExternalUrl = normalizeText(selected?.url);
  const hasSourceLink = Boolean(selectedLocalUrl || selectedExternalUrl);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="flex min-h-0 flex-col gap-3 xl:col-span-7">
          <div className="flex shrink-0 items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-muted">
              {circulars.length} circular{circulars.length !== 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={onRunReal}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
              >
                Run Live Monitoring
              </button>
              <button
                onClick={onRunDemo}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-900"
              >
                Run Demo Monitoring
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {circulars.length ? (
              circulars.map((item) => {
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
                    : "No circulars found."
                }
              />
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col xl:col-span-5">
          {selected ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-panel">
              <div className="shrink-0 bg-hero p-6 text-white">
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

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-white p-5">
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
                    { label: "Circular No.", value: selected.circular_no || "—" },
                    { label: "Published", value: selected.published_date || "—" },
                    { label: "Clients matched", value: selected.match_count || 0 },
                    { label: "Drafts generated", value: selected.draftCount },
                    { label: "Status", value: selected.status },
                    {
                      label: "Source",
                      value: sourceLabel(selected.source),
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

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
                    Source document
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {selectedLocalUrl ? (
                      <a
                        href={selectedLocalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
                      >
                        <span className="material-symbols-outlined text-sm">description</span>
                        Open Ingested File
                      </a>
                    ) : null}
                    {selectedExternalUrl ? (
                      <a
                        href={selectedExternalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        <span className="material-symbols-outlined text-sm">open_in_new</span>
                        Open Official Link
                      </a>
                    ) : null}
                    {!hasSourceLink ? (
                      <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
                        Source not available for this circular
                      </span>
                    ) : null}
                  </div>
                  {selected.filename ? (
                    <p className="mt-2 truncate text-xs text-muted">
                      File: {selected.filename}
                    </p>
                  ) : null}
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
                      : "Run monitoring to generate client advisories for this circular."}
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
