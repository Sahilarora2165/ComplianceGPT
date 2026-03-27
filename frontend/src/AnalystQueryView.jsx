import { useMemo, useState } from "react";
import { queryAnalyst } from "./api";

const SUGGESTED_PROMPTS = [
  "What changed in the latest RBI circular?",
  "Show MCA filing risks this month",
  "Summarize recent GST updates",
  "Which documents mention FEMA export obligations?",
];

function confidenceLabel(value) {
  if (typeof value !== "number") return "No score";
  return `${Math.round(value * 100)}% confidence`;
}

function renderAnswer(result) {
  if (!result) return "";
  if (typeof result.answer === "string" && result.answer.trim()) return result.answer;
  if (typeof result.response === "string" && result.response.trim()) return result.response;
  return "No answer returned.";
}

function renderSources(result) {
  if (!result) return [];
  if (Array.isArray(result.sources)) return result.sources;
  if (Array.isArray(result.citations)) return result.citations;
  return [];
}

function sourceLabel(source) {
  if (!source) return "Unknown source";
  if (typeof source === "string") return source;
  return source.source || source.name || source.document || "Unknown source";
}

function sourcePage(source) {
  if (!source || typeof source === "string") return null;
  return source.page ?? source.page_number ?? null;
}

function sourceScore(source) {
  if (!source || typeof source === "string") return null;
  return typeof source.score === "number" ? source.score : null;
}

function splitParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export default function AnalystQueryView() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [latestQuestion, setLatestQuestion] = useState("");
  const [history, setHistory] = useState([]);

  const answer = useMemo(() => renderAnswer(result), [result]);
  const sources = useMemo(() => renderSources(result), [result]);

  async function submitQuery(text = question) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError("");
    setLatestQuestion(trimmed);

    try {
      const response = await queryAnalyst(trimmed);
      setResult(response);
      setHistory((current) => [trimmed, ...current.filter((item) => item !== trimmed)].slice(0, 5));
      setQuestion(trimmed);
    } catch (queryError) {
      setError(queryError.message || "Query failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <h1 className="font-headline text-4xl font-extrabold tracking-tight text-slate-950">
            Analyst Query
          </h1>
          <p className="mt-3 max-w-2xl text-lg leading-8 text-muted">
            Ask compliance questions and retrieve grounded answers from the knowledge base.
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
        <section className="space-y-6 xl:col-span-5">
          <div className="rounded-3xl bg-white p-8 shadow-panel">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <span className="material-symbols-outlined">quiz</span>
              </div>
              <h3 className="font-headline text-xl font-bold text-slate-950">Your Query</h3>
            </div>

            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="h-52 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-300 focus:bg-white"
              placeholder="Ask a compliance question grounded in the ingested documents..."
            />

            <div className="mt-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Suggested Prompts
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => {
                      setQuestion(prompt);
                      submitQuery(prompt);
                    }}
                    className="rounded-xl bg-slate-100 px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-200"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => submitQuery()}
                disabled={loading || !question.trim()}
                className="flex-1 rounded-2xl bg-shell px-4 py-3 text-sm font-bold text-white transition hover:bg-shellSoft disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Asking analyst..." : "Ask Analyst"}
              </button>
              <button
                onClick={() => {
                  setQuestion("");
                  setError("");
                }}
                disabled={loading}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Clear
              </button>
            </div>

            {error ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <InfoCard title="Response Type" value="RAG-backed" icon="robot_2" />
            <InfoCard
              title="Latest Question"
              value={latestQuestion || "No query yet"}
              icon="history"
            />
          </div>

          {history.length ? (
            <div className="rounded-3xl bg-white p-6 shadow-panel">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Recent Queries
              </p>
              <div className="mt-4 space-y-2">
                {history.map((item) => (
                  <button
                    key={item}
                    onClick={() => {
                      setQuestion(item);
                      submitQuery(item);
                    }}
                    className="w-full rounded-2xl bg-slate-50 px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-slate-100"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="space-y-6 xl:col-span-7">
          <div className="rounded-3xl bg-white p-8 shadow-panel">
            {!result && !loading ? (
              <EmptyState message="Ask a question to retrieve a grounded answer from the compliance knowledge base." />
            ) : loading ? (
              <EmptyState message="Searching documents and drafting an answer..." />
            ) : (
              <>
                <div className="mb-8 flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
                      <span className="material-symbols-outlined">chat_bubble</span>
                    </div>
                    <h3 className="font-headline text-xl font-bold text-slate-950">
                      Analyst Response
                    </h3>
                  </div>
                  <div className="rounded-full bg-teal-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-teal-800">
                    {confidenceLabel(result?.confidence)}
                  </div>
                </div>

                {latestQuestion ? (
                  <div className="mb-6 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <span className="font-semibold text-slate-900">Question:</span> {latestQuestion}
                  </div>
                ) : null}

                {result?.abstained ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    {answer}
                  </div>
                ) : (
                  <div className="space-y-4 text-sm leading-7 text-slate-700">
                    {splitParagraphs(answer).map((paragraph, index) => (
                      <p key={`${paragraph}-${index}`}>{paragraph}</p>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rounded-3xl bg-white p-8 shadow-panel">
            <div className="mb-6 flex items-center gap-3">
              <span className="material-symbols-outlined text-accent">menu_book</span>
              <h4 className="font-headline text-lg font-bold text-slate-950">Sources & Citations</h4>
            </div>

            {sources.length ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {sources.map((source, index) => (
                  <div
                    key={`${sourceLabel(source)}-${sourcePage(source)}-${index}`}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <p className="text-sm font-bold text-slate-900">{sourceLabel(source)}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {sourcePage(source) !== null ? (
                        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700">
                          Page {sourcePage(source)}
                        </span>
                      ) : null}
                      {sourceScore(source) !== null ? (
                        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-teal-700">
                          Score {sourceScore(source)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                message={
                  loading
                    ? "Collecting source citations..."
                    : "No source citations were returned for this query."
                }
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function InfoCard({ title, value, icon }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{title}</p>
        <span className="material-symbols-outlined text-slate-400">{icon}</span>
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}
