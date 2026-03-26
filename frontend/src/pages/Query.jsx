import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, AlertCircle, BookOpen } from 'lucide-react'
import { queryCompliance } from '../api/client'

const SUGGESTED = [
  'When do the RBI Interest Rate Derivatives Directions come into force?',
  'Who are eligible market-makers in IRD markets?',
  'What is the PVBP cap for non-resident IRD transactions?',
  'What products can market-makers offer to retail users?',
]

function Message({ msg }) {
  const isUser = msg.role === 'user'

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
        isUser ? 'bg-gold-500/20 border border-gold-500/30' : 'bg-ink-700 border border-ink-600'
      }`}>
        {isUser
          ? <User size={13} className="text-gold-400" />
          : <Bot size={13} className="text-slate-400" />
        }
      </div>

      <div className={`flex-1 max-w-2xl ${isUser ? 'text-right' : ''}`}>
        <div className={`inline-block text-left rounded-xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-gold-500/10 border border-gold-500/20 text-slate-200'
            : 'bg-ink-800 border border-ink-600 text-slate-300'
        }`}>
          {msg.loading
            ? <span className="flex items-center gap-2 text-slate-500">
                <span className="w-1 h-1 bg-slate-500 rounded-full animate-bounce" style={{animationDelay:'0ms'}} />
                <span className="w-1 h-1 bg-slate-500 rounded-full animate-bounce" style={{animationDelay:'150ms'}} />
                <span className="w-1 h-1 bg-slate-500 rounded-full animate-bounce" style={{animationDelay:'300ms'}} />
              </span>
            : msg.content
          }
        </div>

        {/* Sources */}
        {msg.sources?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {msg.sources.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-xs font-mono text-slate-600 bg-ink-900 border border-ink-700 rounded px-2 py-0.5">
                <BookOpen size={9} />
                {s.source} · p{s.page} · {(s.score * 100).toFixed(0)}%
              </span>
            ))}
          </div>
        )}

        {/* Abstain */}
        {msg.abstained && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400/70">
            <AlertCircle size={11} />
            <span>No relevant document found ({msg.abstain_reason})</span>
          </div>
        )}

        {/* Confidence */}
        {msg.confidence !== undefined && !msg.abstained && (
          <div className="mt-1 text-xs font-mono text-slate-600">
            confidence: {(msg.confidence * 100).toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  )
}

export default function Query() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (question) => {
    const q = question || input.trim()
    if (!q || loading) return
    setInput('')

    setMessages(prev => [...prev, { role: 'user', content: q }])
    setMessages(prev => [...prev, { role: 'assistant', loading: true }])
    setLoading(true)

    try {
      const { data } = await queryCompliance(q)
      setMessages(prev => [
        ...prev.slice(0, -1),
        {
          role:         'assistant',
          content:      data.answer,
          sources:      data.sources,
          confidence:   data.confidence,
          abstained:    data.abstained,
          abstain_reason: data.abstain_reason,
        }
      ])
    } catch {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: '❌ Failed to reach backend. Is the API server running?' }
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-5 border-b border-ink-700 flex-shrink-0">
        <h1 className="font-display text-2xl font-bold text-white">Compliance Query</h1>
        <p className="text-slate-500 text-sm mt-0.5">Ask questions about ingested regulatory documents</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        {messages.length === 0 && (
          <div className="max-w-2xl mx-auto mt-8">
            <div className="text-center mb-8">
              <Bot size={32} className="text-ink-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">Ask any question about ingested regulatory documents.</p>
              <p className="text-slate-600 text-xs mt-1">Answers are grounded in source documents with citations.</p>
            </div>

            <p className="text-xs font-mono text-slate-600 uppercase tracking-wider mb-3">Suggested questions</p>
            <div className="space-y-2">
              {SUGGESTED.map((s, i) => (
                <button
                  key={i}
                  onClick={() => send(s)}
                  className="w-full text-left text-sm text-slate-400 hover:text-slate-200 bg-ink-800 hover:bg-ink-700 border border-ink-600 hover:border-ink-500 rounded-lg px-4 py-3 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <Message key={i} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-8 py-5 border-t border-ink-700 flex-shrink-0">
        <div className="flex gap-3 max-w-4xl">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Ask a compliance question..."
            disabled={loading}
            className="flex-1 bg-ink-800 border border-ink-600 focus:border-gold-500/50 rounded-lg px-4 py-3 text-sm text-white placeholder-slate-600 outline-none transition-colors"
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="px-4 py-3 bg-gold-500 hover:bg-gold-400 disabled:opacity-40 disabled:cursor-not-allowed text-ink-950 rounded-lg transition-all"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-xs text-slate-600 mt-2 font-mono">Hybrid search (BM25 + vector) · Cross-encoder reranking · Groq LLaMA 3.3 70B</p>
      </div>
    </div>
  )
}
