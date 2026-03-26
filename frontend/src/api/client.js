import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 120000, // 2 min — pipeline takes time
})

// ── Pipeline ──────────────────────────────────────────────────────────────────
export const runPipeline = (simulateMode = true, reset = false, regulators = null) =>
  api.post('/pipeline/run', { simulate_mode: simulateMode, reset, regulators })

export const getPipelineStatus = () =>
  api.get('/pipeline/status')

export const resetPipeline = () =>
  api.post('/pipeline/reset')

// ── Circulars ─────────────────────────────────────────────────────────────────
export const getCirculars = () =>
  api.get('/circulars')

export const getSimulatedCirculars = () =>
  api.get('/circulars/simulate')

// ── Drafts ────────────────────────────────────────────────────────────────────
export const getDrafts = (status = null) =>
  api.get('/drafts', { params: status ? { status } : {} })

export const getDraft = (draftId) =>
  api.get(`/drafts/${draftId}`)

export const approveDraft = (draftId, approved, caName = 'CA') =>
  api.post(`/drafts/${draftId}/approve`, { approved, ca_name: caName })

export const deleteDraft = (draftId) =>
  api.delete(`/drafts/${draftId}`)

// ── Clients ───────────────────────────────────────────────────────────────────
export const getClients = () =>
  api.get('/clients')

// ── RAG Query ─────────────────────────────────────────────────────────────────
export const queryCompliance = (question) =>
  api.post('/query', { question })

// ── Audit ─────────────────────────────────────────────────────────────────────
export const getAuditLog = (limit = 100, agent = null) =>
  api.get('/audit', { params: { limit, ...(agent ? { agent } : {}) } })

// ── Ingest ────────────────────────────────────────────────────────────────────
export const ingestPDF = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/ingest', form, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

// ── Health ────────────────────────────────────────────────────────────────────
export const healthCheck = () =>
  api.get('/health')