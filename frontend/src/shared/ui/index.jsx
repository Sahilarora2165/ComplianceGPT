// ─── Formatting ───────────────────────────────────────────────
export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function timeAgo(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? "Yesterday" : `${diffDays}d ago`;
}

export function formatCurrency(value) {
  if (typeof value !== "number" || isNaN(value)) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function extractEmailBody(emailBody) {
  if (!emailBody) return "";
  if (typeof emailBody !== "string") return String(emailBody);
  try {
    const parsed = JSON.parse(emailBody);
    // Handle case where entire email JSON (with subject+body) is stored in email_body
    let body = parsed.body || parsed.email_body || parsed.message || emailBody;
    if (typeof body === "string") {
      // The body is a JSON-escaped string - unescape it properly
      // IMPORTANT: Handle backslashes FIRST to avoid creating new escape sequences
      return body
        .replace(/\\\\/g, '\x00\x00')  // Temporarily replace \\ with placeholder
        .replace(/\\n/g, '\n')         // Newline
        .replace(/\\r/g, '')           // Carriage return
        .replace(/\\t/g, '\t')         // Tab
        .replace(/\\"/g, '"')          // Double quote
        .replace(/\x00\x00/g, '\\')    // Restore backslashes
        .trim();
    }
    return String(body);
  } catch {
    // Handle raw strings with escaped characters
    return emailBody
      .replace(/\\\\/g, '\x00\x00')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\x00\x00/g, '\\')
      .trim();
  }
}

export function initials(name = "") {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0] || "")
    .join("")
    .toUpperCase();
}

// ─── Tone helpers ─────────────────────────────────────────────
export function statusTone(status) {
  if (status === "pending_review") return "bg-amber-100 text-amber-800";
  if (status === "approved_not_sent") return "bg-indigo-100 text-indigo-800";
  if (status === "send_failed") return "bg-rose-100 text-rose-800";
  if (status === "approved") return "bg-emerald-100 text-emerald-800";
  if (status === "rejected") return "bg-rose-100 text-rose-800";
  return "bg-amber-100 text-amber-800";
}

export function riskTone(level) {
  if (level === "HIGH" || level === "CRITICAL") return "text-danger";
  if (level === "MEDIUM") return "text-warning";
  return "text-accent";
}

export function riskBorder(level) {
  if (level === "HIGH" || level === "CRITICAL") return "border-l-danger";
  if (level === "MEDIUM") return "border-l-warning";
  return "border-l-accent";
}

export function levelTone(level) {
  if (level === "MISSED") return "bg-rose-100 text-rose-800";
  if (level === "CRITICAL") return "bg-orange-100 text-orange-800";
  return "bg-amber-100 text-amber-800";
}

export function levelBorder(level) {
  if (level === "MISSED") return "border-rose-500";
  if (level === "CRITICAL") return "border-orange-500";
  return "border-amber-400";
}

export function levelText(level) {
  if (level === "MISSED") return "text-rose-700";
  if (level === "CRITICAL") return "text-orange-700";
  return "text-amber-700";
}

export function regulatorTone(regulator) {
  const map = {
    RBI: "bg-slate-900 text-white",
    GST: "bg-teal-700 text-white",
    IncomeTax: "bg-amber-700 text-white",
    MCA: "bg-sky-900 text-white",
    SEBI: "bg-emerald-900 text-white",
  };
  return map[regulator] || "bg-slate-700 text-white";
}

export function sourceTone(source) {
  if (source === "draft") return "bg-sky-100 text-sky-800";
  if (source === "clients_json") return "bg-emerald-100 text-emerald-800";
  return "bg-slate-100 text-slate-600";
}

export function priorityTone(priority) {
  if (priority === "HIGH") return "bg-orange-100 text-orange-800";
  if (priority === "MEDIUM") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

// ─── Reusable primitives ──────────────────────────────────────
export function EmptyState({ message }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-muted">
      {message}
    </div>
  );
}

export function ActionBanner({ message }) {
  if (!message) return null;
  return (
    <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
      {message}
    </div>
  );
}

export function StatCard({ title, value, tone = "border-accent", meta }) {
  return (
    <div className={`rounded-2xl border-l-4 ${tone} bg-white px-4 py-4 shadow-panel`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">{title}</p>
      <p className="mt-2 font-headline text-2xl font-extrabold text-slate-950">{value}</p>
      {meta && <p className="mt-1 text-xs text-muted">{meta}</p>}
    </div>
  );
}

export function FilterChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
        active ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

export function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-100 last:border-0">
      <span className="text-xs text-muted shrink-0">{label}</span>
      <span className="text-xs font-semibold text-slate-900 text-right">{value || "—"}</span>
    </div>
  );
}
