import { useState, useCallback } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Check,
  CheckCircle2,
  Download,
  Loader2,
  Sparkles,
  Quote,
  Calendar,
  Users,
  Clock,
  Target,
  AlertCircle,
  ListChecks,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, type AiOutput } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

interface ReviewViewProps {
  meetingId: string
  aiOutput: AiOutput
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
        className="h-8 text-sm border-border/50 bg-secondary/30"
      />
    )
  }

  return (
    <span
      onClick={() => { setDraft(value); setEditing(true) }}
      className="cursor-pointer rounded-md px-2 py-1 transition-colors hover:bg-primary/5"
      title="Click to edit"
    >
      {value || <span className="text-muted-foreground italic">empty</span>}
    </span>
  )
}

// --- Collapsible source quote ---

function SourceQuote({ quote }: { quote: string }) {
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
        Verbatim
      </button>
      {open && (
        <blockquote className="mt-2 border-l-2 border-primary/30 pl-3 text-xs italic text-muted-foreground">
          {quote}
        </blockquote>
      )}
    </div>
  )
}

export function ReviewView({ meetingId, aiOutput: initialOutput }: ReviewViewProps) {
  const [output, setOutput] = useState<AiOutput>(initialOutput)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)
  const [exportLinks, setExportLinks] = useState<{ md?: string; json?: string }>({})

  const meta = output.meeting_metadata

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

  const handleApprove = async () => {
    try {
      setApproving(true)
      const result = await api.approve(meetingId, output)
      setApproved(true)
      setExportLinks({
        md: result.exports?.markdown,
        json: result.exports?.json,
      })
      toast.success('Meeting approved and exported')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approval failed')
    } finally {
      setApproving(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Page title */}
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-chart-3/10 px-3 py-1.5 text-sm font-medium text-chart-3 ring-1 ring-chart-3/20">
            <Sparkles className="size-4" />
            AI Analysis Complete
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Review Analysis</h1>
          <p className="mt-2 text-lg text-muted-foreground">
            Review and edit the extracted insights before approving.
          </p>
        </div>
        {approved ? (
          <div className="flex items-center gap-3">
            {exportLinks.md && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 rounded-xl border-border/50"
                render={<a href={exportLinks.md} download />}
              >
                <Download className="size-4" />
                Markdown
              </Button>
            )}
            {exportLinks.json && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 rounded-xl border-border/50"
                render={<a href={exportLinks.json} download />}
              >
                <Download className="size-4" />
                JSON
              </Button>
            )}
            <Badge className="gap-1.5 bg-chart-3/10 text-chart-3 border-0 px-4 py-2">
              <CheckCircle2 className="size-4" />
              Approved
            </Badge>
          </div>
        ) : (
          <Button
            size="lg"
            onClick={handleApprove}
            disabled={approving}
            className="gap-2 rounded-xl bg-chart-3 text-white hover:bg-chart-3/90 glow-success"
          >
            {approving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Approve & Export
          </Button>
        )}
      </div>

      {/* Trust flags */}
      {output.trust_flags.length > 0 && (
        <div className="flex items-start gap-4 rounded-xl border border-chart-4/30 bg-chart-4/5 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-chart-4/10">
            <AlertTriangle className="size-5 text-chart-4" />
          </div>
          <div>
            <p className="font-semibold text-chart-4">Trust Flags</p>
            <ul className="mt-2 space-y-1">
              {output.trust_flags.map((flag, i) => (
                <li key={i} className="text-sm text-chart-4/90">{flag}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Meeting metadata */}
      <Card className="glass border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Meeting Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <Target className="size-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Title</p>
                <p className="font-semibold text-foreground">{meta.title}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-chart-2/10">
                <Calendar className="size-5 text-chart-2" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Date</p>
                <p className="font-semibold text-foreground">{meta.date_mentioned ?? 'Not mentioned'}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-chart-3/10">
                <Users className="size-5 text-chart-3" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Participants</p>
                <p className="font-semibold text-foreground">
                  {meta.participants.length > 0 ? meta.participants.join(', ') : 'Unknown'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-chart-4/10">
                <Clock className="size-5 text-chart-4" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Duration</p>
                <p className="font-semibold text-foreground">{meta.duration_estimate ?? 'N/A'}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* State of direction */}
      <Card className="glass border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
              <Sparkles className="size-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">State of Direction</CardTitle>
              <p className="text-sm text-muted-foreground">AI interpretation of meeting direction</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-lg leading-relaxed text-foreground/90">{output.state_of_direction}</p>
        </CardContent>
      </Card>

      {/* Decisions */}
      {output.decisions.length > 0 && (
        <Card className="glass border-border/50 overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-chart-3/10">
                <CheckCircle2 className="size-5 text-chart-3" />
              </div>
              <div>
                <CardTitle className="text-lg">
                  Decisions
                  <Badge variant="secondary" className="ml-2 bg-secondary/50">
                    {output.decisions.length}
                  </Badge>
                </CardTitle>
                <p className="text-sm text-muted-foreground">Key decisions made during the meeting</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead className="w-16 text-muted-foreground">ID</TableHead>
                    <TableHead className="text-muted-foreground">Decision</TableHead>
                    <TableHead className="w-32 text-muted-foreground">Made By</TableHead>
                    <TableHead className="w-28 text-muted-foreground">Type</TableHead>
                    <TableHead className="w-24 text-muted-foreground">Confidence</TableHead>
                    <TableHead className="w-28 text-muted-foreground">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {output.decisions.map((d, idx) => (
                    <TableRow key={d.id} className="border-border/50 hover:bg-secondary/30">
                      <TableCell className="font-mono text-xs text-muted-foreground">{d.id}</TableCell>
                      <TableCell>
                        <EditableCell
                          value={d.description}
                          onChange={(v) => updateDecision(idx, { description: v })}
                        />
                      </TableCell>
                      <TableCell>
                        <EditableCell
                          value={d.made_by}
                          onChange={(v) => updateDecision(idx, { made_by: v })}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="bg-secondary/50 text-xs">
                          {d.decision_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <LevelBadge level={d.confidence} />
                      </TableCell>
                      <TableCell>
                        <SourceQuote quote={d.source_quote} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action Items */}
      {output.action_items.length > 0 && (
        <Card className="glass border-border/50 overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                <ListChecks className="size-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">
                  Action Items
                  <Badge variant="secondary" className="ml-2 bg-secondary/50">
                    {output.action_items.length}
                  </Badge>
                </CardTitle>
                <p className="text-sm text-muted-foreground">Tasks with owners and deadlines</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead className="w-16 text-muted-foreground">ID</TableHead>
                    <TableHead className="text-muted-foreground">Task</TableHead>
                    <TableHead className="w-28 text-muted-foreground">Owner</TableHead>
                    <TableHead className="w-28 text-muted-foreground">Deadline</TableHead>
                    <TableHead className="w-24 text-muted-foreground">Confidence</TableHead>
                    <TableHead className="w-16 text-center text-muted-foreground">Done</TableHead>
                    <TableHead className="w-28 text-muted-foreground">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {output.action_items.map((a, idx) => (
                    <TableRow key={a.id} className="border-border/50 hover:bg-secondary/30">
                      <TableCell className="font-mono text-xs text-muted-foreground">{a.id}</TableCell>
                      <TableCell>
                        <EditableCell
                          value={a.task}
                          onChange={(v) => updateAction(idx, { task: v })}
                        />
                      </TableCell>
                      <TableCell>
                        <EditableCell
                          value={a.owner}
                          onChange={(v) => updateAction(idx, { owner: v })}
                        />
                      </TableCell>
                      <TableCell>
                        <EditableCell
                          value={a.deadline ?? ''}
                          onChange={(v) => updateAction(idx, { deadline: v || null })}
                        />
                      </TableCell>
                      <TableCell>
                        <LevelBadge level={a.confidence} />
                      </TableCell>
                      <TableCell className="text-center">
                        <button
                          onClick={() => updateAction(idx, { verified: !a.verified })}
                          className={cn(
                            'inline-flex size-7 items-center justify-center rounded-lg border-2 transition-all',
                            a.verified
                              ? 'border-chart-3 bg-chart-3 text-white'
                              : 'border-border hover:border-chart-3 hover:bg-chart-3/10'
                          )}
                        >
                          {a.verified && <Check className="size-4" />}
                        </button>
                      </TableCell>
                      <TableCell>
                        <SourceQuote quote={a.source_quote} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Risks */}
      {output.open_risks.length > 0 && (
        <Card className="glass border-border/50 overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-chart-5/10">
                <AlertCircle className="size-5 text-chart-5" />
              </div>
              <div>
                <CardTitle className="text-lg">
                  Open Risks
                  <Badge variant="secondary" className="ml-2 bg-secondary/50">
                    {output.open_risks.length}
                  </Badge>
                </CardTitle>
                <p className="text-sm text-muted-foreground">Potential blockers and concerns</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead className="w-16 text-muted-foreground">ID</TableHead>
                    <TableHead className="text-muted-foreground">Risk</TableHead>
                    <TableHead className="w-28 text-muted-foreground">Raised By</TableHead>
                    <TableHead className="w-24 text-muted-foreground">Severity</TableHead>
                    <TableHead className="w-28 text-muted-foreground">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {output.open_risks.map((r, idx) => (
                    <TableRow key={r.id} className="border-border/50 hover:bg-secondary/30">
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.id}</TableCell>
                      <TableCell>
                        <EditableCell
                          value={r.description}
                          onChange={(v) => updateRisk(idx, { description: v })}
                        />
                      </TableCell>
                      <TableCell>
                        <EditableCell
                          value={r.raised_by}
                          onChange={(v) => updateRisk(idx, { raised_by: v })}
                        />
                      </TableCell>
                      <TableCell>
                        <LevelBadge level={r.severity} />
                      </TableCell>
                      <TableCell>
                        <SourceQuote quote={r.source_quote} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
