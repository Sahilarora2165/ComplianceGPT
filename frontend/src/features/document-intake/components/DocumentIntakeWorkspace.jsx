import { useMemo, useState } from "react";
import { formatDate } from "@/shared/ui";

const REGULATOR_OPTIONS = ["Auto-Detect (Recommended)", "RBI", "GST", "IncomeTax", "MCA", "SEBI"];

function UploadFact({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-900">{value}</p>
    </div>
  );
}

function extractEventTitle(event) {
  if (event?.details?.title) return event.details.title;
  if (event?.details?.filename) return event.details.filename;
  if (event?.details?.file_name) return event.details.file_name;
  if (event?.details?.document_title) return event.details.document_title;
  return "Uploaded Document";
}

function extractEventRegulator(event) {
  return (
    event?.details?.regulator ||
    event?.details?.tagged_regulator ||
    event?.details?.document_regulator ||
    "Unknown"
  );
}

function extractEventUploader(event) {
  return event?.details?.uploaded_by || event?.details?.ca_name || event?.details?.user || "CA";
}

export default function DocumentIntakeWorkspace({
  onUploadDocument,
  onRunUploadedDocumentPipeline,
  uploadHistory = [],
  compact = false,
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [regulator, setRegulator] = useState("RBI");
  const [title, setTitle] = useState("");
  const [uploadedBy, setUploadedBy] = useState("CA");
  const [uploadedDocument, setUploadedDocument] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [runningFullFlow, setRunningFullFlow] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [kbOnlyConfirmed, setKbOnlyConfirmed] = useState(false);

  const recentUploads = useMemo(
    () =>
      uploadHistory
        .filter((event) => {
          const combined = `${event?.action || ""} ${JSON.stringify(event?.details || {})}`.toLowerCase();
          return combined.includes("upload") || combined.includes("ingest") || combined.includes("document");
        })
        .slice(0, 6),
    [uploadHistory],
  );

  async function handleUploadSubmit(event) {
    event.preventDefault();
    setUploadError("");

    if (!selectedFile) {
      setUploadError("Please select a PDF or TXT file.");
      return;
    }

    const fileName = selectedFile.name?.toLowerCase() || "";
    if (!fileName.endsWith(".pdf") && !fileName.endsWith(".txt")) {
      setUploadError("Only PDF and TXT files are supported.");
      return;
    }

    if (!title.trim()) {
      setUploadError("Please enter a document title.");
      return;
    }

    // Regulator is now optional - auto-detect if not selected
    const regulatorToUpload = regulator === "Auto-Detect (Recommended)" ? "" : regulator;

    setUploading(true);
    setKbOnlyConfirmed(false);

    try {
      const response = await onUploadDocument({
        file: selectedFile,
        regulator: regulatorToUpload,  // Empty string triggers auto-detect on backend
        title: title.trim(),
        uploadedBy: uploadedBy.trim() || "CA",
      });
      setUploadedDocument(response?.document || null);
    } catch {
      setUploadError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleRunDocumentPipeline() {
    if (!uploadedDocument || runningFullFlow) return;
    setRunningFullFlow(true);
    setUploadError("");
    try {
      await onRunUploadedDocumentPipeline(uploadedDocument.document_id, uploadedDocument.title);
      setKbOnlyConfirmed(false);
    } catch {
      setUploadError("Could not start full processing for this document.");
    } finally {
      setRunningFullFlow(false);
    }
  }

  function handleKnowledgeBaseOnly() {
    setKbOnlyConfirmed(true);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-muted">
          Document Intake
        </p>
        <h2 className="font-headline text-2xl font-extrabold leading-tight tracking-tight text-slate-950">
          Upload Circular
        </h2>
        <p className="text-sm text-slate-600">
          Upload a PDF or TXT circular, verify extraction, then choose knowledge-base only or full processing.
        </p>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-panel space-y-5">
        <div className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-muted">
            Step 1 · Upload Document
          </p>
          <p className="text-sm text-slate-600">
            Allowed formats: PDF and TXT only. Regulator auto-detection is enabled by default — manual selection is optional.
          </p>
        </div>

        <form onSubmit={handleUploadSubmit} className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="xl:col-span-4">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">File</span>
              <input
                type="file"
                accept=".pdf,.txt"
                onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                className="w-full rounded-xl border border-line bg-slate-50 px-3 py-2.5 text-sm outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white focus:border-accent focus:bg-white"
              />
            </label>
          </div>

          <div className="xl:col-span-2">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Regulator</span>
              <select
                value={regulator}
                onChange={(event) => setRegulator(event.target.value)}
                className="w-full rounded-xl border border-line bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-accent focus:bg-white"
              >
                {REGULATOR_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="xl:col-span-4">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="RBI Circular: ... / GST Advisory: ..."
                className="w-full rounded-xl border border-line bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-accent focus:bg-white"
              />
            </label>
          </div>

          <div className="xl:col-span-2">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Uploaded By</span>
              <input
                value={uploadedBy}
                onChange={(event) => setUploadedBy(event.target.value)}
                className="w-full rounded-xl border border-line bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-accent focus:bg-white"
              />
            </label>
          </div>

          <div className="xl:col-span-12">
            <button
              type="submit"
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-base">upload_file</span>
              {uploading ? "Uploading..." : "Upload & Extract"}
            </button>
          </div>
        </form>

        {uploadError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {uploadError}
          </div>
        ) : null}

        {uploadedDocument ? (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-muted">
                Step 2 · Verify Extraction
              </p>
              <p className="text-sm text-slate-600">
                Review parsed output before choosing the next action.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <UploadFact label="Regulator" value={uploadedDocument.regulator} />
              <UploadFact label="Pages" value={uploadedDocument.ingest?.pages ?? 0} />
              <UploadFact label="Chunks" value={uploadedDocument.ingest?.chunks ?? 0} />
              <UploadFact label="OCR Used" value={uploadedDocument.ingest?.used_ocr ? "Yes" : "No"} />
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted">First Chunk Preview</p>
              <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">
                {uploadedDocument.ingest?.first_chunk_preview || "No text preview extracted."}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-muted">
                Step 3 · Choose Processing Mode
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleKnowledgeBaseOnly}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition"
                >
                  Add To Knowledge Base Only
                </button>
                <button
                  onClick={handleRunDocumentPipeline}
                  disabled={runningFullFlow}
                  className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {runningFullFlow ? "Starting Full Processing..." : "Run Full Processing"}
                </button>
              </div>
              {kbOnlyConfirmed ? (
                <p className="text-xs text-emerald-700">
                  Stored in knowledge base only. Analyst Query can cite this document immediately.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {!compact && (
        <div className="rounded-2xl bg-white p-5 shadow-panel">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-headline text-base font-bold text-slate-950">Recent Uploads</h3>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
              {recentUploads.length}
            </span>
          </div>

          {recentUploads.length ? (
            <div className="space-y-2">
              {recentUploads.map((event, index) => (
                <div
                  key={`${event.timestamp || "upload"}-${index}`}
                  className="rounded-xl border border-slate-200 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-slate-900">{extractEventTitle(event)}</p>
                    <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">
                      {extractEventRegulator(event)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Uploaded by {extractEventUploader(event)} · {formatDate(event.timestamp)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-muted">
              No recent uploads in audit trail yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
