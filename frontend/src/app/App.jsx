import { useEffect, useMemo, useRef, useState } from "react";
import {
  approveDraft,
  getDashboardData,
  reopenDraft,
  runUploadedDocumentPipeline,
  saveDraft,
  sendDraftEmail,
  sendDeadlineAlert,
  resetPipelineState,
  runPipeline,
  triggerDeadlineScan,
  triggerSchedulerMonitoring,
  uploadDocument,
} from "@/services/complianceApi";
import ComplianceCalendarView from "@/ComplianceCalendarView";
import AuditTrailView from "@/features/audit-trail";
import AnalystQueryView from "@/features/analyst-query";
import ClientProfilesView from "@/features/client-profiles";
import CircularsView from "@/features/circulars";
import DeadlineWatchView from "@/features/deadline-watch";
import DraftReviewView from "@/features/draft-review";
import PipelineControlView from "@/features/pipeline-control";

const NAV = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "circulars", label: "Circulars", icon: "visibility" },
  { key: "drafts", label: "Draft Review", icon: "edit_document" },
  { key: "deadlines", label: "Deadline Watch", icon: "alarm" },
  { key: "calendar", label: "Compliance Calendar", icon: "calendar_month" },
  { key: "clients", label: "Clients", icon: "group" },
  { key: "analyst", label: "Analyst Query", icon: "psychology" },
  { key: "audit", label: "Audit Trail", icon: "history_edu" },
  { key: "operations", label: "Operations Center", icon: "account_tree" },
];

function getClientName(client) {
  return client?.name || client?.business_profile?.name || "Unknown";
}

function getClientRiskScore(client) {
  if (typeof client?.risk_profile?.compliance_score === "number") {
    return client.risk_profile.compliance_score;
  }
  const level = (
    client?.compliance_profile?.risk_level ||
    client?.risk_profile?.risk_level ||
    client?.priority ||
    ""
  ).toUpperCase();
  if (level === "HIGH") return 60;
  if (level === "MEDIUM") return 78;
  if (level === "LOW") return 90;
  return 85;
}

function currency(value) {
  if (!value) return "Rs0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value) {
  if (!value) return "No run yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function regulatorTone(regulator) {
  const map = {
    RBI: "bg-slate-900 text-white",
    GST: "bg-teal-700 text-white",
    IncomeTax: "bg-amber-700 text-white",
    MCA: "bg-sky-900 text-white",
    SEBI: "bg-emerald-900 text-white",
  };
  return map[regulator] || "bg-slate-700 text-white";
}

function draftReviewStatus(draft) {
  const review = (draft?.review_status || "").toLowerCase();
  if (review === "pending" || review === "approved" || review === "rejected") return review;

  const status = (draft?.status || "").toLowerCase();
  if (status === "rejected") return "rejected";
  if (["approved", "approved_not_sent", "send_failed", "sent"].includes(status)) return "approved";
  return "pending";
}

function isDraftPendingReview(draft) {
  return draftReviewStatus(draft) === "pending";
}

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [data, setData] = useState({
    pipeline: null,
    circulars: null,
    drafts: null,
    deadlines: null,
    calendar: null,
    clients: null,
    audit: null,
    scheduler: null,
  });
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState("");
  const [openIntakeSignal, setOpenIntakeSignal] = useState(0);
  const [isAutoSeeding, setIsAutoSeeding] = useState(false);
  const backgroundRefreshTimerRef = useRef(null);

  useEffect(() => {
    let ignore = false;
    let stopBackgroundRefresh = null;

    async function load() {
      setLoading(true);
      const next = await getDashboardData();
      if (ignore) return;

      setData(next);
      setLoading(false);

      const hasEverRun = next.pipeline?.last_run != null;

      if (!hasEverRun) {
        setIsAutoSeeding(true);
        setActionMessage("Setting up your dashboard for the first time...");
        try {
          await runPipeline({ simulateMode: true, reset: true });
          pollCompletion("Initial setup");
        } catch {
          setActionMessage("Auto-setup failed — click 'Run Demo Monitoring' to load data.");
          setIsAutoSeeding(false);
        }
      } else {
        stopBackgroundRefresh = startBackgroundRefresh();
      }
    }

    load();
    return () => {
      ignore = true;
      if (typeof stopBackgroundRefresh === "function") {
        stopBackgroundRefresh();
      }
      clearBackgroundRefresh();
    };
  }, []);

  async function reloadDashboard() {
    const next = await getDashboardData();
    setData(next);
    setLoading(false);
    return next;
  }

  function clearBackgroundRefresh() {
    if (backgroundRefreshTimerRef.current) {
      clearInterval(backgroundRefreshTimerRef.current);
      backgroundRefreshTimerRef.current = null;
    }
  }

  function startBackgroundRefresh() {
    const THIRTY_MINUTES = 30 * 60 * 1000;

    if (!backgroundRefreshTimerRef.current) {
      backgroundRefreshTimerRef.current = setInterval(async () => {
        try {
          await reloadDashboard();
        } catch {
          // Silent fail - do not show any error to user
        }
      }, THIRTY_MINUTES);
    }

    return () => clearBackgroundRefresh();
  }

  const allDrafts = useMemo(() => data.drafts?.drafts || [], [data.drafts]);
  const allDeadlines = useMemo(() => data.deadlines?.alerts || [], [data.deadlines]);
  const allCirculars = useMemo(() => data.pipeline?.match_results || [], [data.pipeline]);
  const calendarData = useMemo(() => data.calendar || null, [data.calendar]);
  const clients = useMemo(() => data.clients?.clients || [], [data.clients]);
  const auditEvents = useMemo(() => data.audit?.events || [], [data.audit]);
  const scheduler = useMemo(() => data.scheduler || null, [data.scheduler]);

  const metrics = useMemo(
    () => ({
      circulars: data.pipeline?.total_circulars || allCirculars.length,
      affectedClients: data.pipeline?.total_matches || 0,
      pendingDrafts: allDrafts.filter((draft) => isDraftPendingReview(draft)).length,
      deadlineAlerts: data.deadlines?.total || allDeadlines.length,
      totalExposure: data.deadlines?.summary?.total_exposure || 0,
    }),
    [data, allCirculars, allDrafts, allDeadlines],
  );

  const urgentCirculars = useMemo(
    () => allCirculars.filter((item) => item.priority === "HIGH").slice(0, 4),
    [allCirculars],
  );

  const urgentDraftQueue = useMemo(
    () =>
      allDrafts
        .filter((draft) => isDraftPendingReview(draft))
        .sort(
          (a, b) =>
            (a.risk_level === "HIGH" ? 0 : 1) - (b.risk_level === "HIGH" ? 0 : 1),
        )
        .slice(0, 3),
    [allDrafts],
  );

  const urgentDeadlines = useMemo(
    () => allDeadlines.filter((alert) => alert.level === "MISSED" || alert.level === "CRITICAL").slice(0, 3),
    [allDeadlines],
  );

  const topRiskClients = useMemo(
    () => [...clients].sort((a, b) => getClientRiskScore(a) - getClientRiskScore(b)).slice(0, 4),
    [clients],
  );

  async function refresh(action, label, successLabel) {
    setActionMessage(`${label} in progress...`);
    try {
      await action();
      await reloadDashboard();
      setActionMessage(successLabel || `${label} completed`);
    } catch {
      setActionMessage(`${label} failed`);
    }
  }

  async function handleRunPipeline({ simulateMode, reset, label }) {
    setActionMessage(`${label} starting...`);
    try {
      await runPipeline({ simulateMode, reset });
      setActionMessage(`${label} started - monitoring for completion...`);
      pollCompletion(label);
    } catch {
      setActionMessage(`${label} failed to start`);
    }
  }

  async function handleDocumentUpload({ file, regulator, title, uploadedBy }) {
    setActionMessage("Uploading and ingesting document...");
    try {
      const result = await uploadDocument({ file, regulator, title, uploadedBy });
      setActionMessage(
        `${result?.document?.title || file.name} ingested. It is now available in Analyst Query.`,
      );
      return result;
    } catch {
      setActionMessage("Document upload failed");
      throw new Error("Upload failed");
    }
  }

  async function handleRunDocumentPipeline(documentId, title) {
    const label = title ? `Document processing (${title})` : "Document processing";
    setActionMessage(`${label} starting...`);
    try {
      await runUploadedDocumentPipeline(documentId, "CA");
      setActionMessage(`${label} started - monitoring for completion...`);
      pollCompletion(label);
    } catch {
      setActionMessage(`${label} failed to start`);
      throw new Error("Document processing start failed");
    }
  }

  function pollCompletion(label) {
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      try {
        const next = await reloadDashboard();
        const status = next.pipeline?.status;
        if (next.pipeline?.status_message) {
          setActionMessage(next.pipeline.status_message);
        }
        if (status === "completed") {
          clearInterval(timer);
          setIsAutoSeeding(false);
          startBackgroundRefresh();
          setActionMessage(
            `${label} finished - ${next.pipeline?.total_circulars || 0} circulars, ${next.pipeline?.total_matches || 0} matches`,
          );
        } else if (status === "failed") {
          clearInterval(timer);
          setIsAutoSeeding(false);
          setActionMessage(`${label} failed`);
        }
      } catch {
        // keep polling
      }

      if (attempts >= 180) {
        clearInterval(timer);
        setIsAutoSeeding(false);
        setActionMessage("Processing is still running - check back shortly.");
      }
    }, 2000);
  }

  function openDocumentIntakeWorkspace() {
    setPage("analyst");
    setOpenIntakeSignal((current) => current + 1);
  }

  async function handleDraftReject(draftId) {
    setActionMessage("Rejecting draft...");
    try {
      await approveDraft(draftId, false, "CA");
      await reloadDashboard();
      setActionMessage("Draft rejected");
    } catch (error) {
      setActionMessage(error?.message || "Draft rejection failed");
    }
  }

  async function handleDraftSave(draftId, { subject, body }) {
    setActionMessage("Saving draft...");
    try {
      await saveDraft(draftId, { subject, body, caName: "CA" });
      await reloadDashboard();
      setActionMessage("Draft saved");
    } catch (error) {
      setActionMessage(error?.message || "Draft save failed");
      throw error;
    }
  }

  async function handleDraftSend(draftId, { subject, body }) {
    setActionMessage("Sending email...");
    const idempotencyKey =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

    try {
      const res = await sendDraftEmail(draftId, {
        subject,
        body,
        caName: "CA",
        idempotencyKey,
      });
      await reloadDashboard();
      setActionMessage(res?.already_sent ? "Email was already sent" : "Email sent");
      return res;
    } catch (error) {
      await reloadDashboard();
      setActionMessage(error?.message || "Email send failed");
      throw error;
    }
  }

  async function handleDraftReopen(draftId) {
    setActionMessage("Reopening draft...");
    try {
      await reopenDraft(draftId, "CA");
      await reloadDashboard();
      setActionMessage("Draft reopened for review");
    } catch (error) {
      setActionMessage(error?.message || "Draft reopen failed");
      throw error;
    }
  }

  const pageMeta =
    {
      circulars: {
        eyebrow: "Circular Intelligence",
        subtitle: "Track regulator updates and assess client impact",
      },
      drafts: {
        eyebrow: "Draft Governance",
        subtitle: "Review AI-generated advisories before client delivery",
      },
      deadlines: {
        eyebrow: "Deadline Intelligence",
        subtitle: "Track obligations, exposure, and filing risk",
      },
      calendar: {
        eyebrow: "Statutory Calendar",
        subtitle: "Review upcoming Indian regulatory filing deadlines",
      },
      clients: {
        eyebrow: "Client Intelligence",
        subtitle: "Review compliance footprint and risk context",
      },
      audit: {
        eyebrow: "Workflow Traceability",
        subtitle: "Immutable log of every system and agent action",
      },
      analyst: {
        eyebrow: "Research Intelligence",
        subtitle: "Ask compliance questions grounded in the knowledge base",
      },
      operations: {
        eyebrow: "Monitoring Control",
        subtitle: "Operate monitoring runs and inspect execution state",
      },
      dashboard: {
        eyebrow: "Compliance Operations",
        subtitle: "Overview of monitoring, drafting, and deadline response",
      },
    }[page] || { eyebrow: "ComplianceGPT", subtitle: "" };

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <aside className="fixed left-0 top-0 hidden h-screen w-64 flex-col border-r border-white/10 bg-hero px-4 py-7 text-white lg:flex">
        <div className="mb-7 px-2">
          <p className="font-headline text-lg font-extrabold tracking-widest">ComplianceGPT</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.35em] text-teal-100/50">
            Sovereign Auditor
          </p>
        </div>

        <nav className="flex-1 space-y-0.5">
          {NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => setPage(item.key)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                page === item.key
                  ? "bg-white/12 text-white"
                  : "text-slate-300/70 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className="material-symbols-outlined text-lg">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-[10px] uppercase tracking-widest text-teal-100/50">Last Sync</p>
          {isAutoSeeding ? (
            <p className="mt-2 text-xs text-teal-200/70">Setting up dashboard...</p>
          ) : data.pipeline?.last_run ? (
            <>
              <p className="mt-2 text-sm font-semibold text-white">Synced</p>
              <p className="mt-0.5 text-xs text-slate-300/60">{formatDate(data.pipeline?.last_run)}</p>
            </>
          ) : (
            <p className="mt-2 text-xs text-slate-300/60">Not run yet</p>
          )}
        </div>
      </aside>

      <main
        className={`lg:ml-64 flex flex-col ${
          page === "dashboard" ? "h-screen overflow-hidden" : "min-h-screen"
        }`}
      >
        {page !== "dashboard" &&
        page !== "circulars" &&
        page !== "drafts" &&
        page !== "deadlines" &&
        page !== "calendar" &&
        page !== "clients" &&
        page !== "analyst" &&
        page !== "operations" &&
        page !== "audit" ? (
          <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-canvas/90 px-5 py-3 backdrop-blur md:px-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-muted">
                  {pageMeta.eyebrow}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">{pageMeta.subtitle}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <span className="material-symbols-outlined cursor-pointer text-muted transition hover:text-ink">
                    notifications
                  </span>
                  {metrics.deadlineAlerts > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-danger" />
                  ) : null}
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-shell text-xs font-bold text-white">
                  CA
                </div>
              </div>
            </div>
          </header>
        ) : null}

        <div
          className={`px-5 pb-3 pt-3 md:px-8 ${
            page === "dashboard" ? "flex-1 overflow-hidden" : "flex-1"
          }`}
        >
          {page === "circulars" ? (
            <CircularsView
              actionMessage={actionMessage}
              allCirculars={allCirculars}
              allDrafts={allDrafts}
              loading={loading}
              pipeline={data.pipeline}
              onRunDemo={() =>
                handleRunPipeline({ simulateMode: true, reset: true, label: "Demo monitoring run" })
              }
              onRunReal={() =>
                handleRunPipeline({
                  simulateMode: false,
                  reset: false,
                  label: "Real monitoring",
                })
              }
            />
          ) : page === "drafts" ? (
            <DraftReviewView
              actionMessage={actionMessage}
              allDrafts={allDrafts}
              loading={loading}
              onSaveDraft={handleDraftSave}
              onRejectDraft={handleDraftReject}
              onSendDraft={handleDraftSend}
              onReopenDraft={handleDraftReopen}
            />
          ) : page === "deadlines" ? (
            <DeadlineWatchView
              actionMessage={actionMessage}
              allDeadlines={allDeadlines}
              deadlineSummary={data.deadlines?.summary}
              loading={loading}
              onSendAlert={(id) =>
                refresh(() => sendDeadlineAlert(id, "CA"), "Sending alert", "Alert sent")
              }
            />
          ) : page === "calendar" ? (
            <ComplianceCalendarView calendarData={calendarData} loading={loading} />
          ) : page === "clients" ? (
            <ClientProfilesView clients={clients} loading={loading} onClientsChanged={reloadDashboard} />
          ) : page === "audit" ? (
            <AuditTrailView events={auditEvents} loading={loading} />
          ) : page === "analyst" ? (
            <AnalystQueryView
              actionMessage={actionMessage}
              onUploadDocument={handleDocumentUpload}
              onRunUploadedDocumentPipeline={handleRunDocumentPipeline}
              uploadHistory={auditEvents}
              openIntakeSignal={openIntakeSignal}
            />
          ) : page === "operations" ? (
            <PipelineControlView
              actionMessage={actionMessage}
              loading={loading}
              pipeline={data.pipeline}
              scheduler={scheduler}
              onResetPipeline={() =>
                refresh(resetPipelineState, "Monitoring state reset", "Monitoring state reset")
              }
              onTriggerScheduler={() =>
                refresh(
                  triggerSchedulerMonitoring,
                  "Scheduler trigger",
                  "Scheduler triggered",
                )
              }
              onOpenDocumentIntake={openDocumentIntakeWorkspace}
            />
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-muted">
                    Compliance Operations
                  </p>
                  <h1 className="font-headline text-[2.35rem] font-extrabold leading-tight tracking-tight text-slate-950">
                    Compliance Dashboard
                  </h1>
                  <p className="max-w-3xl text-sm text-slate-600">
                    AI monitoring, client matching, advisory drafts, and deadline tracking for CA firms.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 xl:justify-end xl:pt-4">
                    <button
                      onClick={() =>
                        handleRunPipeline({ simulateMode: true, reset: true, label: "Demo monitoring run" })
                      }
                      className="rounded-xl bg-shell px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-shellSoft"
                    >
                      Run Demo Monitoring
                    </button>
                    <button
                      onClick={() =>
                        handleRunPipeline({
                          simulateMode: false,
                          reset: false,
                          label: "Real monitoring",
                        })
                      }
                      className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Run Real Monitoring
                    </button>
                    <button
                      onClick={() => refresh(triggerDeadlineScan, "Deadline scan")}
                      className="rounded-xl border border-line px-5 py-2.5 text-sm font-semibold text-muted transition hover:border-slate-300 hover:text-ink"
                    >
                      Trigger Scan
                    </button>
                </div>
              </div>

              {actionMessage ? (
                <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
                  {actionMessage}
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
                {[
                  {
                    title: "New Circulars",
                    value: metrics.circulars,
                    tone: "border-accent",
                    icon: "policy",
                  },
                  {
                    title: "Clients Affected",
                    value: metrics.affectedClients,
                    tone: "border-accent",
                    icon: "group",
                  },
                  {
                    title: "Pending Reviews",
                    value: metrics.pendingDrafts,
                    tone: "border-warning",
                    icon: "pending_actions",
                  },
                  {
                    title: "Deadline Alerts",
                    value: metrics.deadlineAlerts,
                    tone: "border-danger",
                    icon: "alarm",
                  },
                  {
                    title: "Exposure at Risk",
                    value: currency(metrics.totalExposure),
                    tone: "border-warning",
                    icon: "monetization_on",
                  },
                ].map((metric) => (
                  <div
                    key={metric.title}
                    className={`h-20 rounded-2xl border-l-4 ${metric.tone} bg-white p-3 shadow-panel`}
                  >
                    <div className="mb-1.5 flex items-start justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                        {metric.title}
                      </span>
                      <span className="material-symbols-outlined text-base text-muted opacity-50">
                        {metric.icon}
                      </span>
                    </div>
                    <p className="text-[1.75rem] font-extrabold leading-none text-slate-950">
                      {isAutoSeeding ? "—" : metric.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-3">
                <div className="flex min-h-0 flex-col gap-3">
                  <div className="h-48 rounded-2xl bg-white shadow-panel overflow-hidden">
                    <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                      <span className="material-symbols-outlined text-base text-danger">radar</span>
                      <h3 className="text-sm font-bold text-slate-950">Critical Now</h3>
                      <button
                        onClick={() => setPage("deadlines")}
                        className="ml-auto text-[11px] font-bold text-accent hover:underline"
                      >
                        View all
                      </button>
                    </div>
                    <div className="h-[calc(100%-45px)] space-y-1.5 overflow-y-auto p-3">
                      {urgentDeadlines.length ? (
                        urgentDeadlines.map((alert) => (
                          <button
                            key={alert.alert_id}
                            onClick={() => setPage("deadlines")}
                            className="w-full rounded-r-xl border-l-4 border-rose-400 pl-3 pr-2 py-2 text-left transition hover:bg-slate-50"
                          >
                            <p className="text-[10px] font-bold uppercase tracking-widest text-rose-700">
                              {alert.level} - {alert.due_date}
                            </p>
                            <p className="mt-0.5 text-xs font-semibold text-slate-900">
                              {alert.client_name}
                            </p>
                            <p className="text-[11px] text-muted">{alert.obligation_type}</p>
                          </button>
                        ))
                      ) : (
                        <p className="py-4 text-center text-sm text-muted">
                          {loading ? "Loading..." : "No critical alerts."}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="h-52 rounded-2xl bg-white p-4 shadow-panel overflow-hidden">
                    <h3 className="mb-3 text-sm font-bold text-slate-950">Top Risk Clients</h3>
                    <div className="h-[calc(100%-30px)] space-y-2.5 overflow-y-auto pr-1">
                      {topRiskClients.length ? (
                        topRiskClients.map((client) => {
                          const score = getClientRiskScore(client);
                          const name = getClientName(client);
                          const initials = name
                            .split(" ")
                            .slice(0, 2)
                            .map((part) => part[0] || "")
                            .join("")
                            .toUpperCase();
                          return (
                            <div key={client.id} className="flex items-center gap-3">
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-700">
                                {initials}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold text-slate-900">
                                  {name}
                                </p>
                                <div className="mt-1 flex items-center gap-2">
                                  <div className="flex-1 rounded-full bg-slate-200 h-1">
                                    <div
                                      className={`h-1 rounded-full ${
                                        score < 70
                                          ? "bg-danger"
                                          : score < 85
                                          ? "bg-warning"
                                          : "bg-accent"
                                      }`}
                                      style={{ width: `${score}%` }}
                                    />
                                  </div>
                                  <span className="text-[11px] font-bold text-muted">{score}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="py-3 text-center text-sm text-muted">No clients loaded.</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-col gap-3">
                  <div className="h-48 rounded-2xl bg-white shadow-panel overflow-hidden">
                    <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                      <span className="material-symbols-outlined text-base text-warning">
                        assignment
                      </span>
                      <h3 className="text-sm font-bold text-slate-950">Needs Review</h3>
                      <button
                        onClick={() => setPage("drafts")}
                        className="ml-auto text-[11px] font-bold text-accent hover:underline"
                      >
                        View all
                      </button>
                    </div>
                    <div className="h-[calc(100%-45px)] space-y-1.5 overflow-y-auto p-3">
                      {urgentDraftQueue.length ? (
                        urgentDraftQueue.map((draft) => (
                          <button
                            key={draft.draft_id}
                            onClick={() => setPage("drafts")}
                            className="w-full rounded-xl bg-slate-50 p-3 text-left transition hover:bg-slate-100"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="truncate text-xs font-bold text-slate-900">
                                {draft.client_name}
                              </p>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  draft.risk_level === "HIGH"
                                    ? "bg-rose-100 text-rose-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {draft.risk_level}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-muted">
                              {draft.regulator} - {draft.circular_title}
                            </p>
                          </button>
                        ))
                      ) : (
                        <p className="py-4 text-center text-sm text-muted">
                          {loading ? "Loading..." : "No pending approvals."}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex h-52 flex-col rounded-2xl bg-white p-4 shadow-panel overflow-hidden">
                    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50">
                      <span className="material-symbols-outlined text-accent">psychology</span>
                    </div>
                    <h3 className="font-headline text-base font-bold text-slate-950">
                      Ask the Analyst
                    </h3>
                    <p className="mt-2 flex-1 text-sm leading-6 text-muted">
                      Get grounded answers on regulatory changes, filing obligations, and circular
                      interpretations sourced directly from ingested documents.
                    </p>
                    <button
                      onClick={() => setPage("analyst")}
                      className="mt-3 text-left text-sm font-bold text-accent hover:underline"
                    >
                      Open Analyst Query
                    </button>
                  </div>
                </div>

                <div className="min-h-0 overflow-hidden rounded-2xl bg-white shadow-panel">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                    <span className="material-symbols-outlined text-base text-accent">rss_feed</span>
                    <h3 className="text-sm font-bold text-slate-950">What Changed Today</h3>
                    <button
                      onClick={() => setPage("circulars")}
                      className="ml-auto text-[11px] font-bold text-accent hover:underline"
                    >
                      View all
                    </button>
                  </div>
                  <div className="space-y-2 p-3 xl:h-[calc(100%-45px)] xl:overflow-y-auto">
                    {urgentCirculars.length ? (
                      urgentCirculars.map((item) => (
                        <button
                          key={item.circular_title}
                          onClick={() => setPage("circulars")}
                          className="w-full rounded-xl p-3 text-left transition hover:bg-slate-50"
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${regulatorTone(
                                item.regulator,
                              )}`}
                            >
                              {item.regulator}
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold leading-snug text-slate-900">
                                {item.circular_title}
                              </p>
                              <p className="mt-1 text-[11px] text-muted">
                                {item.match_count || 0} clients matched
                              </p>
                            </div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <p className="py-4 text-center text-sm text-muted">
                        {loading ? "Loading..." : "No high-priority circulars."}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
