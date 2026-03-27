import { useEffect, useMemo, useState } from "react";

function statusTone(status) {
  if (status === "approved") return "bg-emerald-100 text-emerald-800";
  if (status === "rejected") return "bg-rose-100 text-rose-800";
  return "bg-amber-100 text-amber-800";
}

function riskTone(level) {
  if (level === "HIGH" || level === "CRITICAL") return "text-rose-700";
  if (level === "MEDIUM") return "text-amber-700";
  return "text-teal-700";
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

function timeAgo(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? "Yesterday" : `${diffDays}d ago`;
}

function extractEmailBody(emailBody) {
  if (!emailBody) return "";
  if (typeof emailBody !== "string") return String(emailBody);
  try {
    const parsed = JSON.parse(emailBody);
    return parsed.body || emailBody;
  } catch {
    return emailBody;
  }
}

export default function DraftReviewView({
  actionMessage,
  allDrafts,
  loading,
  onApproveDraft,
  onRejectDraft,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [regulatorFilter, setRegulatorFilter] = useState("All");
  const [riskFilter, setRiskFilter] = useState("All");
  const [selectedDraftId, setSelectedDraftId] = useState(null);

  const filteredDrafts = useMemo(() => {
    return allDrafts.filter((draft) => {
      const haystack = [
        draft.draft_id,
        draft.client_name,
        draft.regulator,
        draft.circular_title,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = !searchQuery || haystack.includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "All" ||
        (statusFilter === "Pending Review" && draft.status === "pending_review") ||
        (statusFilter === "Approved" && draft.status === "approved") ||
        (statusFilter === "Rejected" && draft.status === "rejected");
      const matchesRegulator = regulatorFilter === "All" || draft.regulator === regulatorFilter;
      const matchesRisk = riskFilter === "All" || draft.risk_level === riskFilter;

      return matchesSearch && matchesStatus && matchesRegulator && matchesRisk;
    });
  }, [allDrafts, searchQuery, statusFilter, regulatorFilter, riskFilter]);

  useEffect(() => {
    if (!filteredDrafts.length) {
      setSelectedDraftId(null);
      return;
    }

    if (!selectedDraftId || !filteredDrafts.some((draft) => draft.draft_id === selectedDraftId)) {
      setSelectedDraftId(filteredDrafts[0].draft_id);
    }
  }, [filteredDrafts, selectedDraftId]);

  const selectedDraft =
    filteredDrafts.find((draft) => draft.draft_id === selectedDraftId) || filteredDrafts[0] || null;

  const stats = {
    total: allDrafts.length,
    pending: allDrafts.filter((draft) => draft.status === "pending_review").length,
    approved: allDrafts.filter((draft) => draft.status === "approved").length,
    rejected: allDrafts.filter((draft) => draft.status === "rejected").length,
  };

  return (
    <>
      <section className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <h1 className="font-headline text-4xl font-extrabold tracking-tight text-slate-950">
            Draft Review
          </h1>
          <p className="mt-3 max-w-2xl text-lg leading-8 text-muted">
            Review AI-generated compliance advisories before client delivery.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard title="Total Drafts" value={stats.total} tone="border-accent" />
          <StatCard title="Pending Review" value={stats.pending} tone="border-warning" />
          <StatCard title="Approved" value={stats.approved} tone="border-emerald-500" />
          <StatCard title="Rejected" value={stats.rejected} tone="border-rose-500" />
        </div>
      </section>

      {actionMessage ? (
        <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
          {actionMessage}
        </div>
      ) : null}

      <section className="rounded-3xl bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-4">
          <div className="relative w-full">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
              search
            </span>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-teal-300 focus:bg-white"
              placeholder="Search draft ID, client, regulator, or circular title..."
              type="text"
            />
          </div>

          <div className="flex flex-col gap-4 border-t border-slate-200 pt-4">
            <FilterRow
              label="Status"
              options={["All", "Pending Review", "Approved", "Rejected"]}
              value={statusFilter}
              onChange={setStatusFilter}
            />
            <FilterRow
              label="Regulator"
              options={["All", "GST", "IncomeTax", "MCA", "SEBI", "RBI"]}
              value={regulatorFilter}
              onChange={setRegulatorFilter}
            />
            <FilterRow
              label="Risk"
              options={["All", "HIGH", "MEDIUM", "LOW"]}
              value={riskFilter}
              onChange={setRiskFilter}
            />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
        <section className="overflow-hidden rounded-3xl bg-white shadow-panel xl:col-span-5">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <h3 className="font-headline text-lg font-bold text-slate-950">Draft Queue</h3>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-700">
              {filteredDrafts.length} result{filteredDrafts.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="max-h-[calc(100vh-22rem)] overflow-y-auto p-3">
            {filteredDrafts.length ? (
              <div className="space-y-2">
                {filteredDrafts.map((draft) => {
                  const active = selectedDraft?.draft_id === draft.draft_id;
                  return (
                    <button
                      key={draft.draft_id}
                      onClick={() => setSelectedDraftId(draft.draft_id)}
                      className={`w-full rounded-2xl border-l-4 p-4 text-left transition ${
                        active
                          ? "border-accent bg-slate-50 ring-1 ring-teal-100"
                          : "border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-mono text-[11px] text-slate-500">{draft.draft_id}</span>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(
                            draft.status,
                          )}`}
                        >
                          {draft.status.replace("_", " ")}
                        </span>
                      </div>

                      <h4 className="mt-3 text-sm font-bold leading-6 text-slate-950">
                        {draft.circular_title}
                      </h4>

                      <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                        <span className="font-semibold text-slate-900">{draft.client_name}</span>
                        <span>•</span>
                        <span>{draft.regulator}</span>
                      </div>

                      <div className="mt-4 flex items-center justify-between">
                        <div className={`flex items-center gap-1.5 text-xs font-semibold ${riskTone(draft.risk_level)}`}>
                          <span className="material-symbols-outlined text-base">warning</span>
                          {draft.risk_level}
                        </div>
                        <span className="text-[11px] text-slate-500">{timeAgo(draft.generated_at)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-3">
                <EmptyState message={loading ? "Loading drafts..." : "No drafts match the current filters."} />
              </div>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-panel xl:col-span-7">
          {selectedDraft ? (
            <>
              <div className="border-b border-slate-200 bg-slate-50 p-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white">
                        {selectedDraft.client_name
                          .split(" ")
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div>
                        <h2 className="font-headline text-xl font-bold text-slate-950">
                          {selectedDraft.client_name}
                        </h2>
                        <p className="text-sm text-slate-600">
                          {selectedDraft.client_contact || "No contact"} • {selectedDraft.client_email || "No email"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="text-left xl:text-right">
                    <span
                      className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] ${statusTone(
                        selectedDraft.status,
                      )}`}
                    >
                      {selectedDraft.status.replace("_", " ")}
                    </span>
                    <p className="mt-2 font-mono text-xs text-slate-500">{selectedDraft.draft_id}</p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_140px]">
                  <DetailBlock label="Circular Title" value={selectedDraft.circular_title} />
                  <DetailBlock label="Regulator" value={selectedDraft.regulator} />
                </div>
              </div>

              <div className="max-h-[calc(100vh-22rem)] overflow-y-auto">
                <div className="grid grid-cols-1 gap-6 border-b border-slate-100 bg-white p-6 xl:grid-cols-2">
                  <div className="space-y-4">
                    <DetailBlock
                      label="Circular Summary"
                      value={selectedDraft.circular_summary || "No circular summary available."}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <DetailBlock label="Deadline" value={selectedDraft.deadline || "Not specified"} />
                      <DetailBlock label="Risk Level" value={selectedDraft.risk_level || "Unknown"} />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                        Applicable Sections
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(selectedDraft.applicable_sections || []).length ? (
                          selectedDraft.applicable_sections.map((section) => (
                            <span
                              key={section}
                              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                            >
                              {section}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-slate-600">No sections captured.</span>
                        )}
                      </div>
                    </div>
                    <DetailBlock
                      label="Penalty if Missed"
                      value={selectedDraft.penalty_if_missed || "Not specified"}
                    />
                  </div>
                </div>

                <div className="border-b border-slate-100 bg-slate-50 p-6">
                  <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                    <span className="material-symbols-outlined text-base text-slate-700">smart_toy</span>
                    AI Drafting Metadata
                  </p>

                  <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                    <MetaCard label="Model Used" value={selectedDraft.model_used || "Unknown"} />
                    <MetaCard label="Generated At" value={formatDate(selectedDraft.generated_at)} />
                    <MetaCard label="Version" value={selectedDraft.version || "v1"} />
                  </div>

                  <div className="mt-5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                      Internal Notes
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">
                      {selectedDraft.internal_notes || "No internal notes provided."}
                    </p>
                  </div>

                  <div className="mt-5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                      Recommended Actions
                    </p>
                    {(selectedDraft.actions || []).length ? (
                      <ul className="mt-3 space-y-2">
                        {selectedDraft.actions.map((action) => (
                          <li key={action} className="flex gap-2 text-sm text-slate-800">
                            <span className="material-symbols-outlined text-base text-teal-700">
                              check_circle
                            </span>
                            <span>{action}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-slate-600">No recommended actions available.</p>
                    )}
                  </div>

                  <div className="mt-5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                      Source Chunks
                    </p>
                    {(selectedDraft.source_chunks || []).length ? (
                      <div className="mt-3 space-y-2">
                        {selectedDraft.source_chunks.map((chunk, index) => (
                          <div
                            key={`${chunk.source}-${chunk.page}-${index}`}
                            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                          >
                            <span>
                              {chunk.source} • page {chunk.page}
                            </span>
                            <span className="font-semibold text-slate-500">
                              score {typeof chunk.score === "number" ? chunk.score.toFixed(3) : chunk.score}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-slate-600">No source citations available.</p>
                    )}
                  </div>
                </div>

                <div className="p-8">
                  <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
                    <div className="border-b border-slate-200 bg-slate-100 px-4 py-3 text-center text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                      Advisory Email Draft
                    </div>

                    <div className="space-y-5 bg-white p-6">
                      <div>
                        <span className="text-xs font-bold text-slate-500">Subject:</span>
                        <span className="ml-2 text-sm font-semibold text-slate-900">
                          {selectedDraft.email_subject || "No subject available"}
                        </span>
                      </div>

                      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5 text-sm leading-7 text-slate-700">
                        <pre className="whitespace-pre-wrap font-body text-sm leading-7 text-slate-700">
                          {extractEmailBody(selectedDraft.email_body) || "No draft body available."}
                        </pre>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 bg-white p-6">
                <button
                  onClick={() => onRejectDraft(selectedDraft.draft_id)}
                  disabled={selectedDraft.status !== "pending_review"}
                  className="rounded-xl border border-rose-200 px-6 py-3 text-sm font-bold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reject Draft
                </button>
                <button
                  onClick={() => onApproveDraft(selectedDraft.draft_id)}
                  disabled={selectedDraft.status !== "pending_review"}
                  className="rounded-xl bg-slate-950 px-7 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Approve Draft
                </button>
              </div>
            </>
          ) : (
            <div className="p-10">
              <EmptyState message={loading ? "Loading draft details..." : "Select a draft to review."} />
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function StatCard({ title, value, tone }) {
  return (
    <div className={`rounded-2xl border-l-4 ${tone} bg-white px-4 py-3 shadow-panel`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <p className="mt-2 font-headline text-2xl font-extrabold text-slate-950">{value}</p>
    </div>
  );
}

function FilterRow({ label, options, value, onChange }) {
  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <div className="flex flex-wrap gap-2">
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

function DetailBlock({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm leading-6 text-slate-800">{value}</p>
    </div>
  );
}

function MetaCard({ label, value }) {
  return (
    <div className="rounded-xl border border-white bg-white/70 p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
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
