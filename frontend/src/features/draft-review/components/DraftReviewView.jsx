import { useEffect, useMemo, useState } from "react";
import {
  ActionBanner,
  DetailRow,
  EmptyState,
  FilterChip,
  StatCard,
  extractEmailBody,
  formatDate,
  initials,
  regulatorTone,
  riskBorder,
  riskTone,
  statusTone,
  timeAgo,
} from "@/shared/ui";

const STATUS_OPTIONS = ["All", "Pending Review", "Approved", "Rejected"];
const REGULATOR_OPTIONS = ["All", "RBI", "GST", "IncomeTax", "MCA", "SEBI"];
const RISK_OPTIONS = ["All", "HIGH", "MEDIUM", "LOW"];

export default function DraftReviewView({
  actionMessage,
  allDrafts,
  loading,
  onApproveDraft,
  onRejectDraft,
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [regulatorFilter, setRegulatorFilter] = useState("All");
  const [riskFilter, setRiskFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(null); // "approve" | "reject" | null
  const [tab, setTab] = useState("actions"); // "actions" | "email" | "meta"

  const filtered = useMemo(() => {
    return allDrafts.filter((d) => {
      const hay = [d.draft_id, d.client_name, d.regulator, d.circular_title]
        .join(" ")
        .toLowerCase();
      const matchSearch = !search || hay.includes(search.toLowerCase());
      const matchStatus =
        statusFilter === "All" ||
        (statusFilter === "Pending Review" && d.status === "pending_review") ||
        (statusFilter === "Approved" && d.status === "approved") ||
        (statusFilter === "Rejected" && d.status === "rejected");
      const matchReg = regulatorFilter === "All" || d.regulator === regulatorFilter;
      const matchRisk = riskFilter === "All" || d.risk_level === riskFilter;
      return matchSearch && matchStatus && matchReg && matchRisk;
    });
  }, [allDrafts, search, statusFilter, regulatorFilter, riskFilter]);

  useEffect(() => {
    if (!filtered.length) { setSelectedId(null); return; }
    if (!selectedId || !filtered.some((d) => d.draft_id === selectedId)) {
      setSelectedId(filtered[0].draft_id);
    }
  }, [filtered, selectedId]);

  const selected = filtered.find((d) => d.draft_id === selectedId) || filtered[0] || null;

  const counts = {
    total: allDrafts.length,
    pending: allDrafts.filter((d) => d.status === "pending_review").length,
    approved: allDrafts.filter((d) => d.status === "approved").length,
    rejected: allDrafts.filter((d) => d.status === "rejected").length,
  };

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-extrabold text-slate-950">Draft Review</h1>
          <p className="mt-1 text-sm text-muted">Review AI-generated compliance advisories before sending to clients.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard title="Total" value={counts.total} tone="border-slate-400" />
          <StatCard title="Pending" value={counts.pending} tone="border-warning" />
          <StatCard title="Approved" value={counts.approved} tone="border-emerald-500" />
          <StatCard title="Rejected" value={counts.rejected} tone="border-rose-500" />
        </div>
      </div>

      <ActionBanner message={actionMessage} />

      {/* Filters */}
      <div className="rounded-2xl bg-white p-4 shadow-panel space-y-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-line bg-slate-50 py-2.5 pl-9 pr-4 text-sm outline-none focus:border-accent focus:bg-white"
            placeholder="Search by client, regulator, or circular..."
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted self-center mr-1">Status</span>
          {STATUS_OPTIONS.map((o) => (
            <FilterChip key={o} label={o} active={statusFilter === o} onClick={() => setStatusFilter(o)} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted self-center mr-1">Regulator</span>
          {REGULATOR_OPTIONS.map((o) => (
            <FilterChip key={o} label={o} active={regulatorFilter === o} onClick={() => setRegulatorFilter(o)} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted self-center mr-1">Risk</span>
          {RISK_OPTIONS.map((o) => (
            <FilterChip key={o} label={o} active={riskFilter === o} onClick={() => setRiskFilter(o)} />
          ))}
        </div>
      </div>

      {/* Main split */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">

        {/* LEFT — draft list */}
        <div className="xl:col-span-4">
          <div className="rounded-2xl bg-white shadow-panel overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-widest text-muted">Queue</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {filtered.length}
              </span>
            </div>
            <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-100">
              {filtered.length ? filtered.map((d) => {
                const active = selected?.draft_id === d.draft_id;
                return (
                  <button
                    key={d.draft_id}
                    onClick={() => { setSelectedId(d.draft_id); setTab("actions"); }}
                    className={`w-full border-l-4 p-4 text-left transition ${
                      active
                        ? `${riskBorder(d.risk_level)} bg-slate-50`
                        : "border-transparent hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusTone(d.status)}`}>
                        {d.status.replace("_", " ")}
                      </span>
                      <span className="text-[11px] text-muted">{timeAgo(d.generated_at)}</span>
                    </div>
                    <p className="mt-2 text-sm font-bold text-slate-900 leading-snug">{d.client_name}</p>
                    <p className="mt-0.5 text-xs text-muted truncate">{d.circular_title}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 ${regulatorTone(d.regulator)}`}>
                        {d.regulator}
                      </span>
                      <span className={`text-[11px] font-semibold ${riskTone(d.risk_level)}`}>
                        {d.risk_level}
                      </span>
                    </div>
                  </button>
                );
              }) : (
                <div className="p-4">
                  <EmptyState message={loading ? "Loading drafts..." : "No drafts match filters."} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — detail panel */}
        <div className="xl:col-span-8">
          {selected ? (
            <div className="rounded-2xl bg-white shadow-panel overflow-hidden">

              {/* Client header */}
              <div className="bg-slate-50 border-b border-slate-200 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white shrink-0">
                      {initials(selected.client_name)}
                    </div>
                    <div>
                      <p className="font-headline text-lg font-bold text-slate-950">{selected.client_name}</p>
                      <p className="text-xs text-muted">{selected.client_email || "No email"}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${statusTone(selected.status)}`}>
                      {selected.status.replace("_", " ")}
                    </span>
                    <p className="mt-1 font-mono text-[11px] text-muted">{selected.draft_id}</p>
                  </div>
                </div>

                {/* Key facts row */}
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <FactPill label="Regulator" value={selected.regulator} />
                  <FactPill label="Risk" value={selected.risk_level} highlight={riskTone(selected.risk_level)} />
                  <FactPill label="Deadline" value={selected.deadline || "Not set"} />
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-slate-200">
                {[
                  { key: "actions", label: "Actions", icon: "checklist" },
                  { key: "email", label: "Email Draft", icon: "mail" },
                  { key: "meta", label: "Details", icon: "info" },
                ].map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition ${
                      tab === t.key
                        ? "border-accent text-accent"
                        : "border-transparent text-muted hover:text-slate-700"
                    }`}
                  >
                    <span className="material-symbols-outlined text-base">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="p-6 min-h-[280px]">
                {tab === "actions" && (
                  <div className="space-y-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-muted">
                      {selected.actions?.length || 0} required action{selected.actions?.length !== 1 ? "s" : ""}
                    </p>
                    {selected.actions?.length ? (
                      <ul className="space-y-3">
                        {selected.actions.map((action, i) => (
                          <li key={i} className="flex gap-3 rounded-xl bg-slate-50 p-4">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">
                              {i + 1}
                            </span>
                            <span className="text-sm leading-6 text-slate-800">{action}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState message="No actions extracted." />
                    )}

                    {selected.penalty_if_missed && selected.penalty_if_missed !== "Not specified in circular" && (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-rose-700">Penalty if missed</p>
                        <p className="mt-1 text-sm text-rose-900">{selected.penalty_if_missed}</p>
                      </div>
                    )}
                  </div>
                )}

                {tab === "email" && (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                      <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Subject</span>
                        <p className="mt-0.5 text-sm font-semibold text-slate-900">
                          {selected.email_subject || "No subject"}
                        </p>
                      </div>
                      <div className="bg-white p-5">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Body</span>
                        <pre className="mt-2 whitespace-pre-wrap font-body text-sm leading-7 text-slate-700">
                          {extractEmailBody(selected.email_body) || "No email body available."}
                        </pre>
                      </div>
                    </div>
                    <p className="text-xs text-muted">
                      This email will be sent to <strong>{selected.client_email}</strong> when you approve.
                    </p>
                  </div>
                )}

                {tab === "meta" && (
                  <div className="space-y-6">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Circular</p>
                      <p className="text-sm font-semibold text-slate-900">{selected.circular_title}</p>
                      <p className="mt-1 text-sm text-slate-600">{selected.circular_summary}</p>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Filing details</p>
                      <DetailRow label="Applicable sections" value={(selected.applicable_sections || []).join(", ") || "None"} />
                      <DetailRow label="Model used" value={selected.model_used} />
                      <DetailRow label="Generated" value={formatDate(selected.generated_at)} />
                      <DetailRow label="Version" value={selected.version} />
                    </div>

                    {selected.internal_notes && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Internal notes</p>
                        <p className="text-sm leading-6 text-slate-700 bg-slate-50 rounded-xl p-3">
                          {selected.internal_notes}
                        </p>
                      </div>
                    )}

                    {(selected.source_chunks || []).length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">
                          RAG sources ({selected.source_chunks.length})
                        </p>
                        <div className="space-y-2">
                          {selected.source_chunks.map((chunk, i) => (
                            <div key={i} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                              <span className="text-slate-700 font-medium">{chunk.source} · p{chunk.page}</span>
                              <span className="text-muted">score {typeof chunk.score === "number" ? chunk.score.toFixed(3) : chunk.score}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action buttons — always visible at bottom */}
              <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
                <p className="text-xs text-muted">
                  {selected.status !== "pending_review"
                    ? `This draft has been ${selected.status}.`
                    : "Review the email draft before approving."}
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
            <div className="rounded-2xl bg-white shadow-panel p-10">
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
    <div className="rounded-xl bg-white border border-slate-200 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold ${highlight || "text-slate-900"}`}>{value}</p>
    </div>
  );
}
