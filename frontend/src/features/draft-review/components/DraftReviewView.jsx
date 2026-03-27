import { useEffect, useMemo, useState } from "react";
import {
  DetailRow,
  EmptyState,
  extractEmailBody,
  formatDate,
  initials,
  regulatorTone,
  riskBorder,
  riskTone,
  statusTone,
  timeAgo,
} from "@/shared/ui";

function getDraftSummary(draft) {
  return (
    draft?.circular_summary ||
    draft?.summary ||
    draft?.circular?.summary ||
    "No circular summary available."
  );
}

export default function DraftReviewView({
  allDrafts,
  loading,
  onApproveDraft,
  onRejectDraft,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(null);
  const [tab, setTab] = useState("email");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  const queue = useMemo(() => {
    return [...allDrafts].sort((a, b) => {
      const aPending = a.status === "pending_review" ? 0 : 1;
      const bPending = b.status === "pending_review" ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      return new Date(b.generated_at || 0).getTime() - new Date(a.generated_at || 0).getTime();
    });
  }, [allDrafts]);

  useEffect(() => {
    if (!queue.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !queue.some((draft) => draft.draft_id === selectedId)) {
      setSelectedId(queue[0].draft_id);
    }
  }, [queue, selectedId]);

  const selected = queue.find((draft) => draft.draft_id === selectedId) || queue[0] || null;

  useEffect(() => {
    if (!selected) {
      setEmailSubject("");
      setEmailBody("");
      return;
    }

    setEmailSubject(selected.email_subject || "");
    setEmailBody(extractEmailBody(selected.email_body) || "");
  }, [selected]);

  async function handleApprove() {
    if (!selected || busy) return;
    setBusy("approve");
    await onApproveDraft(selected.draft_id);
    setBusy(null);
  }

  async function handleReject() {
    if (!selected || busy) return;
    setBusy("reject");
    await onRejectDraft(selected.draft_id);
    setBusy(null);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-muted">
          Draft Governance
        </p>
        <h1 className="font-headline text-[2rem] font-extrabold leading-tight tracking-tight text-slate-950">
          Draft Review
        </h1>
        <p className="text-sm text-slate-600">
          Review the queue and finalize the advisory draft on the right.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12 xl:h-[calc(100vh-230px)]">
        <div className="xl:col-span-4">
          <div className="overflow-hidden rounded-2xl bg-white shadow-panel xl:h-full">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-widest text-muted">Queue</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {queue.length}
              </span>
            </div>

            <div className="divide-y divide-slate-100 overflow-y-auto xl:h-[calc(100%-53px)]">
              {queue.length ? (
                queue.map((draft) => {
                  const active = selected?.draft_id === draft.draft_id;
                  return (
                    <button
                      key={draft.draft_id}
                      onClick={() => {
                        setSelectedId(draft.draft_id);
                        setTab("email");
                      }}
                      className={`w-full border-l-4 p-4 text-left transition ${
                        active
                          ? `${riskBorder(draft.risk_level)} bg-slate-50`
                          : "border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusTone(
                            draft.status,
                          )}`}
                        >
                          {draft.status.replace("_", " ")}
                        </span>
                        <span className="text-[11px] text-muted">{timeAgo(draft.generated_at)}</span>
                      </div>
                      <p className="mt-2 text-sm font-bold leading-snug text-slate-900">
                        {draft.client_name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted">{draft.circular_title}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${regulatorTone(
                            draft.regulator,
                          )}`}
                        >
                          {draft.regulator}
                        </span>
                        <span className={`text-[11px] font-semibold ${riskTone(draft.risk_level)}`}>
                          {draft.risk_level}
                        </span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="p-4">
                  <EmptyState message={loading ? "Loading drafts..." : "No drafts available."} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="xl:col-span-8">
          {selected ? (
            <div className="overflow-hidden rounded-2xl bg-white shadow-panel xl:flex xl:h-full xl:flex-col">
              <div className="border-b border-slate-200 bg-slate-50 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white">
                      {initials(selected.client_name)}
                    </div>
                    <div>
                      <p className="font-headline text-lg font-bold text-slate-950">
                        {selected.client_name}
                      </p>
                      <p className="text-xs text-muted">{selected.client_email || "No email"}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${statusTone(
                        selected.status,
                      )}`}
                    >
                      {selected.status.replace("_", " ")}
                    </span>
                    <p className="mt-1 font-mono text-[11px] text-muted">{selected.draft_id}</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3">
                  <FactPill label="Regulator" value={selected.regulator} />
                  <FactPill
                    label="Risk"
                    value={selected.risk_level}
                    highlight={riskTone(selected.risk_level)}
                  />
                  <FactPill label="Deadline" value={selected.deadline || "Not set"} />
                </div>
              </div>

              <div className="flex border-b border-slate-200">
                {[
                  { key: "email", label: "Email Draft", icon: "mail" },
                  { key: "actions", label: "Actions", icon: "checklist" },
                  { key: "meta", label: "Details", icon: "info" },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setTab(item.key)}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition border-b-2 ${
                      tab === item.key
                        ? "border-accent text-accent"
                        : "border-transparent text-muted hover:text-slate-700"
                    }`}
                  >
                    <span className="material-symbols-outlined text-base">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-6">
                {tab === "email" ? (
                  <div className="space-y-4">
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="border-b border-slate-200 bg-slate-100 px-4 py-3">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                          Subject
                        </span>
                        <input
                          value={emailSubject}
                          onChange={(event) => setEmailSubject(event.target.value)}
                          className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-accent"
                          placeholder="Email subject"
                        />
                      </div>
                      <div className="bg-white p-5">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                          Body
                        </span>
                        <textarea
                          value={emailBody}
                          onChange={(event) => setEmailBody(event.target.value)}
                          rows={14}
                          className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700 outline-none focus:border-accent focus:bg-white"
                          placeholder="No email body available."
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted">
                      This email will be sent to <strong>{selected.client_email}</strong> when you approve.
                    </p>
                  </div>
                ) : null}

                {tab === "actions" ? (
                  <div className="space-y-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-muted">
                      {selected.actions?.length || 0} required action
                      {selected.actions?.length !== 1 ? "s" : ""}
                    </p>
                    {selected.actions?.length ? (
                      <ul className="space-y-3">
                        {selected.actions.map((action, index) => (
                          <li key={index} className="flex gap-3 rounded-xl bg-slate-50 p-4">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">
                              {index + 1}
                            </span>
                            <span className="text-sm leading-6 text-slate-800">{action}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState message="No actions extracted." />
                    )}

                    {selected.penalty_if_missed &&
                    selected.penalty_if_missed !== "Not specified in circular" ? (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-rose-700">
                          Penalty if missed
                        </p>
                        <p className="mt-1 text-sm text-rose-900">
                          {selected.penalty_if_missed}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {tab === "meta" ? (
                  <div className="space-y-6">
                    <div>
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                        Circular
                      </p>
                      <p className="text-sm font-semibold text-slate-900">
                        {selected.circular_title}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">{getDraftSummary(selected)}</p>
                    </div>

                    <div>
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                        Filing details
                      </p>
                      <DetailRow
                        label="Applicable sections"
                        value={(selected.applicable_sections || []).join(", ") || "None"}
                      />
                      <DetailRow label="Model used" value={selected.model_used} />
                      <DetailRow label="Generated" value={formatDate(selected.generated_at)} />
                      <DetailRow label="Version" value={selected.version} />
                    </div>

                    {selected.internal_notes ? (
                      <div>
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                          Internal notes
                        </p>
                        <p className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                          {selected.internal_notes}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
                <p className="text-xs text-muted">
                  {selected.status !== "pending_review"
                    ? `This draft has been ${selected.status}.`
                    : "Review the draft and confirm before sending."}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={handleReject}
                    disabled={selected.status !== "pending_review" || !!busy}
                    className="rounded-xl border border-rose-200 px-5 py-2.5 text-sm font-bold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy === "reject" ? "Rejecting..." : "Reject"}
                  </button>
                  <button
                    onClick={handleApprove}
                    disabled={selected.status !== "pending_review" || !!busy}
                    className="rounded-xl bg-slate-950 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy === "approve" ? "Approving..." : "Approve & Send"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-10 shadow-panel">
              <EmptyState message={loading ? "Loading..." : "Select a draft from the queue."} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FactPill({ label, value, highlight }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold ${highlight || "text-slate-900"}`}>{value}</p>
    </div>
  );
}
