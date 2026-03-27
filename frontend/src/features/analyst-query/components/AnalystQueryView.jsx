import { useEffect, useRef, useState } from "react";
import { queryAnalyst } from "@/services/complianceApi";

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

function sourceLabel(source) {
  if (!source) return "Unknown";
  if (typeof source === "string") return source;
  return source.source || source.name || source.document || "Unknown";
}

export default function AnalystQueryView() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function submit(text) {
    const question = (text || input).trim();
    if (!question || loading) return;

    setInput("");
    setError("");
    setMessages((current) => [...current, { role: "user", content: question }]);
    setLoading(true);

    try {
      const response = await queryAnalyst(question);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: parseAnswer(response),
          sources: parseSources(response),
          abstained: response?.abstained || false,
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

  const totalQuestions = messages.filter((message) => message.role === "user").length;
  const answeredQuestions = messages.filter(
    (message) => message.role === "assistant" && !message.abstained,
  ).length;
  const hasMessages = messages.length > 0;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-muted">
          Research Intelligence
        </p>
        <h1 className="font-headline text-[2.15rem] font-extrabold leading-tight tracking-tight text-slate-950">
          Analyst Query
        </h1>
        <p className="text-sm text-slate-600">
          Ask compliance questions grounded in ingested regulatory documents.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-panel">
        <div className="space-y-4 overflow-y-auto p-5" style={{ minHeight: "420px", maxHeight: "520px" }}>
          {!hasMessages && !loading ? (
            <div className="flex h-56 flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50">
                <span className="material-symbols-outlined text-2xl text-accent">
                  psychology
                </span>
              </div>
              <p className="text-base font-semibold text-slate-800">
                Ask a compliance question
              </p>
              <p className="mt-1 text-sm text-muted">
                Answers are sourced from ingested regulatory documents only.
              </p>
            </div>
          ) : null}

          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  message.role === "user"
                    ? "bg-slate-900 text-white"
                    : "bg-teal-100 text-teal-700"
                }`}
              >
                {message.role === "user" ? "CA" : "AI"}
              </div>

              <div className="max-w-[85%] space-y-2">
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-7 ${
                    message.role === "user"
                      ? "rounded-tr-sm bg-slate-900 text-white"
                      : message.abstained
                      ? "rounded-tl-sm border border-amber-200 bg-amber-50 text-amber-900"
                      : "rounded-tl-sm border border-slate-200 bg-slate-50 text-slate-800"
                  }`}
                >
                  {message.content}
                </div>

                {message.role === "assistant" && message.sources?.length > 0 ? (
                  <div className="space-y-1 pl-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
                      Sources
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {message.sources.map((source, sourceIndex) => (
                        <span
                          key={sourceIndex}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600"
                        >
                          {sourceLabel(source)}
                          {source?.page != null ? ` - p${source.page}` : ""}
                          {typeof source?.score === "number"
                            ? ` - ${Math.round(source.score * 100)}%`
                            : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {loading ? (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-700">
                AI
              </div>
              <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex h-5 items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>

        {error ? (
          <div className="mx-4 mb-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="border-t border-slate-100 p-4">
          <div className="flex items-end gap-3">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKey}
              rows={2}
              className="flex-1 resize-none rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-accent focus:bg-white"
              placeholder="Ask a compliance question... (Enter to send)"
              disabled={loading}
            />
            <button
              onClick={() => submit()}
              disabled={loading || !input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-base">send</span>
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted">
            <span>Press Enter to send - Shift+Enter for new line</span>
            <span>
              {totalQuestions} questions - {answeredQuestions} answered
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
