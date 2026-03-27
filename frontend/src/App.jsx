import { useEffect, useMemo, useState } from "react";
import {
  approveDraft,
  getDashboardData,
  resetPipelineState,
  runPipeline,
  triggerDeadlineScan,
  triggerSchedulerMonitoring,
} from "./api";
import AuditTrailView from "./AuditTrailView";
import AnalystQueryView from "./AnalystQueryView";
import ClientProfilesView from "./ClientProfilesView";
import CircularsView from "./CircularsView";
import DeadlineWatchView from "./DeadlineWatchView";
import DraftReviewView from "./DraftReviewView";
import PipelineControlView from "./PipelineControlView";

const navItems = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "circulars", label: "Circulars Monitor", icon: "visibility" },
  { key: "drafts", label: "Draft Review", icon: "edit_document" },
  { key: "deadlines", label: "Deadline Watch", icon: "alarm" },
  { key: "clients", label: "Client Profiles", icon: "group" },
  { key: "analyst", label: "Analyst Query", icon: "psychology" },
  { key: "audit", label: "Audit Trail", icon: "history_edu" },
  { key: "pipeline", label: "Pipeline Control", icon: "account_tree" },
];

function getClientName(client) {
  return client?.name || client?.business_profile?.name || "Unknown Client";
}

function getClientIndustry(client) {
  return client?.industry || client?.business_profile?.industry || "Unknown Industry";
}

function getClientRiskScore(client) {
  if (typeof client?.risk_profile?.compliance_score === "number") {
    return client.risk_profile.compliance_score;
  }
  const level =
    client?.compliance_profile?.risk_level ||
    client?.risk_profile?.risk_level ||
    client?.priority ||
    "";
  if (String(level).toUpperCase() === "HIGH") return 60;
  if (String(level).toUpperCase() === "MEDIUM") return 78;
  if (String(level).toUpperCase() === "LOW") return 90;
  return 85;
}

function currency(value) {
  if (!value) return "Rs 0";
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
  const tones = {
    RBI: "bg-slate-900 text-white",
    GST: "bg-teal-700 text-white",
    IncomeTax: "bg-amber-700 text-white",
    MCA: "bg-sky-900 text-white",
    SEBI: "bg-emerald-900 text-white",
  };
  return tones[regulator] || "bg-slate-700 text-white";
}

function priorityTone(priority) {
  if (priority === "HIGH") return "bg-orange-100 text-orange-800";
  if (priority === "MEDIUM") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

function statusTone(status) {
  if (status === "approved") return "bg-emerald-100 text-emerald-800";
  if (status === "rejected") return "bg-rose-100 text-rose-800";
  return "bg-amber-100 text-amber-800";
}

function alertTone(level) {
  if (level === "MISSED" || level === "CRITICAL") {
    return "border-l-danger text-danger";
  }
  return "border-l-warning text-warning";
}

function App() {
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [data, setData] = useState({
    pipeline: null,
    circulars: null,
    drafts: null,
    deadlines: null,
    clients: null,
    audit: null,
    scheduler: null,
  });
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState("");

  useEffect(() => {
    let ignore = false;

    async function load() {
      setLoading(true);
      const next = await getDashboardData();
      if (!ignore) {
        setData(next);
        setLoading(false);
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, []);

  async function reloadDashboard() {
    const next = await getDashboardData();
    setData(next);
    setLoading(false);
    return next;
  }

  const circulars = useMemo(() => {
    const circularApiItems = data.circulars?.circulars;
    const pipelineItems = data.pipeline?.match_results;
    const items =
      circularApiItems && circularApiItems.length > 0
        ? circularApiItems
        : pipelineItems && pipelineItems.length > 0
          ? pipelineItems
          : [];
    return items.slice(0, 5);
  }, [data.circulars, data.pipeline]);

  const drafts = useMemo(() => (data.drafts?.drafts || []).slice(0, 4), [data.drafts]);
  const deadlines = useMemo(() => (data.deadlines?.alerts || []).slice(0, 3), [data.deadlines]);
  const clients = useMemo(() => data.clients?.clients || [], [data.clients]);
  const allDrafts = useMemo(() => data.drafts?.drafts || [], [data.drafts]);
  const allDeadlines = useMemo(() => data.deadlines?.alerts || [], [data.deadlines]);
  const allCirculars = useMemo(() => data.pipeline?.match_results || [], [data.pipeline]);
  const auditEvents = useMemo(() => data.audit?.events || [], [data.audit]);
  const scheduler = useMemo(() => data.scheduler || null, [data.scheduler]);

  const metrics = useMemo(() => {
    const totalExposure =
      data.deadlines?.summary?.total_exposure ||
      (data.deadlines?.alerts || []).reduce(
        (sum, alert) => sum + (alert.exposure?.exposure_rupees || 0),
        0,
      );

    const urgentDrafts = (data.drafts?.drafts || []).filter(
      (draft) => draft.status === "pending_review" && draft.risk_level === "HIGH",
    ).length;

    return {
      circulars: data.pipeline?.total_circulars || circulars.length,
      affectedClients:
        data.pipeline?.total_matches ||
        circulars.reduce((sum, item) => sum + (item.match_count || 0), 0),
      pendingDrafts:
        (data.drafts?.drafts || []).filter((draft) => draft.status === "pending_review").length ||
        data.pipeline?.total_drafts ||
        0,
      urgentDrafts,
      deadlineAlerts: data.deadlines?.total || deadlines.length,
      totalExposure,
    };
  }, [data, circulars, deadlines]);

  const topRiskClients = useMemo(() => {
    return [...clients]
      .sort((a, b) => getClientRiskScore(a) - getClientRiskScore(b))
      .slice(0, 4);
  }, [clients]);

  const urgentCirculars = useMemo(
    () => allCirculars.filter((item) => item.priority === "HIGH").slice(0, 3),
    [allCirculars],
  );

  const urgentDraftQueue = useMemo(
    () =>
      allDrafts
        .filter((draft) => draft.status === "pending_review")
        .sort((a, b) => {
          const left = a.risk_level === "HIGH" ? 0 : a.risk_level === "MEDIUM" ? 1 : 2;
          const right = b.risk_level === "HIGH" ? 0 : b.risk_level === "MEDIUM" ? 1 : 2;
          return left - right;
        })
        .slice(0, 3),
    [allDrafts],
  );

  const urgentDeadlines = useMemo(
    () =>
      allDeadlines
        .filter((alert) => alert.level === "MISSED" || alert.level === "CRITICAL")
        .slice(0, 3),
    [allDeadlines],
  );

  async function refresh(action, label, successLabel = `${label} completed`) {
    setActionMessage(`${label} in progress`);
    try {
      await action();
      await reloadDashboard();
      setActionMessage(successLabel);
    } catch (error) {
      setActionMessage(`${label} failed`);
    }
  }

  async function handleRunPipeline({ simulateMode, reset, label }) {
    setActionMessage(`${label} starting`);
    try {
      await runPipeline({ simulateMode, reset });
      setActionMessage(`${label} started. Waiting for progress updates...`);
      pollPipelineCompletion(label);
    } catch (error) {
      setActionMessage(`${label} failed`);
    }
  }

  function pollPipelineCompletion(label) {
    let attempts = 0;
    const maxAttempts = 180;

    const timer = setInterval(async () => {
      attempts += 1;
      try {
        const next = await reloadDashboard();
        const pipelineStatus = next.pipeline?.status;
        const statusMessage = next.pipeline?.status_message;

        if (statusMessage) {
          setActionMessage(statusMessage);
        }

        if (pipelineStatus === "completed") {
          clearInterval(timer);
          setActionMessage(
            `${label} finished: ${next.pipeline?.total_circulars || 0} circulars, ${next.pipeline?.total_matches || 0} matches`,
          );
          return;
        }

        if (pipelineStatus === "failed") {
          clearInterval(timer);
          setActionMessage(statusMessage || `${label} failed`);
          return;
        }
      } catch (error) {
        // Keep polling through transient backend reloads.
      }

      if (attempts >= maxAttempts) {
        clearInterval(timer);
        setActionMessage(`${label} is still running. The latest visible state has been refreshed.`);
      }
    }, 2000);
  }

  const pageMeta =
    currentPage === "circulars"
      ? {
          eyebrow: "Circular Intelligence Workspace",
          subtitle: "Track new regulator updates, assess impact, and route action faster",
        }
      : currentPage === "drafts"
        ? {
            eyebrow: "Draft Governance Workspace",
            subtitle: "Review AI-generated compliance advisories before client delivery",
          }
        : currentPage === "deadlines"
          ? {
              eyebrow: "Deadline Intelligence Workspace",
              subtitle: "Track filing risk, upcoming obligations, and exposure across clients",
            }
          : currentPage === "clients"
            ? {
                eyebrow: "Client Intelligence Workspace",
                subtitle: "Review client compliance footprint, obligations, and risk context",
              }
            : currentPage === "audit"
              ? {
                  eyebrow: "Workflow Traceability Workspace",
                  subtitle: "Review system actions, agent activity, and compliance workflow history",
                }
              : currentPage === "analyst"
                ? {
                    eyebrow: "Research Intelligence Workspace",
                    subtitle: "Ask compliance questions and retrieve grounded answers from the knowledge base",
                  }
              : currentPage === "pipeline"
                ? {
                    eyebrow: "Execution Control Workspace",
                    subtitle: "Operate monitoring runs, inspect latest execution state, and manage scheduler visibility",
                  }
      : {
          eyebrow: "Compliance Operations Workspace",
          subtitle: "Dashboard overview for monitoring, drafting, and deadline response",
        };

  async function handleDraftDecision(draftId, approved) {
    const label = approved ? "Approving draft" : "Rejecting draft";
    setActionMessage(label);
    try {
      await approveDraft(draftId, approved, "CA");
      await reloadDashboard();
      setActionMessage(approved ? "Draft approved" : "Draft rejected");
    } catch (error) {
      setActionMessage(approved ? "Draft approval failed" : "Draft rejection failed");
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <aside className="fixed left-0 top-0 hidden h-screen w-72 flex-col border-r border-white/10 bg-hero px-5 py-8 text-white lg:flex">
        <div className="mb-8 px-3">
          <p className="font-headline text-xl font-extrabold tracking-[0.18em]">ComplianceGPT</p>
          <p className="mt-2 text-xs uppercase tracking-[0.35em] text-teal-100/60">
            Sovereign Auditor
          </p>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setCurrentPage(item.key)}
              className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                currentPage === item.key
                  ? "bg-white/12 text-white shadow-lg backdrop-blur"
                  : "text-slate-200/70 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className="material-symbols-outlined text-xl">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.25em] text-teal-100/60">Scheduler</p>
          <p className="mt-3 font-headline text-lg font-bold">
            {data.pipeline?.last_run ? "Monitoring synced" : "Waiting for first run"}
          </p>
          <p className="mt-2 text-sm text-slate-200/70">{formatDate(data.pipeline?.last_run)}</p>
        </div>
      </aside>

      <main className="min-h-screen lg:ml-72">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-canvas/90 px-5 py-4 backdrop-blur md:px-8 xl:px-10">
          <div className="flex items-center justify-between gap-4">
            <div className="xl:col-start-1">
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-muted">{pageMeta.eyebrow}</p>
              <p className="mt-1 text-sm text-slate-700">{pageMeta.subtitle}</p>
            </div>

            <div className="ml-auto flex items-center gap-4">
              <span className="material-symbols-outlined cursor-pointer text-muted transition hover:text-ink">
                search
              </span>
              <div className="relative">
                <span className="material-symbols-outlined cursor-pointer text-muted transition hover:text-ink">
                  notifications
                </span>
                <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-danger" />
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-shell text-sm font-bold text-white">
                CA
              </div>
            </div>
          </div>
        </header>

        <div className="space-y-8 px-5 py-8 md:px-8 xl:px-10">
          {currentPage === "circulars" ? (
            <CircularsView
              actionMessage={actionMessage}
              allCirculars={allCirculars}
              allDrafts={allDrafts}
              loading={loading}
              pipeline={data.pipeline}
              onRunDemo={() =>
                handleRunPipeline({
                  simulateMode: true,
                  reset: true,
                  label: "Demo pipeline",
                })
              }
              onRunReal={() =>
                handleRunPipeline({
                  simulateMode: false,
                  reset: false,
                  label: "Real monitoring",
                })
              }
            />
          ) : currentPage === "drafts" ? (
            <DraftReviewView
              actionMessage={actionMessage}
              allDrafts={allDrafts}
              loading={loading}
              onApproveDraft={(draftId) => handleDraftDecision(draftId, true)}
              onRejectDraft={(draftId) => handleDraftDecision(draftId, false)}
            />
          ) : currentPage === "deadlines" ? (
            <DeadlineWatchView
              actionMessage={actionMessage}
              allDeadlines={allDeadlines}
              deadlineSummary={data.deadlines?.summary}
              loading={loading}
              onTriggerScan={() => refresh(triggerDeadlineScan, "Deadline scan")}
            />
          ) : currentPage === "clients" ? (
            <ClientProfilesView clients={clients} loading={loading} />
          ) : currentPage === "audit" ? (
            <AuditTrailView events={auditEvents} loading={loading} />
          ) : currentPage === "analyst" ? (
            <AnalystQueryView />
          ) : currentPage === "pipeline" ? (
            <PipelineControlView
              actionMessage={actionMessage}
              loading={loading}
              pipeline={data.pipeline}
              scheduler={scheduler}
              onRunDemo={() =>
                handleRunPipeline({
                  simulateMode: true,
                  reset: true,
                  label: "Demo pipeline",
                })
              }
              onRunReal={() =>
                handleRunPipeline({
                  simulateMode: false,
                  reset: false,
                  label: "Real monitoring",
                })
              }
              onResetPipeline={() => refresh(resetPipelineState, "Pipeline reset", "Pipeline state reset")}
              onTriggerScheduler={() =>
                refresh(
                  triggerSchedulerMonitoring,
                  "Scheduler trigger",
                  "Scheduler monitoring triggered",
                )
              }
            />
          ) : currentPage !== "dashboard" ? (
            <section className="rounded-3xl bg-white p-10 shadow-panel">
              <h1 className="font-headline text-3xl font-extrabold text-slate-950">
                {navItems.find((item) => item.key === currentPage)?.label}
              </h1>
              <p className="mt-3 max-w-2xl text-lg text-muted">
                This screen is next in the build sequence. The app shell is now ready for us to add
                more pages one by one.
              </p>
            </section>
          ) : (
            <>
          <section className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <h1 className="font-headline text-4xl font-extrabold tracking-tight text-slate-950">
                Compliance Command Center
              </h1>
              <p className="mt-3 max-w-2xl text-lg leading-8 text-muted">
                AI monitoring of regulators, affected-client detection, draft generation, deadline
                risk tracking, and analyst search for Indian CA firms.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() =>
                  handleRunPipeline({
                    simulateMode: true,
                    reset: true,
                    label: "Demo pipeline",
                  })
                }
                className="rounded-xl bg-shell px-6 py-3 text-sm font-semibold text-white transition hover:bg-shellSoft"
              >
                Run Demo Pipeline
              </button>
              <button
                onClick={() =>
                  handleRunPipeline({
                    simulateMode: false,
                    reset: false,
                    label: "Real monitoring",
                  })
                }
                className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
              >
                Run Real Monitoring
              </button>
              <button
                onClick={() => refresh(triggerDeadlineScan, "Deadline scan")}
                className="rounded-xl border border-line bg-card px-6 py-3 text-sm font-semibold text-muted transition hover:border-slate-300 hover:text-ink"
              >
                Trigger Scan
              </button>
            </div>
          </section>

          {actionMessage ? (
            <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
              {actionMessage}
            </div>
          ) : null}

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              title="New Circulars"
              value={metrics.circulars}
              meta={`${circulars.length} shown on dashboard`}
              icon="policy"
              tone="accent"
            />
            <MetricCard
              title="Affected Clients"
              value={metrics.affectedClients}
              meta={`${clients.length} total client records`}
              icon="group"
              tone="accent"
            />
            <MetricCard
              title="Pending Draft Reviews"
              value={metrics.pendingDrafts}
              meta={`${metrics.urgentDrafts} high-risk pending`}
              icon="pending_actions"
              tone="accent"
            />
            <MetricCard
              title="Upcoming Deadline Alerts"
              value={metrics.deadlineAlerts}
              meta="Live from Deadline Watch"
              icon="alarm"
              tone="danger"
            />
            <MetricCard
              title="Total Exposure At Risk"
              value={currency(metrics.totalExposure)}
              meta="Estimated from active alerts"
              icon="monetization_on"
              tone="warning"
            />
          </section>

          <div className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-3">
            <div>
              <Panel
                title="What Changed Today"
                icon="rss_feed"
                actionLabel="Open Circulars Monitor"
                className="h-full min-h-[238px]"
              >
                <div className="space-y-4">
                  {urgentCirculars.length ? (
                    urgentCirculars.map((item) => (
                      <div
                        key={`${item.regulator}-${item.circular_title}`}
                        className="flex flex-col gap-4 rounded-2xl border border-transparent px-4 py-4 transition hover:border-line hover:bg-slate-50 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="flex gap-4">
                          <div
                            className={`flex h-11 w-11 items-center justify-center rounded-xl text-xs font-bold ${regulatorTone(
                              item.regulator,
                            )}`}
                          >
                            {item.regulator}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {item.circular_title}
                            </p>
                            <p className="mt-1 text-xs text-muted">
                              Affected Clients:{" "}
                              <span className="font-bold text-slate-800">
                                {item.match_count || 0}
                              </span>
                              {" • "}
                              {(item.summary || "Regulatory update ready for review").slice(0, 100)}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`inline-flex w-fit rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] ${priorityTone(
                            item.priority,
                          )}`}
                        >
                          {item.priority || "LOW"} Priority
                        </span>
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      message={
                        loading ? "Loading activity..." : "No high-priority circulars to highlight."
                      }
                    />
                  )}
                </div>
              </Panel>

            </div>

            <div className="xl:order-3">
              <Panel
                title="Needs Review Next"
                icon="assignment"
                actionLabel="Open Draft Review"
                className="h-full min-h-[238px]"
              >
                <div className="space-y-4">
                  {urgentDraftQueue.length ? (
                    urgentDraftQueue.map((draft) => (
                      <button
                        key={draft.draft_id}
                        onClick={() => setCurrentPage("drafts")}
                        className="block w-full rounded-2xl bg-slate-50 px-4 py-4 text-left transition hover:bg-slate-100"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-bold text-slate-900">{draft.client_name}</p>
                            <p className="mt-1 text-xs text-muted">
                              {draft.regulator} • {draft.circular_title}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${statusTone(
                              draft.status,
                            )}`}
                          >
                            {draft.status}
                          </span>
                        </div>
                        <p className="mt-3 text-xs font-semibold text-slate-700">
                          Risk: {draft.risk_level} • Deadline: {draft.deadline || "No deadline"}
                        </p>
                      </button>
                    ))
                  ) : (
                    <EmptyState
                      message={
                        loading ? "Loading pending approvals..." : "No pending draft approvals right now."
                      }
                    />
                  )}
                </div>
              </Panel>
            </div>

            <div className="xl:order-2">
              <Panel title="Critical Now" icon="radar" className="h-full min-h-[238px]">
                <div className="space-y-6">
                  {urgentDeadlines.length ? (
                    urgentDeadlines.map((alert) => (
                      <div
                        key={alert.alert_id}
                        className={`border-l-4 pl-4 ${alertTone(alert.level)}`}
                      >
                        <p className="text-[11px] font-black uppercase tracking-[0.2em]">
                          {alert.level} • {alert.due_date}
                        </p>
                        <p className="mt-1 text-sm font-bold text-slate-900">
                          {alert.client_name} — {alert.obligation_type}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {alert.client_name} • Exposure: {alert.exposure?.exposure_label || "N/A"}
                        </p>
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      message={
                        loading ? "Loading alerts..." : "No missed or critical deadline alerts."
                      }
                    />
                  )}
                </div>
              </Panel>
            </div>
          </div>

          <div className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-3">
            <Panel title="Top Risk Clients" icon="priority_high" className="h-full min-h-[276px]">
              <div className="space-y-4">
                {topRiskClients.length ? (
                  topRiskClients.map((client) => {
                    const score = getClientRiskScore(client);
                    const clientName = getClientName(client);
                    const initials = clientName
                      .split(" ")
                      .slice(0, 2)
                      .map((part) => part[0])
                      .join("")
                      .toUpperCase();
                    const barTone = score < 70 ? "bg-danger" : score < 85 ? "bg-warning" : "bg-accent";

                    return (
                      <div key={client.id} className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                            {initials}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{clientName}</p>
                            <p className="text-xs text-muted">{getClientIndustry(client)}</p>
                          </div>
                        </div>
                        <div className="w-24 text-right">
                          <p className="text-xs font-bold text-slate-700">Score: {score}/100</p>
                          <div className="mt-1 h-1.5 rounded-full bg-slate-200">
                            <div
                              className={`h-1.5 rounded-full ${barTone}`}
                              style={{ width: `${score}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <EmptyState
                    message={loading ? "Loading client risk..." : "No client profiles available."}
                  />
                )}
              </div>
            </Panel>

            <QuickActionCard
              title="Ask the Analyst"
              description="Use the research workspace for grounded answers on recent regulator changes, filing obligations, and document-backed interpretations."
              actionLabel="Open Analyst Query"
              onAction={() => setCurrentPage("analyst")}
              icon="psychology"
              tone="accent"
              className="h-full min-h-[276px]"
            />

            <section className="relative h-full overflow-hidden rounded-3xl bg-hero p-8 text-white shadow-panel">
              <div className="relative z-10">
                <div className="mb-6 flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full bg-teal-300 shadow-[0_0_14px_rgba(94,234,212,0.8)]" />
                  <h3 className="font-headline text-lg font-bold">Pipeline Status</h3>
                </div>

                <div className="space-y-4 text-[11px] uppercase tracking-[0.22em] text-slate-300">
                  <StatusRow label="Last Run" value={formatDate(data.pipeline?.last_run)} />
                  <StatusRow
                    label="Run Mode"
                    value={data.pipeline?.run_mode || "Waiting for pipeline"}
                  />
                  <StatusRow
                    label="Processed"
                    value={`${data.pipeline?.total_circulars || 0} circulars`}
                  />
                  <StatusRow
                    label="Drafts"
                    value={`${data.pipeline?.total_drafts || drafts.length} generated`}
                  />
                  <StatusRow
                    label="Scheduler"
                    value={data.pipeline ? "API connected" : "No recent status"}
                  />
                </div>

                <button
                  onClick={() =>
                    handleRunPipeline({
                      simulateMode: true,
                      reset: true,
                      label: "Demo pipeline",
                    })
                  }
                  className="mt-8 w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/20"
                >
                  Run Demo Pipeline
                </button>
              </div>
            </section>
          </div>
            </>
          )}
        </div>

        <footer className="mt-auto flex flex-col gap-4 border-t border-slate-200 bg-slate-50 px-5 py-6 text-xs font-medium uppercase tracking-[0.18em] text-muted md:flex-row md:items-center md:justify-between md:px-8 xl:px-10">
          <p>AI-assisted compliance workflow for CA firms. Human review required before client communication.</p>
          <div className="flex gap-4">
            <a href="#" className="transition hover:text-slate-900">
              Privacy Policy
            </a>
            <a href="#" className="transition hover:text-slate-900">
              Terms of Service
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}

function MetricCard({ title, value, meta, icon, tone }) {
  const accentClass =
    tone === "danger"
      ? "border-danger"
      : tone === "warning"
        ? "border-warning"
        : "border-accent";
  const iconClass =
    tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-accent";

  return (
    <section className={`rounded-3xl border-l-4 ${accentClass} bg-card p-5 shadow-panel`}>
      <div className="mb-4 flex items-start justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">{title}</span>
        <span className={`material-symbols-outlined opacity-60 ${iconClass}`}>{icon}</span>
      </div>
      <div className="text-3xl font-bold text-slate-950">{value}</div>
      <p className="mt-2 text-xs font-medium text-muted">{meta}</p>
    </section>
  );
}

function Panel({ title, icon, children, actionLabel, className = "" }) {
  return (
    <section className={`rounded-3xl bg-white p-6 shadow-panel ${className}`}>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="flex items-center gap-2 font-headline text-xl font-bold text-slate-950">
          <span className="material-symbols-outlined text-accent">{icon}</span>
          {title}
        </h3>
        {actionLabel ? (
          <button className="text-xs font-bold uppercase tracking-[0.18em] text-accent hover:underline">
            {actionLabel}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function StatusRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <span className="text-right font-semibold normal-case tracking-normal text-white">{value}</span>
    </div>
  );
}

function QuickActionCard({
  title,
  description,
  actionLabel,
  onAction,
  icon,
  tone = "accent",
  className = "",
}) {
  const iconTone =
    tone === "danger"
      ? "bg-rose-100 text-rose-700"
      : tone === "warning"
        ? "bg-amber-100 text-amber-700"
        : "bg-teal-100 text-teal-700";

  return (
    <section className={`rounded-3xl bg-white p-6 shadow-panel ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-headline text-lg font-bold text-slate-950">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${iconTone}`}>
          <span className="material-symbols-outlined">{icon}</span>
        </div>
      </div>
      <button
        onClick={onAction}
        className="mt-5 text-sm font-bold text-accent transition hover:underline"
      >
        {actionLabel}
      </button>
    </section>
  );
}

function EmptyState({ message }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-muted">
      {message}
    </div>
  );
}

export default App;
