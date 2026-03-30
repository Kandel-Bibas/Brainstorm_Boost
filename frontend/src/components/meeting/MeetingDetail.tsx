import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  AlertTriangle,
  MoreHorizontal,
  Download,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
  Calendar,
  Users,
  Clock,
  Square,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, type AiOutput } from '@/lib/api'
import { TranscriptPanel } from '@/components/meeting/TranscriptPanel'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MeetingDetailProps {
  meetingId: string
  onBack: () => void
  onPrepareFollowUp?: (agenda: string, participants: string) => void
  provider?: string
}

// ---------------------------------------------------------------------------
// Small reusable bits
// ---------------------------------------------------------------------------

function ConfidenceBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    high: 'bg-[var(--bb-status-green-bg)] text-[var(--bb-status-green-text)]',
    medium: 'bg-[var(--bb-status-orange-bg)] text-[var(--bb-status-orange-text)]',
    low: 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${styles[level] || styles.medium}`}>
      {level}
    </span>
  )
}

function IdBadge({ id, color }: { id: string; color: string }) {
  return (
    <span
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs text-white"
      style={{ backgroundColor: color }}
    >
      {id}
    </span>
  )
}

function SourceQuote({ quote, speaker, onQuoteClick }: {
  quote: string
  speaker?: string
  onQuoteClick?: () => void
}) {
  const [open, setOpen] = useState(false)
  if (!quote) return null
  return (
    <div className="mt-1.5 text-xs text-[var(--bb-text-muted)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex cursor-pointer items-center gap-1 transition-colors hover:text-[var(--bb-text-secondary)]"
      >
        {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
        <span className="italic">Source quote</span>
      </button>
      {open && (
        <div
          onClick={onQuoteClick}
          className={`mt-1 ml-4 italic leading-relaxed rounded px-2 py-1 transition-colors ${onQuoteClick ? 'cursor-pointer hover:bg-[var(--bb-accent)]/10 hover:text-[var(--bb-accent)]' : ''}`}
        >
          {speaker && <span className="not-italic text-[var(--bb-text-secondary)]">{speaker}: </span>}
          &ldquo;{quote}&rdquo;
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Actions dropdown
// ---------------------------------------------------------------------------

function ActionsMenu({ onReindex, onDelete, reindexing }: {
  onReindex: () => void
  onDelete: () => void
  reindexing: boolean
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('[data-actions-menu]')) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div data-actions-menu className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex size-8 items-center justify-center rounded-md text-[var(--bb-text-secondary)] transition-colors hover:bg-[var(--bb-border-light)]"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-lg border bg-[var(--bb-surface)] py-1 shadow-lg" style={{ borderColor: 'var(--bb-border)' }}>
          <button
            type="button"
            onClick={() => { onReindex(); setOpen(false) }}
            disabled={reindexing}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--bb-text-primary)] hover:bg-[var(--bb-border-light)] disabled:opacity-50"
          >
            {reindexing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Reindex
          </button>
          <button
            type="button"
            onClick={() => { onDelete(); setOpen(false) }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
          >
            <Trash2 className="size-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Analysis panel (right side)
// ---------------------------------------------------------------------------

function AnalysisPanel({ aiOutput, onQuoteClick }: {
  aiOutput: AiOutput
  onQuoteClick: (quote: string) => void
}) {
  const { trust_flags, state_of_direction, decisions, action_items, open_risks } = aiOutput

  return (
    <div className="space-y-6 p-6">
      {/* Trust flags */}
      {trust_flags && trust_flags.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1">
              {trust_flags.map((flag, i) => (
                <p key={i} className="text-sm text-amber-800 dark:text-amber-300">{flag}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* State of direction */}
      {state_of_direction && (
        <p className="text-sm text-[var(--bb-text-primary)] leading-relaxed">{state_of_direction}</p>
      )}

      {/* Decisions */}
      {decisions.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--bb-text-muted)]">
            Decisions
          </h3>
          <div className="space-y-2">
            {decisions.map((d, i) => (
              <div key={d.id} className="rounded-lg border bg-[var(--bb-surface)] px-4 py-3" style={{ borderColor: 'var(--bb-border)' }}>
                <div className="flex items-start gap-3">
                  <IdBadge id={`D${i + 1}`} color="var(--bb-status-green, #00c875)" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--bb-text-primary)]">{d.description}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--bb-text-muted)]">
                      {d.made_by && <span>{d.made_by}</span>}
                      <ConfidenceBadge level={d.confidence} />
                    </div>
                    <SourceQuote
                      quote={d.source_quote}
                      speaker={d.source_quote_speaker}
                      onQuoteClick={d.source_quote ? () => onQuoteClick(d.source_quote) : undefined}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Action Items */}
      {action_items.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--bb-text-muted)]">
            Action Items
          </h3>
          <div className="space-y-2">
            {action_items.map((a, i) => (
              <div key={a.id} className="rounded-lg border bg-[var(--bb-surface)] px-4 py-3" style={{ borderColor: 'var(--bb-border)' }}>
                <div className="flex items-start gap-3">
                  <IdBadge id={`A${i + 1}`} color="var(--bb-accent, #4a90d9)" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--bb-text-primary)]">{a.task}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--bb-text-muted)]">
                      {a.owner && <span>{a.owner}</span>}
                      {a.deadline && (
                        <span className="rounded bg-[var(--bb-border-light)] px-1.5 py-0.5">Due: {a.deadline}</span>
                      )}
                      <ConfidenceBadge level={a.confidence} />
                    </div>
                    <SourceQuote
                      quote={a.source_quote}
                      speaker={a.source_quote_speaker}
                      onQuoteClick={a.source_quote ? () => onQuoteClick(a.source_quote) : undefined}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Open Risks */}
      {open_risks.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--bb-text-muted)]">
            Open Risks
          </h3>
          <div className="space-y-2">
            {open_risks.map((r, i) => (
              <div key={r.id} className="rounded-lg border bg-[var(--bb-surface)] px-4 py-3" style={{ borderColor: 'var(--bb-border)' }}>
                <div className="flex items-start gap-3">
                  <IdBadge id={`R${i + 1}`} color="var(--bb-status-red, #e2445c)" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--bb-text-primary)]">{r.description}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--bb-text-muted)]">
                      {r.raised_by && <span>{r.raised_by}</span>}
                      <ConfidenceBadge level={r.severity} />
                    </div>
                    <SourceQuote
                      quote={r.source_quote}
                      speaker={r.source_quote_speaker}
                      onQuoteClick={r.source_quote ? () => onQuoteClick(r.source_quote) : undefined}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {decisions.length === 0 && action_items.length === 0 && open_risks.length === 0 && (
        <div className="py-12 text-center text-sm text-[var(--bb-text-muted)]">
          No analysis items found.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component — split pane: transcript left, analysis right
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Streaming panel — shows entities as they arrive during analysis
// ---------------------------------------------------------------------------

function StreamingPanel({ entities, progress, chunk, isAnalyzing, onStop }: {
  entities: StreamingEntity[]
  progress: string
  chunk: { current: number; total: number }
  isAnalyzing: boolean
  onStop: () => void
}) {
  const decisions = entities.filter(e => e.type === 'decision')
  const actionItems = entities.filter(e => e.type === 'action_item')
  const risks = entities.filter(e => e.type === 'risk')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom as new entities arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entities.length])

  return (
    <div ref={scrollRef} className="p-6 space-y-5">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        {isAnalyzing && <Loader2 className="size-4 animate-spin text-[var(--bb-accent)]" />}
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs text-[var(--bb-text-muted)] mb-1">
            <span>{progress || 'Analyzing...'}</span>
            {chunk.total > 0 && (
              <span>Chunk {chunk.current}/{chunk.total}</span>
            )}
          </div>
          {chunk.total > 0 && (
            <div className="h-1 rounded-full bg-[var(--bb-border)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--bb-accent)] transition-all duration-500"
                style={{ width: `${(chunk.current / chunk.total) * 100}%` }}
              />
            </div>
          )}
        </div>
        {isAnalyzing && (
          <button
            type="button"
            onClick={onStop}
            className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-100 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400"
          >
            <Square className="size-3" />
            Stop
          </button>
        )}
      </div>

      {/* Streaming decisions */}
      {decisions.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--bb-text-muted)]">
            Decisions ({decisions.length})
          </h3>
          <div className="space-y-2">
            {decisions.map((d, i) => (
              <div
                key={i}
                className={`rounded-lg border bg-[var(--bb-surface)] px-4 py-3 transition-all duration-500 ${d._animating ? 'fade-in border-[var(--bb-status-green)]/40 bg-green-50/50 dark:bg-green-950/10' : 'border-[var(--bb-border)]'}`}
              >
                <div className="flex items-start gap-3">
                  <IdBadge id={`D${i + 1}`} color="var(--bb-status-green, #00c875)" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--bb-text-primary)]">{d.content}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-[var(--bb-text-muted)]">
                      {d.made_by && <span>{d.made_by}</span>}
                      {d.confidence && <ConfidenceBadge level={d.confidence} />}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Streaming action items */}
      {actionItems.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--bb-text-muted)]">
            Action Items ({actionItems.length})
          </h3>
          <div className="space-y-2">
            {actionItems.map((a, i) => (
              <div
                key={i}
                className={`rounded-lg border bg-[var(--bb-surface)] px-4 py-3 transition-all duration-500 ${a._animating ? 'fade-in border-[var(--bb-accent)]/40 bg-blue-50/50 dark:bg-blue-950/10' : 'border-[var(--bb-border)]'}`}
              >
                <div className="flex items-start gap-3">
                  <IdBadge id={`A${i + 1}`} color="var(--bb-accent, #4a90d9)" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--bb-text-primary)]">{a.content}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-[var(--bb-text-muted)]">
                      {a.owner && <span>{a.owner}</span>}
                      {a.confidence && <ConfidenceBadge level={a.confidence} />}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Streaming risks */}
      {risks.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--bb-text-muted)]">
            Open Risks ({risks.length})
          </h3>
          <div className="space-y-2">
            {risks.map((r, i) => (
              <div
                key={i}
                className={`rounded-lg border bg-[var(--bb-surface)] px-4 py-3 transition-all duration-500 ${r._animating ? 'fade-in border-red-300/40 bg-red-50/50 dark:bg-red-950/10' : 'border-[var(--bb-border)]'}`}
              >
                <div className="flex items-start gap-3">
                  <IdBadge id={`R${i + 1}`} color="var(--bb-status-red, #e2445c)" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--bb-text-primary)]">{r.content}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-[var(--bb-text-muted)]">
                      {r.raised_by && <span>{r.raised_by}</span>}
                      {r.severity && <ConfidenceBadge level={r.severity} />}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty state while waiting for first chunk */}
      {entities.length === 0 && isAnalyzing && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Loader2 className="size-6 animate-spin text-[var(--bb-accent)] mb-3" />
          <p className="text-sm text-[var(--bb-text-muted)]">Waiting for first extraction results...</p>
        </div>
      )}
    </div>
  )
}

// Streaming entity type for live analysis
interface StreamingEntity {
  type: string
  content: string
  made_by?: string
  owner?: string
  raised_by?: string
  confidence?: string
  severity?: string
  source_quote?: string
  _animating?: boolean  // For typewriter effect
}

export function MeetingDetail({ meetingId, onBack, provider }: MeetingDetailProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [meetingTitle, setMeetingTitle] = useState('')
  const [meetingStatus, setMeetingStatus] = useState('')
  const [aiOutput, setAiOutput] = useState<AiOutput | null>(null)
  const [approved, setApproved] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [reindexing, setReindexing] = useState(false)
  const [highlightedRange, setHighlightedRange] = useState<{ start: number; end: number } | null>(null)

  // Streaming state
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [streamingEntities, setStreamingEntities] = useState<StreamingEntity[]>([])
  const [analysisProgress, setAnalysisProgress] = useState('')
  const [chunkProgress, setChunkProgress] = useState({ current: 0, total: 0 })
  const eventSourceRef = useRef<EventSource | null>(null)

  // ------ Data fetching ------
  useEffect(() => {
    let cancelled = false
    async function fetchMeeting() {
      try {
        setLoading(true)
        setError(null)
        const [detail, transcriptResult] = await Promise.all([
          api.getMeeting(meetingId),
          api.getMeetingTranscript(meetingId).catch(() => ({ transcript: '' })),
        ])
        if (cancelled) return
        setMeetingTitle(detail.title ?? 'Meeting')
        setMeetingStatus(detail.status ?? '')
        setTranscript(transcriptResult.transcript ?? '')
        const output = detail.verified_output_json ?? detail.ai_output_json
        if (output) {
          setAiOutput(output)
          if (detail.verified_output_json) setApproved(true)
        } else if (detail.status === 'uploaded') {
          // Meeting was just uploaded — analysis is starting, subscribe to SSE
          setIsAnalyzing(true)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load meeting')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchMeeting()
    return () => { cancelled = true }
  }, [meetingId])

  // ------ SSE subscription for live entity streaming ------
  useEffect(() => {
    if (!isAnalyzing) return

    const es = new EventSource(`/api/analyze/${meetingId}/progress`)
    eventSourceRef.current = es

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.stage === 'entities') {
          // New entities arrived from a chunk
          const newEntities: StreamingEntity[] = (data.entities || []).map((e: any) => ({
            ...e,
            _animating: true,
          }))
          setStreamingEntities(prev => [...prev, ...newEntities])
          setChunkProgress({ current: data.chunk, total: data.total_chunks })

          // Remove animation flag after delay
          setTimeout(() => {
            setStreamingEntities(prev =>
              prev.map(e => e._animating ? { ...e, _animating: false } : e)
            )
          }, 800)

        } else if (data.stage === 'complete' || data.stage === 'cancelled') {
          // Analysis done — reload the full meeting data
          es.close()
          eventSourceRef.current = null
          setIsAnalyzing(false)
          // Refetch to get the final assembled output
          api.getMeeting(meetingId).then(detail => {
            const output = detail.verified_output_json ?? detail.ai_output_json
            if (output) setAiOutput(output)
            setMeetingTitle(detail.title ?? meetingTitle)
            setMeetingStatus(detail.status ?? '')
            setStreamingEntities([])
          }).catch(() => {})

        } else if (data.stage === 'error') {
          es.close()
          eventSourceRef.current = null
          setIsAnalyzing(false)

        } else if (data.message) {
          setAnalysisProgress(data.message)
        }
      } catch {}
    }

    es.onerror = () => {
      es.close()
      eventSourceRef.current = null
      // Don't set isAnalyzing false — the analysis might still be running
      // Refetch after a delay
      setTimeout(() => {
        api.getMeeting(meetingId).then(detail => {
          const output = detail.verified_output_json ?? detail.ai_output_json
          if (output) {
            setAiOutput(output)
            setIsAnalyzing(false)
            setStreamingEntities([])
          }
        }).catch(() => {})
      }, 2000)
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [isAnalyzing, meetingId])

  // ------ Stop analysis ------
  const handleStop = useCallback(() => {
    api.stopAnalysis(meetingId).catch(() => {})
  }, [meetingId])

  // ------ Quote click → find in transcript and highlight ------
  const handleQuoteClick = useCallback((quote: string) => {
    if (!transcript || !quote) return
    const lower = transcript.toLowerCase()
    const quoteLower = quote.toLowerCase()

    // Try exact match
    let idx = lower.indexOf(quoteLower)

    // Try without filler words
    if (idx === -1) {
      const stripped = quoteLower.replace(/\b(um|uh|like|you know|i mean)\b/gi, ' ').replace(/\s+/g, ' ').trim()
      const transcriptStripped = lower.replace(/\b(um|uh|like|you know|i mean)\b/gi, ' ').replace(/\s+/g, ' ').trim()
      const sIdx = transcriptStripped.indexOf(stripped)
      if (sIdx !== -1) idx = sIdx
    }

    // Try sliding window: first 5 words, then 4
    if (idx === -1) {
      const words = quoteLower.split(/\s+/)
      for (const windowSize of [5, 4, 3]) {
        if (words.length >= windowSize) {
          for (let i = 0; i <= words.length - windowSize; i++) {
            const window = words.slice(i, i + windowSize).join(' ')
            const wIdx = lower.indexOf(window)
            if (wIdx !== -1) {
              idx = wIdx
              break
            }
          }
          if (idx !== -1) break
        }
      }
    }

    if (idx !== -1) {
      setHighlightedRange({ start: idx, end: idx + Math.min(quote.length, 200) })
    } else {
      toast.error('Could not find quote in transcript')
    }
  }, [transcript])

  // ------ Handlers ------
  const handleApprove = async () => {
    if (!aiOutput) return
    try {
      await api.approve(meetingId, aiOutput)
      setApproved(true)
      toast.success('Meeting approved and exported')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve')
    }
  }

  const handleReindex = async () => {
    setReindexing(true)
    try {
      await api.reindexMeeting(meetingId)
      toast.success('Reindexing complete')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reindex')
    } finally {
      setReindexing(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this meeting? This cannot be undone.')) return
    try {
      await api.deleteMeeting(meetingId)
      toast.success('Meeting deleted')
      onBack()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  // ------ Loading / error ------
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-[var(--bb-accent)]" />
        <span className="mt-3 text-sm text-[var(--bb-text-muted)]">Loading meeting...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertCircle className="size-8 text-red-500" />
        <p className="mt-3 text-sm text-[var(--bb-text-secondary)]">{error}</p>
        <button type="button" onClick={onBack} className="mt-4 rounded-md border border-[var(--bb-border)] px-4 py-2 text-sm hover:bg-[var(--bb-border-light)]">
          Go Back
        </button>
      </div>
    )
  }

  const meta = aiOutput?.meeting_metadata

  return (
    <div className="flex h-[calc(100vh-52px)] flex-col">
      {/* Page header */}
      <div className="border-b border-[var(--bb-border)] px-7 py-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md text-[var(--bb-text-secondary)] transition-colors hover:bg-[var(--bb-border-light)]"
            >
              <ArrowLeft className="size-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-[var(--bb-text-primary)] truncate">{meetingTitle}</h1>
              {meta && (
                <div className="mt-1 flex items-center gap-3 text-sm text-[var(--bb-text-muted)]">
                  {meta.date_mentioned && (
                    <span className="flex items-center gap-1"><Calendar className="size-3.5" />{meta.date_mentioned}</span>
                  )}
                  {meta.participants && meta.participants.length > 0 && (
                    <span className="flex items-center gap-1"><Users className="size-3.5" />{meta.participants.join(', ')}</span>
                  )}
                  {meta.duration_estimate && (
                    <span className="flex items-center gap-1"><Clock className="size-3.5" />{meta.duration_estimate}</span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            {aiOutput && meetingStatus === 'analyzed' && !approved && (
              <button
                type="button"
                onClick={handleApprove}
                className="flex items-center gap-1.5 rounded-md bg-[var(--bb-accent)] px-3.5 py-1.5 text-sm text-white transition-colors hover:bg-[var(--bb-accent-hover)]"
              >
                <Download className="size-3.5" />
                Approve & Export
              </button>
            )}
            <ActionsMenu onReindex={handleReindex} onDelete={handleDelete} reindexing={reindexing} />
          </div>
        </div>
      </div>

      {/* Split pane: Transcript left, Analysis right */}
      <div className="flex flex-1 min-h-0">
        {/* Left — Transcript */}
        {transcript && (
          <div className="w-[40%] border-r border-[var(--bb-border)] flex flex-col min-h-0">
            <TranscriptPanel
              transcript={transcript}
              highlightedRange={highlightedRange}
              onClearHighlight={() => setHighlightedRange(null)}
            />
          </div>
        )}

        {/* Right — Analysis or Streaming */}
        <div className={`${transcript ? 'w-[60%]' : 'w-full'} overflow-y-auto min-h-0`}>
          {aiOutput ? (
            <AnalysisPanel aiOutput={aiOutput} onQuoteClick={handleQuoteClick} />
          ) : isAnalyzing || streamingEntities.length > 0 ? (
            <StreamingPanel
              entities={streamingEntities}
              progress={analysisProgress}
              chunk={chunkProgress}
              isAnalyzing={isAnalyzing}
              onStop={handleStop}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <AlertCircle className="size-8 text-[var(--bb-text-muted)]" />
              <p className="mt-3 text-sm text-[var(--bb-text-secondary)]">This meeting hasn't been analyzed yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
