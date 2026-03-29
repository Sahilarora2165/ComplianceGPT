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
  getMetrics,
  getGuardrailMetrics,
} from "@/services/complianceApi";
import ComplianceCalendarView from "@/ComplianceCalendarView";
import AuditTrailView from "@/features/audit-trail";
import AnalystQueryView from "@/features/analyst-query";
import ClientProfilesView from "@/features/client-profiles";
import CircularsView from "@/features/circulars";
import DeadlineWatchView from "@/features/deadline-watch";
import DocumentIntakeWorkspace from "@/features/document-intake";
import DraftReviewView from "@/features/draft-review";
import PipelineControlView from "@/features/pipeline-control";

const NAV = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "circulars", label: "Circulars", icon: "visibility" },
  { key: "drafts", label: "Draft Review", icon: "edit_document" },
  { key: "deadlines", label: "Deadline Watch", icon: "alarm" },
  { key: "calendar", label: "Compliance Calendar", icon: "calendar_month" },
  { key: "clients", label: "Clients", icon: "group" },
  { key: "intake", label: "Document Intake", icon: "upload_file" },
  { key: "analyst", label: "Analyst Query", icon: "psychology" },
  { key: "audit", label: "Audit Trail", icon: "history_edu" },
  { key: "operations", label: "Operations Center", icon: "account_tree" },
];

function getClientName(client) {
  return client?.profile?.name || client?.name || client?.business_profile?.name || "Unknown";
}

function getClientPriority(client) {
  return (
    client?.profile?.priority ||
    client?.business_profile?.priority ||
    client?.priority ||
    ""
  ).toUpperCase();
}

function normalizeRiskScore(value, fallback = 85) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(100, Math.max(1, value));
}

function getClientRiskScore(client) {
  const directScore =
    client?.risk?.compliance_score ??
    client?.risk_profile?.compliance_score ??
    client?.compliance_profile?.compliance_score;
  if (typeof directScore === "number") return normalizeRiskScore(directScore);

  const level = (
    client?.risk?.risk_level ||
    client?.compliance_profile?.risk_level ||
    client?.risk_profile?.risk_level ||
    getClientPriority(client) ||
    ""
  ).toUpperCase();
  if (level === "HIGH" || level === "CRITICAL") return 60;
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
  const [deepLinkedClientId, setDeepLinkedClientId] = useState(null);
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
  const [metrics, setMetrics] = useState({
    timestamp: null,
    total_circulars: 0,
    total_matches: 0,
    total_drafts: 0,
    pending_drafts: 0,
    deadline_alerts: 0,
    total_exposure: 0,
    last_run: null,
    run_mode: null,
    message: null,
  });
  const [guardrail, setGuardrail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState("");
  const [openIntakeSignal, setOpenIntakeSignal] = useState(0);
  const pollTimerRef = useRef(null);

  useEffect(() => {
    let ignore = false;

    async function load() {
      setLoading(true);
      // Load metrics immediately for dashboard display
      try {
        const [metricsData, guardrailData] = await Promise.all([
          getMetrics(),
          getGuardrailMetrics().catch(() => null),
        ]);
        if (!ignore) {
          setMetrics(metricsData);
          setGuardrail(guardrailData);
        }
      } catch (error) {
        console.error("Failed to load metrics:", error);
      }
      
      // Load full dashboard data
      const next = await getDashboardData();
      if (!ignore) {
        setData(next);
        setLoading(false);
      }
    }

    load();
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!actionMessage) return undefined;
    const running = data.pipeline?.status === "running";
    if (running) return undefined;
    const timer = setTimeout(() => setActionMessage(""), 6000);
    return () => clearTimeout(timer);
  }, [actionMessage, data.pipeline?.status]);

  async function reloadDashboard() {
    const next = await getDashboardData();
    setData(next);
    
    // Also refresh metrics
    try {
      const [metricsData, guardrailData] = await Promise.all([
        getMetrics(),
        getGuardrailMetrics().catch(() => null),
      ]);
      setMetrics(metricsData);
      setGuardrail(guardrailData);
    } catch (error) {
      console.error("Failed to refresh metrics:", error);
    }
    
    setLoading(false);
    return next;
  }

  const allDrafts = useMemo(() => data.drafts?.drafts || [], [data.drafts]);
  const allDeadlines = useMemo(() => data.deadlines?.alerts || [], [data.deadlines]);
  const allCirculars = useMemo(
    () => data.circulars?.circulars || data.pipeline?.match_results || [],
    [data.circulars, data.pipeline],
  );
  const calendarData = useMemo(() => data.calendar || null, [data.calendar]);
  const clients = useMemo(() => {
    if (Array.isArray(data.clients)) return data.clients;
    if (Array.isArray(data.clients?.clients)) return data.clients.clients;
    if (Array.isArray(data.clients?.data)) return data.clients.data;
    return [];
  }, [data.clients]);
  const auditEvents = useMemo(() => data.audit?.events || [], [data.audit]);
  const scheduler = useMemo(() => data.scheduler || null, [data.scheduler]);

  // Use metrics from API if available, otherwise compute from data
  const displayMetrics = useMemo(
    () => ({
      circulars: Math.max(
        metrics.total_circulars ?? 0,
        data.pipeline?.total_circulars ?? 0,
        allCirculars.length,
      ),
      affectedClients: Math.max(
        metrics.total_matches ?? 0,
        data.pipeline?.total_matches ?? 0,
      ),
      pendingDrafts: Math.max(
        metrics.pending_drafts ?? 0,
        allDrafts.filter((draft) => isDraftPendingReview(draft)).length,
      ),
      deadlineAlerts: Math.max(
        metrics.deadline_alerts ?? 0,
        data.deadlines?.total ?? 0,
        allDeadlines.length,
      ),
      totalExposure: Math.max(
        metrics.total_exposure ?? 0,
        data.deadlines?.summary?.total_exposure ?? 0,
      ),
      circulars: data.circulars?.total ?? metrics.total_circulars ?? data.pipeline?.total_circulars ?? allCirculars.length,
      affectedClients: metrics.total_matches ?? data.pipeline?.total_matches ?? 0,
      pendingDrafts:
        metrics.pending_drafts ?? allDrafts.filter((draft) => isDraftPendingReview(draft)).length,
      deadlineAlerts: metrics.deadline_alerts ?? data.deadlines?.total ?? allDeadlines.length,
      totalExposure: metrics.total_exposure ?? data.deadlines?.summary?.total_exposure ?? 0,
      timestamp: metrics.timestamp,
      last_run: metrics.last_run,
      run_mode: metrics.run_mode,
      message: metrics.message,
    }),
    [metrics, data, allCirculars, allDrafts, allDeadlines],
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
    () => {
      if (clients.length) {
        return [...clients].sort((a, b) => getClientRiskScore(a) - getClientRiskScore(b)).slice(0, 4);
      }

      const fallbackRisk = data.deadlines?.summary?.highest_risk_clients;
      if (!Array.isArray(fallbackRisk)) return [];

      return fallbackRisk.slice(0, 4).map((entry, index) => ({
        id: `fallback-risk-${index}`,
        name: entry?.client || "Unknown",
        risk_profile: { compliance_score: 65 + index * 3 },
        fallback_obligation: entry?.obligation || "",
      }));
    },
    [clients, data.deadlines],
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

  async function handleRunPipeline({ simulateMode, reset, label, regulators }) {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setActionMessage(`${label} starting...`);
    try {
      await runPipeline({ simulateMode, reset, regulators });
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
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
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
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
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
          pollTimerRef.current = null;
          setActionMessage(
            `${label} finished - ${next.pipeline?.total_circulars || 0} circulars, ${next.pipeline?.total_matches || 0} matches`,
          );
        } else if (status === "failed") {
          clearInterval(timer);
          pollTimerRef.current = null;
          setActionMessage(`${label} failed`);
        }
      } catch {
        // keep polling
      }

      if (attempts >= 180) {
        clearInterval(timer);
        pollTimerRef.current = null;
        setActionMessage("Processing is still running - check back shortly.");
      }
    }, 2000);
    pollTimerRef.current = timer;
  }

  function openDocumentIntakeWorkspace() {
    setPage("intake");
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
      intake: {
        eyebrow: "Document Intake",
        subtitle: "Upload and process circulars directly for matching and drafting",
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
    <div className="flex h-screen overflow-hidden bg-canvas text-ink">
      <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-white/10 bg-hero px-4 py-7 text-white lg:flex">
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
          <p className="mt-2 text-sm font-semibold">
            {data.pipeline?.last_run ? "Synced" : "Not run yet"}
          </p>
          <p className="mt-0.5 text-xs text-slate-300/60">{formatDate(data.pipeline?.last_run)}</p>
        </div>
      </aside>

      <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-full min-h-0 flex-1 flex-col px-5 pb-3 pt-3 md:px-8">
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
                  label: "Live monitoring (all regulators)",
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
            <ComplianceCalendarView
              calendarData={calendarData}
              loading={loading}
              clients={clients}
              onSelectClient={(clientId) => {
                setDeepLinkedClientId(clientId);
                setPage("clients");
              }}
            />
          ) : page === "clients" ? (
            <ClientProfilesView
              clients={clients}
              loading={loading}
              onClientsChanged={reloadDashboard}
              initialSelectedId={deepLinkedClientId}
              onClearDeepLink={() => setDeepLinkedClientId(null)}
            />
          ) : page === "audit" ? (
            <AuditTrailView events={auditEvents} loading={loading} />
          ) : page === "intake" ? (
            <DocumentIntakeWorkspace
              onUploadDocument={handleDocumentUpload}
              onRunUploadedDocumentPipeline={handleRunDocumentPipeline}
              uploadHistory={auditEvents}
              compact={false}
            />
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
              onRunLiveMonitoring={() =>
                handleRunPipeline({
                  simulateMode: false,
                  reset: false,
                  label: "Live monitoring (all regulators)",
                })
              }
              onRunDemoMonitoring={() =>
                handleRunPipeline({
                  simulateMode: true,
                  reset: true,
                  label: "Demo monitoring run",
                })
              }
              onResetPipeline={() =>
                refresh(resetPipelineState, "Monitoring state reset", "Monitoring state reset")
              }
              onTriggerScheduler={() =>
                refresh(
                  () => triggerSchedulerMonitoring({ simulateMode: false }),
                  "Scheduler trigger (live)",
                  "Scheduler triggered (live)",
                )
              }
              onOpenDocumentIntake={openDocumentIntakeWorkspace}
            />
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden pb-1 pr-1">
              <div className="flex items-end justify-between">
                <div>
                  <h1 className="font-headline text-2xl font-bold text-slate-950">
                    Dashboard
                  </h1>
                  <p className="mt-1 text-sm text-slate-600">
                    Monitor compliance, review drafts, and track deadlines
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 xl:justify-end xl:pt-4">
                  <button
                    onClick={() =>
                      handleRunPipeline({
                        simulateMode: false,
                        reset: false,
                        label: "Live monitoring (all regulators)",
                      })
                    }
                    className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  >
                    Run Live Monitoring
                  </button>
                  <button
                    onClick={() =>
                      handleRunPipeline({
                        simulateMode: true,
                        reset: true,
                        label: "Demo monitoring run",
                      })
                    }
                    className="rounded-xl bg-shell px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-shellSoft"
                  >
                    Run Demo Monitoring
                  </button>
                </div>
              </div>

              {actionMessage ? (
                <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
                  {actionMessage}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {[
                  {
                    title: "New Circulars",
                    value: displayMetrics.circulars,
                    tone: "border-accent",
                    icon: "policy",
                    targetPage: "circulars",
                  },
                  {
                    title: "Clients Affected",
                    value: displayMetrics.affectedClients,
                    tone: "border-accent",
                    icon: "group",
                    targetPage: "clients",
                  },
                  {
                    title: "Pending Reviews",
                    value: displayMetrics.pendingDrafts,
                    tone: "border-warning",
                    icon: "pending_actions",
                    targetPage: "drafts",
                  },
                  {
                    title: "Deadline Alerts",
                    value: displayMetrics.deadlineAlerts,
                    tone: "border-danger",
                    icon: "alarm",
                    targetPage: "deadlines",
                  },
                  {
                    title: "Exposure at Risk",
                    value: currency(displayMetrics.totalExposure),
                    tone: "border-warning",
                    icon: "monetization_on",
                    targetPage: "deadlines",
                  },
                ].map((metric) => (
                  <button
                    key={metric.title}
                    onClick={() => setPage(metric.targetPage)}
                    className={`rounded-2xl border-l-4 ${metric.tone} bg-white p-4 text-left shadow-panel transition hover:shadow-md`}
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                        {metric.title}
                      </span>
                      <span className="material-symbols-outlined text-base text-muted opacity-50">
                        {metric.icon}
                      </span>
                    </div>
                    <p className="text-[1.75rem] font-extrabold leading-none text-slate-950">
                      {metric.value}
                    </p>
                  </button>
                ))}
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-12">
                <div className="flex min-h-0 flex-col gap-3 xl:col-span-4">
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-panel">
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
                    <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
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

                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-panel">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                      <h3 className="text-sm font-bold text-slate-950">Top Risk Clients</h3>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                        {topRiskClients.length}
                      </span>
                    </div>
                    <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
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
                                {client.fallback_obligation ? (
                                  <p className="mt-0.5 truncate text-[11px] text-muted">
                                    {client.fallback_obligation}
                                  </p>
                                ) : null}
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

                <div className="flex min-h-0 flex-col gap-3 xl:col-span-4">
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-panel">
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
                    <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
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

                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-panel">
                    <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                      <span className="material-symbols-outlined text-base text-accent">
                        verified_user
                      </span>
                      <h3 className="text-sm font-bold text-slate-950">Guardrail Health</h3>
                    </div>
                    {guardrail ? (
                      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                        {/* Abstention rate */}
                        <div>
                          <div className="flex items-end justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                              Abstention Rate
                            </span>
                            <span className="text-lg font-extrabold text-slate-950">
                              {guardrail.query_metrics.abstain_rate_pct}%
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200">
                            <div
                              className={`h-1.5 rounded-full ${
                                guardrail.query_metrics.abstain_rate_pct > 50
                                  ? "bg-amber-500"
                                  : "bg-accent"
                              }`}
                              style={{
                                width: `${Math.min(guardrail.query_metrics.abstain_rate_pct, 100)}%`,
                              }}
                            />
                          </div>
                          <p className="mt-1 text-[11px] text-muted">
                            {guardrail.query_metrics.total_answered} answered /{" "}
                            {guardrail.query_metrics.total_abstained} abstained of{" "}
                            {guardrail.query_metrics.total_queries} queries
                          </p>
                        </div>

                        {/* Avg confidence */}
                        {guardrail.query_metrics.avg_confidence != null && (
                          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                            <span className="text-xs font-semibold text-slate-700">
                              Avg Confidence
                            </span>
                            <span className="text-sm font-extrabold text-slate-950">
                              {(guardrail.query_metrics.avg_confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                        )}

                        {/* Citations verified */}
                        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                          <span className="text-xs font-semibold text-slate-700">
                            Citations Verified
                          </span>
                          <span className="text-sm font-extrabold text-slate-950">
                            {guardrail.query_metrics.citation_verified}
                          </span>
                        </div>

                        {/* Draft confidence breakdown */}
                        {guardrail.draft_metrics.total_drafts > 0 && (
                          <div>
                            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">
                              Draft Confidence
                            </p>
                            <div className="flex gap-2">
                              {[
                                { label: "High", value: guardrail.draft_metrics.high_confidence, color: "bg-emerald-500" },
                                { label: "Low", value: guardrail.draft_metrics.low_confidence, color: "bg-amber-500" },
                                { label: "None", value: guardrail.draft_metrics.no_confidence, color: "bg-rose-400" },
                              ].map((seg) => (
                                <div key={seg.label} className="flex-1 rounded-xl bg-slate-50 p-2 text-center">
                                  <p className="text-sm font-extrabold text-slate-950">{seg.value}</p>
                                  <div className="mx-auto mt-1 flex items-center gap-1">
                                    <span className={`h-1.5 w-1.5 rounded-full ${seg.color}`} />
                                    <span className="text-[10px] text-muted">{seg.label}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Top abstention reasons */}
                        {Object.keys(guardrail.query_metrics.abstain_reasons).length > 0 && (
                          <div>
                            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">
                              Abstention Reasons
                            </p>
                            <div className="space-y-1">
                              {Object.entries(guardrail.query_metrics.abstain_reasons)
                                .sort(([, a], [, b]) => b - a)
                                .slice(0, 4)
                                .map(([reason, count]) => (
                                  <div
                                    key={reason}
                                    className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5"
                                  >
                                    <span className="truncate text-[11px] text-slate-700">
                                      {reason.replace(/_/g, " ")}
                                    </span>
                                    <span className="ml-2 shrink-0 text-xs font-bold text-slate-950">
                                      {count}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-1 items-center justify-center p-4">
                        <p className="text-sm text-muted">
                          {loading ? "Loading..." : "No guardrail data yet. Run some queries first."}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-panel xl:col-span-4">
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
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
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
