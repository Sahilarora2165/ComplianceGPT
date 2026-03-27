const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:8000";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export function getDashboardData() {
  return Promise.allSettled([
    request("/pipeline/status"),
    request("/circulars"),
    request("/drafts"),
    request("/deadlines"),
    request("/compliance-calendar"),
    request("/clients"),
    request("/audit"),
    request("/scheduler/status"),
  ]).then(([pipeline, circulars, drafts, deadlines, calendar, clients, audit, scheduler]) => ({
    pipeline: pipeline.status === "fulfilled" ? pipeline.value : null,
    circulars: circulars.status === "fulfilled" ? circulars.value : null,
    drafts: drafts.status === "fulfilled" ? drafts.value : null,
    deadlines: deadlines.status === "fulfilled" ? deadlines.value : null,
    calendar: calendar.status === "fulfilled" ? calendar.value : null,
    clients: clients.status === "fulfilled" ? clients.value : null,
    audit: audit.status === "fulfilled" ? audit.value : null,
    scheduler: scheduler.status === "fulfilled" ? scheduler.value : null,
  }));
}

export function runPipeline({ simulateMode = true, reset = false } = {}) {
  return request("/pipeline/run", {
    method: "POST",
    body: JSON.stringify({ simulate_mode: simulateMode, reset }),
  });
}

export function triggerDeadlineScan() {
  return request("/deadlines/scan", {
    method: "POST",
  });
}

export function sendDeadlineAlert(alertId, caName = "CA") {
  return request(`/deadlines/${alertId}/send?ca_name=${encodeURIComponent(caName)}`, {
    method: "POST",
  });
}

export function approveDraft(draftId, approved, caName = "CA") {
  return request(`/drafts/${draftId}/approve`, {
    method: "POST",
    body: JSON.stringify({ approved, ca_name: caName }),
  });
}

export function resetPipelineState() {
  return request("/pipeline/reset", {
    method: "POST",
  });
}

export function triggerSchedulerMonitoring() {
  return request("/scheduler/trigger", {
    method: "POST",
  });
}

export function queryAnalyst({ question, filters = {}, activeDocument = null }) {
  return request("/query", {
    method: "POST",
    body: JSON.stringify({ question, filters, active_document: activeDocument }),
  });
}

export function getComplianceCalendar() {
  return request("/compliance-calendar");
}

export function createClient(client) {
  return request("/clients", {
    method: "POST",
    body: JSON.stringify(client),
  });
}

export function updateClient(clientId, client) {
  return request(`/clients/${clientId}`, {
    method: "PUT",
    body: JSON.stringify(client),
  });
}

export function deleteClient(clientId) {
  return request(`/clients/${clientId}`, { method: "DELETE" });
}
