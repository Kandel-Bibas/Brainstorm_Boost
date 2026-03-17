import { useState, useCallback, useMemo } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Check,
  CheckCircle2,
  Download,
  Loader2,
  Quote,
  AlertCircle,
  ListChecks,
  X,
  Plus,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, type AiOutput } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { ConnectionChips } from '@/components/review/ConnectionChips'

interface ReviewViewProps {
  meetingId: string
  aiOutput: AiOutput
  onApprove?: (exports: { md?: string; json?: string }) => void
  graphData?: {
    nodes: Array<{ id: string; node_type: string; content: string; properties: Record<string, any> }>
    edges: Array<{ source_node_id: string; target_node_id: string; edge_type: string }>
  }
  onHighlightTranscript?: (range: { start: number; end: number } | null) => void
}

type ConfidenceFilter = 'all' | 'medium+' | 'high'

function passesFilter(level: 'high' | 'medium' | 'low', filter: ConfidenceFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'medium+') return level === 'high' || level === 'medium'
  return level === 'high'
}

// --- Confidence / Severity badge ---

function LevelBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const styles: Record<string, { bg: string; text: string }> = {
    high: { bg: 'bg-chart-3/10', text: 'text-chart-3' },
    medium: { bg: 'bg-chart-4/10', text: 'text-chart-4' },
    low: { bg: 'bg-chart-5/10', text: 'text-chart-5' },
  }
  const style = styles[level]
  return (
    <Badge className={cn('border-0 capitalize', style.bg, style.text)}>
      {level}
    </Badge>
  )
}

// --- Inline editable cell ---

function EditableCell({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onChange(draft)
            setEditing(false)
          } else if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
        onBlur={() => {
          onChange(draft)
          setEditing(false)
        }}
        className="h-7 text-sm border-border/50 bg-secondary/30"
      />
    )
  }

  return (
    <span
      onClick={() => { setDraft(value); setEditing(true) }}
      className="cursor-pointer rounded-md px-1.5 py-0.5 transition-colors hover:bg-primary/5 text-sm"
      title="Click to edit"
    >
      {value}
    </span>
  )
}

// --- Optional field row (hidden when null, with + to add) ---

function OptionalField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | null | undefined
  onChange: (v: string) => void
}) {
  const [showField, setShowField] = useState(false)

  if (!value && !showField) {
    return (
      <button
        onClick={() => setShowField(true)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        title={`Add ${label}`}
      >
        <Plus className="size-3" />
        {label}
      </button>
    )
  }

  return (
    <span className="text-sm text-muted-foreground">
      {label}:{' '}
      <EditableCell value={value ?? ''} onChange={onChange} />
    </span>
  )
}

// --- Collapsible source quote with speaker attribution ---

function SourceQuote({ quote, speaker, onQuoteClick }: { quote: string; speaker?: string; onQuoteClick?: () => void }) {
  const [open, setOpen] = useState(false)

  if (!quote) return null

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <Quote className="size-3" />
        {speaker ? `${speaker} said` : 'Source Quote'}
      </button>
      {open && (
        <blockquote
          onClick={onQuoteClick}
          className={cn(
            "mt-2 border-l-2 border-primary/30 pl-3 text-xs text-muted-foreground break-words whitespace-pre-wrap",
            onQuoteClick && "cursor-pointer hover:border-primary hover:text-foreground hover:bg-primary/5 rounded-r-lg transition-colors"
          )}
          title={onQuoteClick ? "Click to find in transcript" : undefined}
        >
          {speaker && (
            <span className="not-italic font-medium text-foreground/70">{speaker}: </span>
          )}
          <span className="italic">"{quote}"</span>
        </blockquote>
      )}
    </div>
  )
}

// --- Find quote in transcript and highlight ---

function findQuoteInTranscript(quote: string, onHighlight?: (range: { start: number; end: number }) => void) {
  // This is called by parent MeetingDetail which has the transcript text
  // We pass the quote text up and let the parent search for it
  if (onHighlight && quote) {
    // The parent's onHighlightTranscript will handle searching
    // We pass a special marker to signal "search for this text"
    onHighlight({ start: -1, end: -1, searchText: quote } as any)
  }
}

// --- Scroll to element and briefly highlight ---

function scrollToAndHighlight(
  elementId: string,
  nodeMap?: Map<string, any>,
  onHighlightTranscript?: (range: any) => void,
) {
  const el = document.getElementById(elementId)
  if (el) {
    // Found the element on the page — scroll to it and glow
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background')
    setTimeout(() => {
      el.classList.remove('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background')
    }, 2000)
    return
  }

  // Element not on page (topic, person node) — try to highlight in transcript
  if (nodeMap && onHighlightTranscript) {
    const nodeId = elementId.replace('node-', '')
    const node = nodeMap.get(nodeId)
    if (node?.content) {
      findQuoteInTranscript(node.content, onHighlightTranscript)
    }
  }
}

// --- Helper: find transcript position from graphData ---

function getNodeSourceRange(
  nodeId: string,
  graphData?: ReviewViewProps['graphData']
): { start: number; end: number } | null {
  if (!graphData) return null
  const node = graphData.nodes.find(n => n.id === nodeId)
  if (!node?.properties) return null
  const start = node.properties.source_start
  const end = node.properties.source_end
  if (typeof start === 'number' && typeof end === 'number') {
    return { start, end }
  }
  return null
}

export function ReviewView({
  meetingId,
  aiOutput: initialOutput,
  onApprove,
  graphData,
  onHighlightTranscript,
}: ReviewViewProps) {
  const [output, setOutput] = useState<AiOutput>(initialOutput)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)
  const [exportLinks, setExportLinks] = useState<{ md?: string; json?: string }>({})
  const [deleteDialog, setDeleteDialog] = useState<{ type: string; label: string; idx: number } | null>(null)
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all')
  const [showUnverifiedOnly, setShowUnverifiedOnly] = useState(false)

  // Undo support (deletedItems tracked for restore callbacks in toast)
  const [, setDeletedItems] = useState<Map<string, { type: string; item: any; index: number }>>(new Map())

  const nodeMap = useMemo(() => {
    if (!graphData) return new Map<string, { id: string; node_type: string; content: string; properties: Record<string, any> }>()
    return new Map(graphData.nodes.map(n => [n.id, n]))
  }, [graphData])

  // --- Updater helpers ---

  const updateDecision = useCallback((idx: number, patch: Partial<AiOutput['decisions'][0]>) => {
    setOutput((prev) => ({
      ...prev,
      decisions: prev.decisions.map((d, i) => (i === idx ? { ...d, ...patch } : d)),
    }))
  }, [])

  const updateAction = useCallback((idx: number, patch: Partial<AiOutput['action_items'][0]>) => {
    setOutput((prev) => ({
      ...prev,
      action_items: prev.action_items.map((a, i) => (i === idx ? { ...a, ...patch } : a)),
    }))
  }, [])

  const updateRisk = useCallback((idx: number, patch: Partial<AiOutput['open_risks'][0]>) => {
    setOutput((prev) => ({
      ...prev,
      open_risks: prev.open_risks.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }))
  }, [])

  // --- Delete helpers ---

  const confirmDeleteDecision = useCallback((idx: number) => {
    const item = output.decisions[idx]
    if (!item) return
    setDeleteDialog({ type: 'decision', label: item.description, idx })
  }, [output.decisions])

  const executeDeleteDecision = useCallback((idx: number) => {
    const item = output.decisions[idx]
    if (!item) return
    setDeletedItems(prev => new Map(prev).set(item.id, { type: 'decision', item, index: idx }))
    setOutput(prev => ({ ...prev, decisions: prev.decisions.filter((_, i) => i !== idx) }))
    toast(`Removed ${item.id}`, {
      action: {
        label: 'Undo',
        onClick: () => {
          setOutput(prev => {
            const newDecisions = [...prev.decisions]
            newDecisions.splice(idx, 0, item)
            return { ...prev, decisions: newDecisions }
          })
          setDeletedItems(prev => {
            const next = new Map(prev)
            next.delete(item.id)
            return next
          })
        },
      },
    })
  }, [output.decisions])

  const confirmDeleteAction = useCallback((idx: number) => {
    const item = output.action_items[idx]
    if (!item) return
    setDeleteDialog({ type: 'action item', label: item.task, idx })
  }, [output.action_items])

  const executeDeleteAction = useCallback((idx: number) => {
    const item = output.action_items[idx]
    if (!item) return
    setDeletedItems(prev => new Map(prev).set(item.id, { type: 'action_item', item, index: idx }))
    setOutput(prev => ({ ...prev, action_items: prev.action_items.filter((_, i) => i !== idx) }))
    toast(`Removed ${item.id}`, {
      action: {
        label: 'Undo',
        onClick: () => {
          setOutput(prev => {
            const newItems = [...prev.action_items]
            newItems.splice(idx, 0, item)
            return { ...prev, action_items: newItems }
          })
          setDeletedItems(prev => {
            const next = new Map(prev)
            next.delete(item.id)
            return next
          })
        },
      },
    })
  }, [output.action_items])

  const confirmDeleteRisk = useCallback((idx: number) => {
    const item = output.open_risks[idx]
    if (!item) return
    setDeleteDialog({ type: 'risk', label: item.description, idx })
  }, [output.open_risks])

  const executeDeleteRisk = useCallback((idx: number) => {
    const item = output.open_risks[idx]
    if (!item) return
    setDeletedItems(prev => new Map(prev).set(item.id, { type: 'risk', item, index: idx }))
    setOutput(prev => ({ ...prev, open_risks: prev.open_risks.filter((_, i) => i !== idx) }))
    toast(`Removed ${item.id}`, {
      action: {
        label: 'Undo',
        onClick: () => {
          setOutput(prev => {
            const newRisks = [...prev.open_risks]
            newRisks.splice(idx, 0, item)
            return { ...prev, open_risks: newRisks }
          })
          setDeletedItems(prev => {
            const next = new Map(prev)
            next.delete(item.id)
            return next
          })
        },
      },
    })
  }, [output.open_risks])

  // --- Toggle expand ---

  const toggleExpand = useCallback((id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  // --- Highlight transcript on item click ---

  const handleItemClick = useCallback((nodeId: string) => {
    if (!onHighlightTranscript) return
    const range = getNodeSourceRange(nodeId, graphData)
    onHighlightTranscript(range)
  }, [graphData, onHighlightTranscript])

  const handleApprove = async () => {
    try {
      setApproving(true)
      const result = await api.approve(meetingId, output)
      setApproved(true)
      const links = {
        md: result.exports?.markdown,
        json: result.exports?.json,
      }
      setExportLinks(links)
      onApprove?.(links)
      toast.success('Meeting approved and exported')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approval failed')
    } finally {
      setApproving(false)
    }
  }

  // Filtered items
  const filteredDecisions = output.decisions.filter(d =>
    passesFilter(d.confidence, confidenceFilter) &&
    (!showUnverifiedOnly || !d.source_quote)
  )
  const filteredActions = output.action_items.filter(a =>
    passesFilter(a.confidence, confidenceFilter) &&
    (!showUnverifiedOnly || !a.source_quote)
  )
  const filteredRisks = output.open_risks.filter(r =>
    passesFilter(r.severity, confidenceFilter) &&
    (!showUnverifiedOnly || !r.source_quote)
  )

  const handleConfirmDelete = useCallback(() => {
    if (!deleteDialog) return
    const { type, idx } = deleteDialog
    if (type === 'decision') executeDeleteDecision(idx)
    else if (type === 'action item') executeDeleteAction(idx)
    else if (type === 'risk') executeDeleteRisk(idx)
    setDeleteDialog(null)
  }, [deleteDialog, executeDeleteDecision, executeDeleteAction, executeDeleteRisk])

  return (
    <div className="space-y-4 p-4">
      {/* Header: Approve button + confidence filter */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-secondary/30 p-0.5">
          {(['all', 'medium+', 'high'] as ConfidenceFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setConfidenceFilter(f)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                confidenceFilter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {f === 'all' ? 'All' : f === 'medium+' ? 'Medium+' : 'High only'}
            </button>
          ))}
        </div>

        {approved ? (
          <div className="flex items-center gap-2">
            {exportLinks.md && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-xl border-border/50 text-xs"
                render={<a href={exportLinks.md} download />}
              >
                <Download className="size-3.5" />
                MD
              </Button>
            )}
            {exportLinks.json && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-xl border-border/50 text-xs"
                render={<a href={exportLinks.json} download />}
              >
                <Download className="size-3.5" />
                JSON
              </Button>
            )}
            <Badge className="gap-1 bg-chart-3/10 text-chart-3 border-0 px-3 py-1.5">
              <CheckCircle2 className="size-3.5" />
              Approved
            </Badge>
          </div>
        ) : (
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={approving}
            className="gap-1.5 rounded-xl bg-chart-3 text-white hover:bg-chart-3/90"
          >
            {approving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            Approve & Export
          </Button>
        )}
      </div>

      {/* Trust flags */}
      {output.trust_flags.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-chart-4/30 bg-chart-4/5 p-3">
          <AlertTriangle className="size-4 shrink-0 text-chart-4 mt-0.5" />
          <div className="space-y-1">
            {output.trust_flags.map((flag, i) => {
              const isQuoteFlag = flag.includes('source quote')
              const isConfidenceFlag = flag.includes('low confidence')
              const isActive =
                (isQuoteFlag && showUnverifiedOnly) ||
                (isConfidenceFlag && confidenceFilter === 'medium+')

              if (isQuoteFlag || isConfidenceFlag) {
                return (
                  <button
                    key={i}
                    onClick={() => {
                      if (isQuoteFlag) {
                        setShowUnverifiedOnly((prev) => !prev)
                      } else if (isConfidenceFlag) {
                        setConfidenceFilter((prev) => prev === 'medium+' ? 'all' : 'medium+')
                      }
                    }}
                    className={cn(
                      'block text-left text-xs transition-all',
                      isActive
                        ? 'text-chart-4 underline font-medium'
                        : 'text-chart-4/90 underline decoration-dashed hover:text-chart-4'
                    )}
                    title={isActive ? 'Click to clear filter' : 'Click to filter'}
                  >
                    {flag} {isActive ? '(active)' : ''}
                  </button>
                )
              }

              return (
                <p key={i} className="text-xs text-chart-4/90">{flag}</p>
              )
            })}
          </div>
        </div>
      )}

      {/* === DECISIONS === */}
      {filteredDecisions.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 rounded-t-xl border border-chart-3/20 bg-chart-3/5 px-3 py-2">
            <CheckCircle2 className="size-4 text-chart-3" />
            <span className="text-sm font-semibold text-foreground">Decisions</span>
            <Badge variant="secondary" className="bg-secondary/50 text-xs ml-auto">
              {filteredDecisions.length}
            </Badge>
          </div>
          <div className="space-y-px">
            {filteredDecisions.map((d) => {
              const originalIdx = output.decisions.indexOf(d)
              const nodeId = `${meetingId}:decision:${originalIdx + 1}`
              const isExpanded = expandedItems.has(d.id)

              return (
                <div
                  key={d.id}
                  id={`node-${nodeId}`}
                  className="border border-border/30 bg-secondary/10 transition-all duration-300"
                >
                  {/* Compact row */}
                  <div
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-secondary/20"
                    onClick={() => {
                      toggleExpand(d.id)
                      handleItemClick(nodeId)
                    }}
                  >
                    <span className="font-mono text-xs text-muted-foreground shrink-0">{d.id}</span>
                    <LevelBadge level={d.confidence} />
                    <Badge variant="secondary" className="bg-secondary/50 text-xs shrink-0">
                      {d.decision_type}
                    </Badge>
                    <span className="text-sm text-foreground truncate flex-1">{d.description}</span>
                    {d.made_by && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        — {d.made_by}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpand(d.id) }}
                      className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"
                    >
                      {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); confirmDeleteDecision(originalIdx) }}
                      className="p-0.5 text-muted-foreground/50 hover:text-destructive shrink-0"
                      title="Remove"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-border/20 px-4 py-3 space-y-2 bg-secondary/5">
                      <div>
                        <EditableCell
                          value={d.description}
                          onChange={(v) => updateDecision(originalIdx, { description: v })}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <OptionalField
                          label="Made by"
                          value={d.made_by || null}
                          onChange={(v) => updateDecision(originalIdx, { made_by: v })}
                        />
                      </div>
                      <SourceQuote quote={d.source_quote} speaker={d.source_quote_speaker} onQuoteClick={() => findQuoteInTranscript(d.source_quote, onHighlightTranscript)} />
                      {d.confidence_rationale && (
                        <p className="text-xs text-muted-foreground/70 italic">{d.confidence_rationale}</p>
                      )}
                      {graphData && (
                        <ConnectionChips
                          nodeId={nodeId}
                          edges={graphData.edges}
                          nodeMap={nodeMap}
                          onChipClick={(targetId) => scrollToAndHighlight(`node-${targetId}`, nodeMap, onHighlightTranscript)}
                        />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* === ACTION ITEMS === */}
      {filteredActions.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 rounded-t-xl border border-primary/20 bg-primary/5 px-3 py-2">
            <ListChecks className="size-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Action Items</span>
            <Badge variant="secondary" className="bg-secondary/50 text-xs ml-auto">
              {filteredActions.length}
            </Badge>
          </div>
          <div className="space-y-px">
            {filteredActions.map((a) => {
              const originalIdx = output.action_items.indexOf(a)
              const nodeId = `${meetingId}:action_item:${originalIdx + 1}`
              const isExpanded = expandedItems.has(a.id)

              return (
                <div
                  key={a.id}
                  id={`node-${nodeId}`}
                  className="border border-border/30 bg-secondary/10 transition-all duration-300"
                >
                  {/* Compact row */}
                  <div
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-secondary/20"
                    onClick={() => {
                      toggleExpand(a.id)
                      handleItemClick(nodeId)
                    }}
                  >
                    <span className="font-mono text-xs text-muted-foreground shrink-0">{a.id}</span>
                    <LevelBadge level={a.confidence} />
                    <span className="text-sm text-foreground truncate flex-1">{a.task}</span>
                    {a.owner && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        — {a.owner}
                      </span>
                    )}
                    {a.verified && (
                      <Badge className="border-0 bg-chart-3/10 text-chart-3 text-xs shrink-0">
                        <Check className="size-2.5 mr-0.5" />
                        Verified
                      </Badge>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpand(a.id) }}
                      className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"
                    >
                      {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); confirmDeleteAction(originalIdx) }}
                      className="p-0.5 text-muted-foreground/50 hover:text-destructive shrink-0"
                      title="Remove"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-border/20 px-4 py-3 space-y-2 bg-secondary/5">
                      <div>
                        <EditableCell
                          value={a.task}
                          onChange={(v) => updateAction(originalIdx, { task: v })}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <OptionalField
                          label="Owner"
                          value={a.owner || null}
                          onChange={(v) => updateAction(originalIdx, { owner: v })}
                        />
                        <OptionalField
                          label="Deadline"
                          value={a.deadline}
                          onChange={(v) => updateAction(originalIdx, { deadline: v || null })}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateAction(originalIdx, { verified: !a.verified })}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium transition-all',
                            a.verified
                              ? 'border-chart-3 bg-chart-3 text-white'
                              : 'border-border text-muted-foreground hover:border-chart-3 hover:bg-chart-3/10'
                          )}
                        >
                          <Check className="size-3" />
                          Verified
                        </button>
                      </div>
                      <SourceQuote quote={a.source_quote} speaker={a.source_quote_speaker} onQuoteClick={() => findQuoteInTranscript(a.source_quote, onHighlightTranscript)} />
                      {a.confidence_rationale && (
                        <p className="text-xs text-muted-foreground/70 italic">{a.confidence_rationale}</p>
                      )}
                      {graphData && (
                        <ConnectionChips
                          nodeId={nodeId}
                          edges={graphData.edges}
                          nodeMap={nodeMap}
                          onChipClick={(targetId) => scrollToAndHighlight(`node-${targetId}`, nodeMap, onHighlightTranscript)}
                        />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* === RISKS === */}
      {filteredRisks.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 rounded-t-xl border border-chart-5/20 bg-chart-5/5 px-3 py-2">
            <AlertCircle className="size-4 text-chart-5" />
            <span className="text-sm font-semibold text-foreground">Open Risks</span>
            <Badge variant="secondary" className="bg-secondary/50 text-xs ml-auto">
              {filteredRisks.length}
            </Badge>
          </div>
          <div className="space-y-px">
            {filteredRisks.map((r) => {
              const originalIdx = output.open_risks.indexOf(r)
              const nodeId = `${meetingId}:risk:${originalIdx + 1}`
              const isExpanded = expandedItems.has(r.id)

              return (
                <div
                  key={r.id}
                  id={`node-${nodeId}`}
                  className="border border-border/30 bg-secondary/10 transition-all duration-300"
                >
                  {/* Compact row */}
                  <div
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-secondary/20"
                    onClick={() => {
                      toggleExpand(r.id)
                      handleItemClick(nodeId)
                    }}
                  >
                    <span className="font-mono text-xs text-muted-foreground shrink-0">{r.id}</span>
                    <LevelBadge level={r.severity} />
                    <span className="text-sm text-foreground truncate flex-1">{r.description}</span>
                    {r.raised_by && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        — {r.raised_by}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpand(r.id) }}
                      className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"
                    >
                      {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); confirmDeleteRisk(originalIdx) }}
                      className="p-0.5 text-muted-foreground/50 hover:text-destructive shrink-0"
                      title="Remove"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-border/20 px-4 py-3 space-y-2 bg-secondary/5">
                      <div>
                        <EditableCell
                          value={r.description}
                          onChange={(v) => updateRisk(originalIdx, { description: v })}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <OptionalField
                          label="Raised by"
                          value={r.raised_by || null}
                          onChange={(v) => updateRisk(originalIdx, { raised_by: v })}
                        />
                      </div>
                      <SourceQuote quote={r.source_quote} speaker={r.source_quote_speaker} onQuoteClick={() => findQuoteInTranscript(r.source_quote, onHighlightTranscript)} />
                      {graphData && (
                        <ConnectionChips
                          nodeId={nodeId}
                          edges={graphData.edges}
                          nodeMap={nodeMap}
                          onChipClick={(targetId) => scrollToAndHighlight(`node-${targetId}`, nodeMap, onHighlightTranscript)}
                        />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={(open) => !open && setDeleteDialog(null)}>
        <DialogContent className="glass border-border/50 sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-destructive/10">
                <AlertTriangle className="size-5 text-destructive" />
              </div>
              <div>
                <DialogTitle>Remove {deleteDialog?.type}</DialogTitle>
                <DialogDescription className="mt-1">
                  This item will be removed from the analysis. You can undo after removing.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {deleteDialog && (
            <div className="py-2">
              <p className="text-sm text-foreground">
                "{deleteDialog.label.length > 100 ? deleteDialog.label.slice(0, 100) + '...' : deleteDialog.label}"
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeleteDialog(null)}
              className="rounded-xl border-border/50"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              className="gap-2 rounded-xl"
            >
              <X className="size-4" />
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
