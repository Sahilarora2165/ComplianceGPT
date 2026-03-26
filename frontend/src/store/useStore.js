import { create } from 'zustand'

const useStore = create((set) => ({
  // ── Pipeline state ────────────────────────────────────────────────────────
  pipelineRunning: false,
  pipelineResult: null,
  lastPipelineRun: null,

  setPipelineRunning: (v) => set({ pipelineRunning: v }),
  setPipelineResult: (result) => set({
    pipelineResult: result,
    lastPipelineRun: new Date().toISOString(),
  }),

  // ── Circulars ─────────────────────────────────────────────────────────────
  circulars: [],
  circularsLoading: false,
  setCirculars: (circulars) => set({ circulars }),
  setCircularsLoading: (v) => set({ circularsLoading: v }),

  // ── Drafts ────────────────────────────────────────────────────────────────
  drafts: [],
  draftsLoading: false,
  setDrafts: (drafts) => set({ drafts }),
  setDraftsLoading: (v) => set({ draftsLoading: v }),
  updateDraftStatus: (draftId, status) =>
    set((state) => ({
      drafts: state.drafts.map((d) =>
        d.draft_id === draftId ? { ...d, status } : d
      ),
    })),

  // ── Clients ───────────────────────────────────────────────────────────────
  clients: [],
  setClients: (clients) => set({ clients }),

  // ── Audit ─────────────────────────────────────────────────────────────────
  auditEvents: [],
  auditLoading: false,
  setAuditEvents: (events) => set({ auditEvents: events }),
  setAuditLoading: (v) => set({ auditLoading: v }),

  // ── Global notifications ──────────────────────────────────────────────────
  notifications: [],
  addNotification: (msg, type = 'info') =>
    set((state) => ({
      notifications: [
        { id: Date.now(), msg, type },
        ...state.notifications.slice(0, 4),
      ],
    })),
  removeNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  // ── Backend status ────────────────────────────────────────────────────────
  backendOnline: false,
  setBackendOnline: (v) => set({ backendOnline: v }),
}))

export default useStore
