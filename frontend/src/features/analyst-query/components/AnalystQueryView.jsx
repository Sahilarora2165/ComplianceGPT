import { useEffect, useRef, useState, useCallback } from "react";
import { queryAnalyst } from "@/services/complianceApi";

// ── Constants ─────────────────────────────────────────────────────────────────

const SUGGESTED = [
  "What changed in the latest RBI circular?",
  "What is the FEMA deadline extension?",
  "Who is affected by the GST IMS advisory?",
  "What changed for TDS under Section 194C?",
];

const REGULATORS = ["All", "RBI", "GST", "IncomeTax", "MCA", "SEBI"];
const REGULATOR_UPLOAD_OPTIONS = ["RBI", "GST", "IncomeTax", "MCA", "SEBI"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function shouldUseActiveDocument(question) {
  const lower = (question || "").toLowerCase();
  if (!/\b(this|that|above|previous|same)\b/i.test(lower)) return false;
  if (/\b(rbi|gst|mca|sebi|incometax|income tax|cbdt|fema|tds|ims|circular)\b/i.test(lower)) return false;
  return true;
}

function normalizeFilters(filters) {
  return Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v != null && String(v).trim() !== ""),
  );
}

function sourceMeta(source) {
  if (!source) return "Unknown";
  return [source.regulator, source.document_date, source.page_label != null ? `p${source.page_label}` : null]
    .filter(Boolean).join(" · ");
}

function answerBubbleClass(message) {
  if (message.status === "unsupported" || message.abstained)
    return "bg-amber-50 border border-amber-200 text-amber-900";
  return "bg-white border border-slate-200 text-slate-800";
}

function RegulatorBadge({ value }) {
  const colors = {
    RBI: "bg-blue-100 text-blue-800",
    GST: "bg-orange-100 text-orange-800",
    IncomeTax: "bg-purple-100 text-purple-800",
    MCA: "bg-green-100 text-green-800",
    SEBI: "bg-rose-100 text-rose-800",
    Unknown: "bg-slate-100 text-slate-600",
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${colors[value] || colors.Unknown}`}>
      {value}
    </span>
  );
}

// ── Upload Panel (slide-in drawer inside the page) ────────────────────────────

function UploadPanel({ onUploadDocument, onRunUploadedDocumentPipeline, uploadHistory = [], onClose }) {
  const [file, setFile] = useState(null);
  const [regulator, setRegulator] = useState("RBI");
  const [title, setTitle] = useState("");
  const [uploadedBy, setUploadedBy] = useState("CA");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [kbConfirmed, setKbConfirmed] = useState(false);
  const fileRef = useRef(null);

  async function handleUpload(e) {
    e.preventDefault();
    setError("");
    if (!file) return setError("Please select a PDF or TXT file.");
    const ext = file.name?.toLowerCase();
    if (!ext.endsWith(".pdf") && !ext.endsWith(".txt")) return setError("Only PDF and TXT files accepted.");
    if (!title.trim()) return setError("Document title is required.");

    setUploading(true);
    setResult(null);
    setKbConfirmed(false);
    try {
      const res = await onUploadDocument({ file, regulator, title: title.trim(), uploadedBy: uploadedBy.trim() || "CA" });
      setResult(res?.document || null);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleRunPipeline() {
    if (!result || runningPipeline) return;
    setRunningPipeline(true);
    setError("");
    try {
      await onRunUploadedDocumentPipeline(result.document_id, result.title);
      setKbConfirmed(false);
    } catch {
      setError("Could not start full pipeline.");
    } finally {
      setRunningPipeline(false);
    }
  }

  function resetForm() {
    setFile(null);
    setTitle("");
    setResult(null);
    setError("");
    setKbConfirmed(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  const recentUploads = uploadHistory
    .filter(e => {
      const s = `${e?.action || ""} ${JSON.stringify(e?.details || {})}`.toLowerCase();
      return s.includes("upload") || s.includes("ingest") || s.includes("document");
    })
    .slice(0, 5);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Document Intake</p>
          <h3 className="mt-0.5 text-base font-bold text-slate-900">Upload Circular</h3>
        </div>
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition">
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Upload form */}
        {!result ? (
          <form onSubmit={handleUpload} className="space-y-4">
            {/* File picker */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">File</label>
              <div
                className="relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center cursor-pointer hover:border-slate-300 hover:bg-white transition"
                onClick={() => fileRef.current?.click()}
              >
                <span className="material-symbols-outlined text-3xl text-slate-300 mb-2">upload_file</span>
                {file ? (
                  <div>
                    <p className="text-sm font-semibold text-slate-800 truncate max-w-[180px]">{file.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-slate-600">Drop file or click to browse</p>
                    <p className="text-xs text-slate-400 mt-0.5">PDF or TXT only</p>
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.txt"
                  className="sr-only"
                  onChange={e => setFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>

            {/* Regulator */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Regulator *</label>
              <div className="flex flex-wrap gap-2">
                {REGULATOR_UPLOAD_OPTIONS.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRegulator(r)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      regulator === r
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-slate-400">Required — controls RAG filter for Analyst Query</p>
            </div>

            {/* Title */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Document Title *</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. RBI Circular: FEMA Extension Oct 2024"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-slate-400 focus:bg-white transition"
              />
            </div>

            {/* Uploaded By */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Uploaded By</label>
              <input
                value={uploadedBy}
                onChange={e => setUploadedBy(e.target.value)}
                placeholder="CA name"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-slate-400 focus:bg-white transition"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
            )}

            <button
              type="submit"
              disabled={uploading}
              className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Extracting...
                </span>
              ) : "Upload & Extract"}
            </button>
          </form>
        ) : (
          /* Post-upload: verify + choose action */
          <div className="space-y-4">
            {/* Extraction results */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-sm text-emerald-600">check_circle</span>
                <p className="text-xs font-semibold text-emerald-800">Extraction Complete</p>
              </div>
              <p className="text-xs text-emerald-700 truncate">{result.title}</p>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {[
                { label: "Regulator", value: result.regulator },
                { label: "Pages", value: result.ingest?.pages ?? 0 },
                { label: "Chunks", value: result.ingest?.chunks ?? 0 },
                { label: "OCR", value: result.ingest?.used_ocr ? "Yes" : "No" },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
                  <p className="mt-0.5 text-sm font-bold text-slate-900">{value}</p>
                </div>
              ))}
            </div>

            {/* First chunk preview */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Text Preview</p>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-6 text-slate-700 max-h-32 overflow-y-auto">
                {result.ingest?.first_chunk_preview || "No preview available."}
              </div>
            </div>

            {/* Action choice */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Choose Action</p>

              {kbConfirmed ? (
                <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-3 text-xs text-teal-800">
                  <span className="font-semibold">Added to knowledge base.</span> The Analyst Query can now find and cite this document. You can ask about it immediately in the chat.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setKbConfirmed(true)}
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                  >
                    <span className="flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-base">auto_stories</span>
                      Knowledge Base Only
                    </span>
                    <p className="mt-0.5 text-[10px] font-normal text-slate-400">Chatbot can query it immediately</p>
                  </button>

                  <button
                    onClick={handleRunPipeline}
                    disabled={runningPipeline}
                    className="w-full rounded-xl bg-teal-700 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 transition disabled:opacity-50"
                  >
                    <span className="flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-base">account_tree</span>
                      {runningPipeline ? "Starting Pipeline..." : "Run Full Pipeline"}
                    </span>
                    <p className="mt-0.5 text-[10px] font-normal text-teal-200">Matches clients + generates drafts</p>
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
            )}

            <button onClick={resetForm} className="w-full rounded-xl border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50 transition">
              Upload Another Document
            </button>
          </div>
        )}

        {/* Recent uploads from audit trail */}
        {recentUploads.length > 0 && (
          <div className="pt-2 border-t border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2.5">Recent Uploads</p>
            <div className="space-y-2">
              {recentUploads.map((event, i) => {
                const docTitle = event?.details?.title || event?.details?.filename || "Document";
                const reg = event?.details?.regulator || "Unknown";
                const who = event?.details?.uploaded_by || "CA";
                const when = event?.timestamp ? new Date(event.timestamp).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "–";
                return (
                  <div key={i} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <RegulatorBadge value={reg} />
                      <p className="truncate text-xs font-semibold text-slate-800">{docTitle}</p>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">{who} · {when}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Source Card ───────────────────────────────────────────────────────────────

function SourceCard({ source }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
          {source.source_id}
        </span>
        <p className="text-xs font-semibold text-slate-800 truncate max-w-[220px]">{source.title || source.source}</p>
      </div>
      <p className="text-[10px] text-slate-400 mb-1.5">{sourceMeta(source)}</p>
      <p className="text-xs leading-5 text-slate-600">{source.snippet}</p>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AnalystQueryView({
  actionMessage = "",
  onUploadDocument,
  onRunUploadedDocumentPipeline,
  uploadHistory = [],
  openIntakeSignal = 0,
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([]);
  const [expandedEvidence, setExpandedEvidence] = useState({});
  const [showUpload, setShowUpload] = useState(false);
  const [filters, setFilters] = useState({ regulator: "All", title_contains: "" });
  const [showFilters, setShowFilters] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const canUpload = Boolean(onUploadDocument && onRunUploadedDocumentPipeline);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (openIntakeSignal > 0 && canUpload) setShowUpload(true);
  }, [openIntakeSignal, canUpload]);

  const submit = useCallback(async (text) => {
    const question = (text || input).trim();
    if (!question || loading) return;

    const lastScopedAnswer = [...messages].reverse().find(
      m => m.role === "assistant" && Array.isArray(m.sources) && m.sources.length === 1
    );
    const requestFilters = normalizeFilters({
      ...filters,
      regulator: filters.regulator === "All" ? "" : filters.regulator,
    });

    setInput("");
    setError("");
    setMessages(c => [...c, { role: "user", content: question }]);
    setLoading(true);

    try {
      const result = await queryAnalyst({
        question,
        filters: requestFilters,
        activeDocument: shouldUseActiveDocument(question) ? lastScopedAnswer?.sources?.[0]?.source || null : null,
      });

      setMessages(c => [
        ...c,
        {
          role: "assistant",
          content: result?.answer?.trim() || "No answer returned.",
          sources: result?.sources || [],
          supportingQuotes: result?.supporting_quotes || [],
          abstained: Boolean(result?.abstained),
          confidence: result?.confidence,
          status: result?.status || "not_found",
          notFoundReason: result?.not_found_reason || null,
        },
      ]);
    } catch (err) {
      setError(err.message || "Query failed. Please try again.");
      setMessages(c => c.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, filters]);

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function toggleEvidence(index) {
    setExpandedEvidence(c => ({ ...c, [index]: !c[index] }));
  }

  const questionCount = messages.filter(m => m.role === "user").length;
  const answeredCount = messages.filter(m => m.role === "assistant" && m.status === "answered").length;
  const abstainedCount = messages.filter(m => m.role === "assistant" && m.abstained).length;
  const hasMessages = messages.length > 0;
  const activeFilterCount = [filters.regulator !== "All", filters.title_contains.trim() !== ""].filter(Boolean).length;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden gap-0">

      {/* ── Left: Chat pane ──────────────────────────────────────────────── */}
      <div className={`flex flex-col flex-1 min-w-0 transition-all duration-300 ${showUpload ? "xl:mr-[360px]" : ""}`}>

        {/* Page header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white shrink-0">
          <div>
            <h1 className="font-headline text-xl font-extrabold text-slate-950">Analyst Query</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Grounded answers from ingested documents · abstains when evidence is missing
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters(c => !c)}
              className={`relative inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                showFilters || activeFilterCount > 0
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className="material-symbols-outlined text-sm">filter_list</span>
              Filters
              {activeFilterCount > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-teal-500 text-[9px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Upload toggle */}
            {canUpload && (
              <button
                onClick={() => setShowUpload(c => !c)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                  showUpload
                    ? "border-teal-600 bg-teal-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span className="material-symbols-outlined text-sm">upload_file</span>
                Upload
              </button>
            )}

            {/* Clear session */}
            {hasMessages && (
              <button
                onClick={() => { setMessages([]); setExpandedEvidence({}); }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50 transition"
              >
                <span className="material-symbols-outlined text-sm">restart_alt</span>
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Filter bar — collapsible */}
        {showFilters && (
          <div className="border-b border-slate-100 bg-slate-50/80 px-6 py-3 shrink-0">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Regulator</span>
                <div className="flex gap-1.5">
                  {REGULATORS.map(r => (
                    <button
                      key={r}
                      onClick={() => setFilters(c => ({ ...c, regulator: r }))}
                      disabled={loading}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                        filters.regulator === r
                          ? "bg-slate-900 text-white"
                          : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Title Contains</span>
                <input
                  value={filters.title_contains}
                  onChange={e => setFilters(c => ({ ...c, title_contains: e.target.value }))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-slate-400 w-48"
                  placeholder="FEMA, IMS, TDS (comma = OR)"
                  disabled={loading}
                />
              </div>
              {activeFilterCount > 0 && (
                <button
                  onClick={() => setFilters({ regulator: "All", title_contains: "" })}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 transition"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}

        {actionMessage && (
          <div className="mx-6 mt-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-xs font-medium text-teal-800 shrink-0">
            {actionMessage}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {!hasMessages && !loading && (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-50 mb-4">
                <span className="material-symbols-outlined text-3xl text-teal-600">psychology</span>
              </div>
              <p className="text-base font-bold text-slate-800">Ask a compliance question</p>
              <p className="mt-1 text-sm text-slate-400 max-w-xs">
                Grounded in ingested documents only. Abstains when evidence is missing.
              </p>

              {/* Suggested questions */}
              <div className="mt-6 grid grid-cols-1 gap-2 w-full max-w-md">
                {SUGGESTED.map(q => (
                  <button
                    key={q}
                    onClick={() => submit(q)}
                    disabled={loading}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div key={index} className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                message.role === "user" ? "bg-slate-900 text-white" : "bg-teal-100 text-teal-700"
              }`}>
                {message.role === "user" ? "CA" : "AI"}
              </div>

              <div className="max-w-[84%] space-y-2">
                <div className={`rounded-2xl px-4 py-3 text-sm leading-7 whitespace-pre-wrap ${
                  message.role === "user"
                    ? "bg-slate-900 text-white rounded-tr-none"
                    : `${answerBubbleClass(message)} rounded-tl-none`
                }`}>
                  {message.content}
                </div>

                {message.role === "assistant" && (
                  <>
                    {/* Status pills */}
                    <div className="flex flex-wrap gap-1.5 pl-1">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                        message.status === "answered"
                          ? "bg-emerald-100 text-emerald-700"
                          : message.status === "unsupported"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-slate-100 text-slate-600"
                      }`}>
                        {message.status === "answered" ? "✓ Grounded" : message.status === "unsupported" ? "Unsupported" : "Not found"}
                      </span>
                      {typeof message.confidence === "number" && (
                        <span className="rounded-full bg-white border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
                          {Math.round(message.confidence * 100)}% confidence
                        </span>
                      )}
                      {message.notFoundReason && (
                        <span className="rounded-full bg-white border border-slate-200 px-2.5 py-1 text-[10px] text-slate-500 max-w-xs truncate">
                          {message.notFoundReason}
                        </span>
                      )}
                    </div>

                    {/* Evidence: always show for answered; toggle for abstained */}
                    {message.abstained ? (
                      (message.sources?.length > 0 || message.supportingQuotes?.length > 0) && (
                        <div className="pl-1 space-y-2">
                          <button
                            onClick={() => toggleEvidence(index)}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition"
                          >
                            {expandedEvidence[index] ? "Hide details" : "Why not found?"}
                          </button>
                          {expandedEvidence[index] && (
                            <div className="space-y-2">
                              {message.sources?.length > 0 && (
                                <>
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 pl-0.5">Closest Evidence</p>
                                  {message.sources.map(s => <SourceCard key={s.source_id} source={s} />)}
                                </>
                              )}
                              {message.supportingQuotes?.map(q => (
                                <blockquote key={`${q.source_id}-${q.page_label}`} className="rounded-xl border-l-4 border-teal-400 bg-teal-50 px-4 py-3 text-xs leading-5 text-slate-700">
                                  <p className="font-semibold text-slate-900 mb-1">{q.source_id} · {q.title} · p{q.page_label}</p>
                                  <p>{q.quote}</p>
                                </blockquote>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    ) : (
                      message.sources?.length > 0 && (
                        <div className="pl-1 space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Sources</p>
                          {message.sources.map(s => <SourceCard key={s.source_id} source={s} />)}
                          {message.supportingQuotes?.length > 0 && (
                            <div className="space-y-2 pt-1">
                              {message.supportingQuotes.map(q => (
                                <blockquote key={`${q.source_id}-${q.page_label}`} className="rounded-xl border-l-4 border-teal-400 bg-teal-50 px-4 py-3 text-xs leading-5 text-slate-700">
                                  <p className="font-semibold text-slate-900 mb-1">{q.source_id} · {q.title} · p{q.page_label}</p>
                                  <p>{q.quote}</p>
                                </blockquote>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    )}
                  </>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[10px] font-bold text-teal-700">AI</div>
              <div className="rounded-2xl rounded-tl-none bg-white border border-slate-200 px-4 py-3">
                <div className="flex gap-1.5 items-center h-5">
                  {[0, 150, 300].map(d => (
                    <span key={d} className="h-1.5 w-1.5 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="mx-6 mb-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 shrink-0">
            {error}
          </div>
        )}

        {/* Session stats bar — only once messages exist */}
        {hasMessages && (
          <div className="flex items-center gap-4 px-6 py-2 border-t border-slate-100 bg-slate-50/60 shrink-0">
            <span className="text-[10px] text-slate-400">
              <span className="font-semibold text-slate-700">{questionCount}</span> asked
            </span>
            <span className="text-[10px] text-slate-400">
              <span className="font-semibold text-emerald-700">{answeredCount}</span> grounded
            </span>
            <span className="text-[10px] text-slate-400">
              <span className="font-semibold text-amber-600">{abstainedCount}</span> abstained
            </span>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-slate-100 px-6 py-4 bg-white shrink-0">
          {/* Suggested when messages exist */}
          {hasMessages && (
            <div className="flex gap-2 mb-3 overflow-x-auto pb-1 scrollbar-hide">
              {SUGGESTED.map(q => (
                <button
                  key={q}
                  onClick={() => submit(q)}
                  disabled={loading}
                  className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 transition disabled:opacity-40"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-3 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              rows={2}
              className="flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-slate-400 focus:bg-white transition"
              placeholder="Ask a compliance question… (Enter to send, Shift+Enter for new line)"
              disabled={loading}
            />
            <button
              onClick={() => submit()}
              disabled={loading || !input.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white hover:bg-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-base">send</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Right: Upload drawer ──────────────────────────────────────────── */}
      {showUpload && canUpload && (
        <div className="fixed right-0 top-0 h-full w-[360px] bg-white border-l border-slate-200 shadow-xl flex flex-col z-30 overflow-hidden">
          <UploadPanel
            onUploadDocument={onUploadDocument}
            onRunUploadedDocumentPipeline={onRunUploadedDocumentPipeline}
            uploadHistory={uploadHistory}
            onClose={() => setShowUpload(false)}
          />
        </div>
      )}
    </div>
  );
}