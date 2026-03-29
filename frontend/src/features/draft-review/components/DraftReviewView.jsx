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

function reviewStatus(draft) {
  const review = (draft?.review_status || "").toLowerCase();
  if (["pending", "approved", "rejected"].includes(review)) return review;

  const status = (draft?.status || "").toLowerCase();
  if (status === "rejected") return "rejected";
  if (["approved", "approved_not_sent", "send_failed", "sent"].includes(status)) {
    return "approved";
  }
  return "pending";
}

function deliveryStatus(draft) {
  const delivery = (draft?.delivery_status || "").toLowerCase();
  if (["not_sent", "sent", "failed"].includes(delivery)) return delivery;

  const status = (draft?.status || "").toLowerCase();
  if (status === "send_failed") return "failed";
  if (status === "approved_not_sent") return "not_sent";
  if (status === "approved" || status === "sent") return "sent";
  if (draft?.email_sent) return "sent";
  return "not_sent";
}

function canonicalStatus(draft) {
  const review = reviewStatus(draft);
  const delivery = deliveryStatus(draft);

  if (review === "rejected") return "rejected";
  if (review === "approved") {
    if (delivery === "sent") return "approved";
    if (delivery === "failed") return "send_failed";
    return "approved_not_sent";
  }
  return "pending_review";
}

function statusLabel(draft) {
  const status = canonicalStatus(draft);
  if (status === "pending_review") return "Pending review";
  if (status === "approved") return "Sent";
  if (status === "approved_not_sent") return "Approved - not sent";
  if (status === "send_failed") return "Send failed";
  if (status === "rejected") return "Rejected";
  return status.replace(/_/g, " ");
}

function queueRank(draft) {
  const review = reviewStatus(draft);
  const delivery = deliveryStatus(draft);
  if (review === "pending") return 0;
  if (review === "approved" && delivery !== "sent") return 1;
  return 2;
}

function actionSummaryText(draft) {
  const review = reviewStatus(draft);
  const delivery = deliveryStatus(draft);

  if (review === "pending") return "Review, edit if needed, then approve and send.";
  if (review === "approved" && delivery === "failed") return "Email delivery failed. Retry send.";
  if (review === "approved" && delivery === "not_sent") return "Draft approved but not sent yet.";
  if (review === "approved" && delivery === "sent") return "Email already sent to client.";
  return "Draft is rejected. Reopen to review again.";
}

export default function DraftReviewView({
  allDrafts,
  loading,
  onSaveDraft,
  onRejectDraft,
  onSendDraft,
  onReopenDraft,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(null);
  const [tab, setTab] = useState("email");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [notification, setNotification] = useState(null);

  const queue = useMemo(() => {
    return [...allDrafts].sort((a, b) => {
      const rankDiff = queueRank(a) - queueRank(b);
      if (rankDiff !== 0) return rankDiff;
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

  async function handleSave() {
    if (!selected || busy) return;
    setBusy("save");
    try {
      await onSaveDraft(selected.draft_id, {
        subject: emailSubject,
        body: emailBody,
      });
      showNotification("Draft saved successfully", "success");
    } catch (error) {
      showNotification(error?.message || "Could not save draft", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleSend(mode = "send") {
    if (!selected || busy) return;
    setBusy(mode);
    try {
      await onSendDraft(selected.draft_id, {
        subject: emailSubject,
        body: emailBody,
      });
      showNotification("Email sent successfully to client", "success");
    } catch (error) {
      showNotification(error?.message || "Could not send email", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleReject() {
    if (!selected || busy) return;
    setBusy("reject");
    try {
      await onRejectDraft(selected.draft_id);
      showNotification("Draft rejected", "success");
    } finally {
      setBusy(null);
    }
  }

  async function handleReopen() {
    if (!selected || busy) return;
    setBusy("reopen");
    try {
      await onReopenDraft(selected.draft_id);
      showNotification("Draft reopened for review", "success");
    } catch (error) {
      showNotification(error?.message || "Could not reopen draft", "error");
    } finally {
      setBusy(null);
    }
  }

  function showNotification(message, type = "success") {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  }

  const selectedReview = reviewStatus(selected);
  const selectedDelivery = deliveryStatus(selected);
  const selectedStatus = canonicalStatus(selected);

  const showSave = !!selected && selectedDelivery !== "sent";
  const showReject = !!selected && selectedReview === "pending";

  let primaryAction = null;
  if (selected) {
    if (selectedReview === "pending") {
      primaryAction = {
        key: "send",
        label: busy === "send" ? "Sending..." : "Approve & Send",
        onClick: () => handleSend("send"),
      };
    } else if (selectedReview === "approved" && selectedDelivery !== "sent") {
      primaryAction = {
        key: "retry",
        label: busy === "retry" ? "Retrying..." : "Retry Send",
        onClick: () => handleSend("retry"),
      };
    } else {
      primaryAction = {
        key: "reopen",
        label: busy === "reopen" ? "Reopening..." : "Reopen",
        onClick: handleReopen,
      };
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Notification Toast */}
      {notification && (
        <div className="fixed right-6 top-6 z-50 animate-fade-in">
          <div
            className={`flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg ${
              notification.type === "success"
                ? "bg-emerald-600 text-white"
                : "bg-rose-600 text-white"
            }`}
          >
            <span className="material-symbols-outlined text-base">
              {notification.type === "success" ? "check_circle" : "error"}
            </span>
            <p className="text-sm font-medium">{notification.message}</p>
          </div>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-12">
        <div className="flex min-h-0 flex-col xl:col-span-4">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-panel">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-widest text-muted">Queue</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {queue.length}
              </span>
            </div>

            <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
              {queue.length ? (
                queue.map((draft) => {
                  const active = selected?.draft_id === draft.draft_id;
                  const queueStatus = canonicalStatus(draft);
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
                            queueStatus,
                          )}`}
                        >
                          {statusLabel(draft)}
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
                        {draft.low_confidence_flag && (
                          <span className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                            <span className="material-symbols-outlined text-[12px]">warning</span>
                            Verify
                          </span>
                        )}
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

        <div className="flex min-h-0 flex-col xl:col-span-8">
          {selected ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-panel">
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
                        selectedStatus,
                      )}`}
                    >
                      {statusLabel(selected)}
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

              <div className="min-h-0 flex-1 overflow-y-auto p-0">
                {tab === "email" ? (
                  <div className="flex h-full flex-col">
                    {selected.low_confidence_flag && (
                      <div className="mx-6 mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                        <span className="material-symbols-outlined mt-0.5 shrink-0 text-base text-amber-600">
                          warning
                        </span>
                        <div>
                          <p className="text-xs font-bold text-amber-800">
                            CA Verification Required — Low Source Confidence
                          </p>
                          <p className="mt-0.5 text-xs text-amber-700">
                            This advisory was generated without verified source documents
                            {selected.rag_confidence === "none"
                              ? " (no matching circular found in knowledge base)"
                              : " (retrieved chunks were below relevance threshold)"}
                            . Cross-check all actions, deadlines and penalty amounts against the original circular before approving.
                          </p>
                        </div>
                      </div>
                    )}

                    {selectedStatus === "send_failed" && selected.send_error ? (
                      <div className="mx-6 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
                        Last send error: {selected.send_error}
                      </div>
                    ) : null}

                    <div className="flex-1 p-6">
                      <div className="overflow-hidden rounded-xl border border-slate-200">
                        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-muted">
                            Subject
                          </label>
                          <input
                            value={emailSubject}
                            onChange={(event) => setEmailSubject(event.target.value)}
                            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                            placeholder="Email subject"
                          />
                        </div>
                        <div className="bg-white p-5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-muted">
                            Message Body
                          </label>
                          <textarea
                            value={emailBody}
                            onChange={(event) => setEmailBody(event.target.value)}
                            rows={16}
                            className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm leading-7 text-slate-800 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 font-sans"
                            placeholder="No email body available."
                          />
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-muted">
                        Recipient: <strong className="text-slate-700">{selected.client_email}</strong>
                      </p>
                    </div>
                  </div>
                ) : null}

                {tab === "actions" ? (
                  <div className="space-y-5 p-6">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-muted">
                        Required Actions
                      </p>
                      <p className="mt-1 text-2xl font-bold text-slate-950">
                        {selected.actions?.length || 0}
                      </p>
                    </div>
                    {selected.actions?.length ? (
                      <ul className="space-y-3">
                        {selected.actions.map((action, index) => (
                          <li key={index} className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
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
                  <div className="space-y-6 p-6">
                    <div>
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                        Circular
                      </p>
                      <p className="text-sm font-semibold text-slate-900">
                        {selected.circular_title}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">{getDraftSummary(selected)}</p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted">
                        Filing details
                      </p>
                      <DetailRow
                        label="Applicable sections"
                        value={(selected.applicable_sections || []).join(", ") || "None"}
                      />
                      <DetailRow label="Review status" value={reviewStatus(selected)} />
                      <DetailRow label="Delivery status" value={deliveryStatus(selected)} />
                      <DetailRow label="Model used" value={selected.model_used} />
                      <DetailRow label="Generated" value={formatDate(selected.generated_at)} />
                      <DetailRow label="Version" value={selected.version} />
                      <DetailRow
                        label="RAG confidence"
                        value={
                          selected.rag_confidence === "high"
                            ? `High (score: ${selected.rag_top_score ?? "—"})`
                            : selected.rag_confidence === "low"
                            ? `Low (score: ${selected.rag_top_score ?? "—"}) — LLM knowledge used`
                            : "None — LLM knowledge only"
                        }
                      />
                    </div>

                    {(selected.circular_url || selected.circular_no) && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted">
                          Source citation
                        </p>
                        {selected.circular_no && (
                          <DetailRow label="Circular no." value={selected.circular_no} />
                        )}
                        {selected.circular_published && (
                          <DetailRow label="Published" value={formatDate(selected.circular_published)} />
                        )}
                        {selected.circular_url ? (
                          <div className="mt-2 flex items-start justify-between gap-2 py-1.5">
                            <span className="text-xs font-medium text-slate-500">Source URL</span>
                            <a
                              href={selected.circular_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="max-w-[60%] truncate text-right text-xs font-semibold text-blue-600 underline underline-offset-2 hover:text-blue-800"
                            >
                              {selected.circular_url}
                            </a>
                          </div>
                        ) : (
                          <DetailRow label="Source URL" value="Refer official regulatory portal" />
                        )}
                        {selected.source_chunks?.length > 0 && (
                          <div className="mt-3 border-t border-slate-200 pt-3">
                            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                              RAG source chunks ({selected.source_chunks.length})
                            </p>
                            <div className="space-y-1">
                              {selected.source_chunks.map((chunk, i) => (
                                <p key={i} className="text-xs text-slate-600">
                                  <span className="font-semibold">{chunk.source}</span>
                                  {chunk.page != null && ` · p.${chunk.page}`}
                                  {chunk.score != null && (
                                    <span className="ml-1 text-slate-400">
                                      (score: {chunk.score})
                                    </span>
                                  )}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

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

              <div className="flex items-center justify-between gap-4 border-t border-slate-200 bg-slate-50 px-6 py-5">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700">{actionSummaryText(selected)}</p>
                </div>
                <div className="flex shrink-0 gap-3">
                  {showSave ? (
                    <button
                      onClick={handleSave}
                      disabled={!!busy}
                      className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busy === "save" ? "Saving..." : "Save Draft"}
                    </button>
                  ) : null}

                  {showReject ? (
                    <button
                      onClick={handleReject}
                      disabled={!!busy}
                      className="rounded-lg border border-rose-300 bg-white px-5 py-2.5 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busy === "reject" ? "Rejecting..." : "Reject"}
                    </button>
                  ) : null}

                  {primaryAction ? (
                    <button
                      onClick={primaryAction.onClick}
                      disabled={!!busy}
                      className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {primaryAction.label}
                    </button>
                  ) : null}
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