import { useEffect, useRef, useState } from "react";
import { queryAnalyst } from "@/services/complianceApi";

const SUGGESTED = [
  "What changed in the latest RBI circular?",
  "What is the FEMA deadline extension mentioned in the documents?",
  "Who is affected by the GST IMS advisory?",
  "What changed for TDS under Section 194C and 194J?",
];

const REGULATORS = ["All", "RBI", "GST", "IncomeTax", "MCA", "SEBI"];

function shouldUseActiveDocument(question) {
  return /\b(this|that|above|previous|same)\b/i.test(question);
}

function normalizeFilters(filters) {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value != null && String(value).trim() !== ""),
  );
}

function sourceMeta(source) {
  if (!source) return "Unknown";
  const parts = [
    source.regulator,
    source.document_date,
    source.page_label != null ? `p${source.page_label}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function answerTone(message) {
  if (message.status === "unsupported" || message.abstained) {
    return "bg-amber-50 border border-amber-200 text-amber-900";
  }
  return "bg-slate-50 border border-slate-200 text-slate-800";
}

export default function AnalystQueryView() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([]);
  const [expandedEvidence, setExpandedEvidence] = useState({});
  const [filters, setFilters] = useState({
    regulator: "All",
    title_contains: "",
    date_from: "",
    date_to: "",
  });
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function submit(text) {
    const question = (text || input).trim();
    if (!question || loading) return;

    const nextUserMessage = { role: "user", content: question };
    const lastScopedAnswer = [...messages]
      .reverse()
      .find((message) => message.role === "assistant" && Array.isArray(message.sources) && message.sources.length === 1);
    const requestFilters = normalizeFilters({
      ...filters,
      regulator: filters.regulator === "All" ? "" : filters.regulator,
    });

    setInput("");
    setError("");
    setMessages((current) => [...current, nextUserMessage]);
    setLoading(true);

    try {
      const result = await queryAnalyst({
        question,
        filters: requestFilters,
        activeDocument: shouldUseActiveDocument(question) ? lastScopedAnswer?.sources?.[0]?.source || null : null,
      });

      setMessages((current) => [
        ...current,
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
      setMessages((current) => current.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  function handleKey(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  const questionCount = messages.filter((message) => message.role === "user").length;
  const answeredCount = messages.filter((message) => message.role === "assistant" && message.status === "answered").length;
  const abstainedCount = messages.filter((message) => message.role === "assistant" && message.abstained).length;
  const hasMessages = messages.length > 0;

  function toggleEvidence(index) {
    setExpandedEvidence((current) => ({
      ...current,
      [index]: !current[index],
    }));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-headline text-3xl font-extrabold text-slate-950">Analyst Query</h1>
        <p className="mt-1 text-sm text-muted">
          Ask grounded compliance questions. The analyst uses retrieved document evidence, supports document-scoped follow-ups, and abstains when the answer is not proven by the ingested documents.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-8 flex flex-col">
          <div className="rounded-2xl bg-white shadow-panel overflow-hidden flex flex-col" style={{ minHeight: "560px" }}>
            <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <label className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Regulator</span>
                  <select
                    value={filters.regulator}
                    onChange={(event) => setFilters((current) => ({ ...current, regulator: event.target.value }))}
                    className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
                    disabled={loading}
                  >
                    {REGULATORS.map((regulator) => (
                      <option key={regulator} value={regulator}>
                        {regulator}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Title Filter</span>
                  <input
                    value={filters.title_contains}
                    onChange={(event) => setFilters((current) => ({ ...current, title_contains: event.target.value }))}
                    className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
                    placeholder="FEMA, IMS, TDS..."
                    disabled={loading}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Date From</span>
                  <input
                    type="date"
                    value={filters.date_from}
                    onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))}
                    className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
                    disabled={loading}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Date To</span>
                  <input
                    type="date"
                    value={filters.date_to}
                    onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))}
                    className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
                    disabled={loading}
                  />
                </label>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ maxHeight: "620px" }}>
              {!hasMessages && !loading && (
                <div className="flex flex-col items-center justify-center h-48 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 mb-4">
                    <span className="material-symbols-outlined text-2xl text-accent">psychology</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">Ask a compliance question</p>
                  <p className="mt-1 text-xs text-muted">Answers are grounded in ingested documents only</p>
                </div>
              )}

              {messages.map((message, index) => (
                <div key={index} className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    message.role === "user" ? "bg-slate-900 text-white" : "bg-teal-100 text-teal-700"
                  }`}>
                    {message.role === "user" ? "CA" : "AI"}
                  </div>

                  <div className="max-w-[88%] space-y-2">
                    <div
                      className={`rounded-2xl px-4 py-3 text-sm leading-7 whitespace-pre-wrap ${
                        message.role === "user"
                          ? "bg-slate-900 text-white rounded-tr-sm"
                          : `${answerTone(message)} rounded-tl-sm`
                      }`}
                    >
                      {message.content}
                    </div>

                    {message.role === "assistant" && (
                      <>
                        <div className="flex flex-wrap gap-2 pl-1 text-[11px]">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                            {message.status === "answered" ? "Grounded answer" : message.status === "unsupported" ? "Unsupported" : "Not found"}
                          </span>
                          {typeof message.confidence === "number" && (
                            <span className="rounded-full bg-white border border-slate-200 px-2.5 py-1 font-semibold text-slate-600">
                              Confidence {Math.round(message.confidence * 100)}%
                            </span>
                          )}
                          {message.notFoundReason && (
                            <span className="rounded-full bg-white border border-slate-200 px-2.5 py-1 font-semibold text-slate-600">
                              {message.notFoundReason}
                            </span>
                          )}
                        </div>

                        {message.abstained ? (
                          <>
                            {(message.sources?.length > 0 || message.supportingQuotes?.length > 0) && (
                              <div className="pl-1">
                                <button
                                  onClick={() => toggleEvidence(index)}
                                  className="rounded-full bg-white border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition"
                                >
                                  {expandedEvidence[index] ? "Hide details" : "Why not found?"}
                                </button>
                              </div>
                            )}

                            {expandedEvidence[index] && (
                              <div className="space-y-2 pl-1">
                                {message.sources?.length > 0 && (
                                  <div className="space-y-2">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Closest Evidence</p>
                                    <div className="space-y-2">
                                      {message.sources.map((source) => (
                                        <div key={source.source_id} className="rounded-xl border border-slate-200 bg-white p-3">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">
                                              {source.source_id}
                                            </span>
                                            <p className="text-xs font-semibold text-slate-900">{source.title || source.source}</p>
                                          </div>
                                          <p className="mt-1 text-[11px] text-muted">{sourceMeta(source)}</p>
                                          <p className="mt-2 text-xs leading-6 text-slate-700">{source.snippet}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {message.supportingQuotes?.length > 0 && (
                                  <div className="space-y-2">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Quote</p>
                                    <div className="space-y-2">
                                      {message.supportingQuotes.map((quote) => (
                                        <blockquote key={`${quote.source_id}-${quote.page_label}`} className="rounded-xl border-l-4 border-teal-500 bg-teal-50 px-4 py-3 text-xs leading-6 text-slate-700">
                                          <p className="font-semibold text-slate-900">
                                            {quote.source_id} · {quote.title} · p{quote.page_label}
                                          </p>
                                          <p className="mt-1">{quote.quote}</p>
                                        </blockquote>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            {message.sources?.length > 0 && (
                              <div className="space-y-2 pl-1">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Evidence</p>
                                <div className="space-y-2">
                                  {message.sources.map((source) => (
                                    <div key={source.source_id} className="rounded-xl border border-slate-200 bg-white p-3">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">
                                          {source.source_id}
                                        </span>
                                        <p className="text-xs font-semibold text-slate-900">{source.title || source.source}</p>
                                      </div>
                                      <p className="mt-1 text-[11px] text-muted">{sourceMeta(source)}</p>
                                      <p className="mt-2 text-xs leading-6 text-slate-700">{source.snippet}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {message.supportingQuotes?.length > 0 && (
                              <div className="space-y-2 pl-1">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Supporting Quotes</p>
                                <div className="space-y-2">
                                  {message.supportingQuotes.map((quote) => (
                                    <blockquote key={`${quote.source_id}-${quote.page_label}`} className="rounded-xl border-l-4 border-teal-500 bg-teal-50 px-4 py-3 text-xs leading-6 text-slate-700">
                                      <p className="font-semibold text-slate-900">
                                        {quote.source_id} · {quote.title} · p{quote.page_label}
                                      </p>
                                      <p className="mt-1">{quote.quote}</p>
                                    </blockquote>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-700">AI</div>
                  <div className="rounded-2xl rounded-tl-sm bg-slate-50 border border-slate-200 px-4 py-3">
                    <div className="flex gap-1.5 items-center h-5">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {error && (
              <div className="mx-4 mb-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}

            <div className="border-t border-slate-100 p-4">
              <div className="flex gap-3 items-end">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKey}
                  rows={2}
                  className="flex-1 resize-none rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none focus:border-accent focus:bg-white transition"
                  placeholder="Ask a compliance question... (Enter to send)"
                  disabled={loading}
                />
                <button
                  onClick={() => submit()}
                  disabled={loading || !input.trim()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white hover:bg-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined text-base">send</span>
                </button>
              </div>
              <p className="mt-2 text-[11px] text-muted">
                Press Enter to send · Shift+Enter for new line · Document-scoped follow-ups work when the previous answer cites one clear source
              </p>
            </div>
          </div>
        </div>

        <div className="xl:col-span-4 space-y-4">
          <div className="rounded-2xl bg-white shadow-panel p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">Suggested Questions</p>
            <div className="space-y-2">
              {SUGGESTED.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => submit(prompt)}
                  disabled={loading}
                  className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 transition disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white shadow-panel p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">Guardrails</p>
            <div className="space-y-3">
              {[
                "Answers cite retrieved document evidence.",
                "Follow-up memory helps retrieval only; it does not override source grounding.",
                "If evidence is weak or missing, the analyst abstains.",
                "Regulator, title, and date filters help narrow the search.",
              ].map((item) => (
                <div key={item} className="flex items-start gap-2.5 text-xs text-slate-700">
                  <span className="material-symbols-outlined text-sm text-accent mt-0.5">verified</span>
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white shadow-panel p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">Session</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Questions</p>
                <p className="mt-1 text-xl font-bold text-slate-950">{questionCount}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Answered</p>
                <p className="mt-1 text-xl font-bold text-slate-950">{answeredCount}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Abstained</p>
                <p className="mt-1 text-xl font-bold text-slate-950">{abstainedCount}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Scoped Follow-up</p>
                <p className="mt-1 text-xl font-bold text-slate-950">1</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
