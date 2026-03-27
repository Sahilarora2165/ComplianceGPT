import { useMemo, useRef, useEffect, useState } from "react";
import { queryAnalyst } from "@/services/complianceApi";
import { EmptyState } from "@/shared/ui";

const SUGGESTED = [
  "What changed in the latest RBI circular?",
  "Summarize recent GST updates",
  "Which clients are affected by FEMA obligations?",
  "What are the TDS filing deadlines?",
];

function parseAnswer(result) {
  if (!result) return "";
  if (typeof result.answer === "string") return result.answer.trim();
  if (typeof result.response === "string") return result.response.trim();
  return "No answer returned.";
}

function parseSources(result) {
  if (!result) return [];
  return result.sources || result.citations || [];
}

function sourceLabel(s) {
  if (!s) return "Unknown";
  if (typeof s === "string") return s;
  return s.source || s.name || s.document || "Unknown";
}

export default function AnalystQueryView() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([]); // {role: "user"|"assistant", content, sources, abstained}
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function submit(text) {
    const q = (text || input).trim();
    if (!q || loading) return;
    setInput("");
    setError("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setLoading(true);
    try {
      const res = await queryAnalyst(q);
      const answer = parseAnswer(res);
      const sources = parseSources(res);
      setMessages((m) => [...m, {
        role: "assistant",
        content: answer,
        sources,
        abstained: res?.abstained || false,
        confidence: res?.confidence,
      }]);
    } catch (e) {
      setError(e.message || "Query failed. Please try again.");
      setMessages((m) => m.slice(0, -1)); // remove the user message if it failed
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-headline text-3xl font-extrabold text-slate-950">Analyst Query</h1>
        <p className="mt-1 text-sm text-muted">
          Ask compliance questions. Answers are grounded in ingested regulatory documents — if the answer isn't found, it will say so honestly.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">

        {/* Chat area */}
        <div className="xl:col-span-8 flex flex-col">
          <div className="rounded-2xl bg-white shadow-panel overflow-hidden flex flex-col" style={{ minHeight: "520px" }}>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ maxHeight: "480px" }}>
              {!hasMessages && !loading && (
                <div className="flex flex-col items-center justify-center h-48 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 mb-4">
                    <span className="material-symbols-outlined text-2xl text-accent">psychology</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">Ask a compliance question</p>
                  <p className="mt-1 text-xs text-muted">Answers are sourced from ingested circulars only</p>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    msg.role === "user" ? "bg-slate-900 text-white" : "bg-teal-100 text-teal-700"
                  }`}>
                    {msg.role === "user" ? "CA" : "AI"}
                  </div>
                  <div className={`max-w-[85%] space-y-2 ${msg.role === "user" ? "items-end" : ""}`}>
                    <div className={`rounded-2xl px-4 py-3 text-sm leading-7 ${
                      msg.role === "user"
                        ? "bg-slate-900 text-white rounded-tr-sm"
                        : msg.abstained
                        ? "bg-amber-50 border border-amber-200 text-amber-900 rounded-tl-sm"
                        : "bg-slate-50 border border-slate-200 text-slate-800 rounded-tl-sm"
                    }`}>
                      {msg.content}
                    </div>

                    {/* Sources */}
                    {msg.role === "assistant" && msg.sources?.length > 0 && (
                      <div className="space-y-1 pl-1">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Sources</p>
                        <div className="flex flex-wrap gap-2">
                          {msg.sources.map((s, j) => (
                            <span key={j} className="rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                              {sourceLabel(s)}
                              {s.page != null ? ` · p${s.page}` : ""}
                              {typeof s.score === "number" ? ` · ${Math.round(s.score * 100)}%` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
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

            {/* Error */}
            {error && (
              <div className="mx-4 mb-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}

            {/* Input */}
            <div className="border-t border-slate-100 p-4">
              <div className="flex gap-3 items-end">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
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
              <p className="mt-2 text-[11px] text-muted">Press Enter to send · Shift+Enter for new line</p>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="xl:col-span-4 space-y-4">
          {/* Suggested prompts */}
          <div className="rounded-2xl bg-white shadow-panel p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">Suggested Questions</p>
            <div className="space-y-2">
              {SUGGESTED.map((p) => (
                <button
                  key={p}
                  onClick={() => submit(p)}
                  disabled={loading}
                  className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 transition disabled:opacity-50"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* How it works */}
          <div className="rounded-2xl bg-white shadow-panel p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">How it works</p>
            <div className="space-y-3">
              {[
                { icon: "search", text: "Searches ingested regulatory documents using RAG" },
                { icon: "fact_check", text: "Only answers from verified source material" },
                { icon: "block", text: "Honestly says 'not found' if no context exists" },
                { icon: "menu_book", text: "Cites exact source documents and page numbers" },
              ].map((item) => (
                <div key={item.text} className="flex items-start gap-2.5 text-xs text-slate-700">
                  <span className="material-symbols-outlined text-sm text-accent mt-0.5">{item.icon}</span>
                  {item.text}
                </div>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="rounded-2xl bg-white shadow-panel p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">Session</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Questions</p>
                <p className="mt-1 text-xl font-bold text-slate-950">
                  {messages.filter((m) => m.role === "user").length}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Answered</p>
                <p className="mt-1 text-xl font-bold text-slate-950">
                  {messages.filter((m) => m.role === "assistant" && !m.abstained).length}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
