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
  const styles: Record<string, string> = {
    high: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    medium: 'bg-amber-100 text-amber-700 border-amber-200',
    low: 'bg-red-100 text-red-700 border-red-200',
  }
  return (
    <Badge variant="outline" className={cn('border text-xs capitalize', styles[level])}>
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
        className="h-7 text-sm"
      />
    )
  }

  return (
    <span
      onClick={() => { setDraft(value); setEditing(true) }}
      className="cursor-pointer rounded px-1 py-0.5 hover:bg-blue-50"
      title="Click to edit"
    >
      {value || <span className="text-slate-400 italic">empty</span>}
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
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <Quote className="size-3" />
        Verbatim
      </button>
      {open && (
        <blockquote className="mt-1.5 border-l-2 border-slate-300 pl-3 text-xs italic text-slate-600">
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
    <div className="space-y-6">
      {/* Page title */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-slate-900">Review Analysis</h2>
        {approved ? (
          <div className="flex items-center gap-3">
            {exportLinks.md && (
              <Button
                variant="outline"
                size="sm"
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
                render={<a href={exportLinks.json} download />}
              >
                <Download className="size-4" />
                JSON
              </Button>
            )}
            <Badge className="gap-1 bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="size-3" />
              Approved
            </Badge>
          </div>
        ) : (
          <Button
            size="lg"
            onClick={handleApprove}
            disabled={approving}
            className="gap-2 bg-blue-600 px-6 text-white hover:bg-blue-700"
          >
            {approving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Approve &amp; Export
          </Button>
        )}
      </div>

      {/* Trust flags */}
      {output.trust_flags.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-800">Trust Flags</p>
            <ul className="mt-1 space-y-0.5">
              {output.trust_flags.map((flag, i) => (
                <li key={i} className="text-sm text-amber-700">{flag}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Meeting metadata */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Meeting Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm lg:grid-cols-4">
            <div>
              <dt className="text-slate-500">Title</dt>
              <dd className="font-medium text-slate-900">{meta.title}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Date</dt>
              <dd className="font-medium text-slate-900">{meta.date_mentioned ?? 'Not mentioned'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Participants</dt>
              <dd className="font-medium text-slate-900">
                {meta.participants.length > 0 ? meta.participants.join(', ') : 'Unknown'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Duration Estimate</dt>
              <dd className="font-medium text-slate-900">{meta.duration_estimate ?? 'N/A'}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* State of direction */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">State of Direction</CardTitle>
            <Badge variant="secondary" className="gap-1 text-xs">
              <Sparkles className="size-3" />
              AI Interpretation
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="leading-relaxed text-slate-700">{output.state_of_direction}</p>
        </CardContent>
      </Card>

      {/* Decisions */}
      {output.decisions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Decisions
              <span className="ml-2 text-sm font-normal text-slate-500">
                ({output.decisions.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">ID</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead className="w-32">Made By</TableHead>
                  <TableHead className="w-28">Type</TableHead>
                  <TableHead className="w-24">Confidence</TableHead>
                  <TableHead className="w-32">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {output.decisions.map((d, idx) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs text-slate-500">{d.id}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <EditableCell
                          value={d.description}
                          onChange={(v) => updateDecision(idx, { description: v })}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <EditableCell
                        value={d.made_by}
                        onChange={(v) => updateDecision(idx, { made_by: v })}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
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
          </CardContent>
        </Card>
      )}

      {/* Action Items */}
      {output.action_items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Action Items
              <span className="ml-2 text-sm font-normal text-slate-500">
                ({output.action_items.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">ID</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead className="w-28">Owner</TableHead>
                  <TableHead className="w-28">Deadline</TableHead>
                  <TableHead className="w-24">Confidence</TableHead>
                  <TableHead className="w-16 text-center">Verified</TableHead>
                  <TableHead className="w-32">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {output.action_items.map((a, idx) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs text-slate-500">{a.id}</TableCell>
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
                          'inline-flex size-6 items-center justify-center rounded border transition-colors',
                          a.verified
                            ? 'border-emerald-300 bg-emerald-100 text-emerald-600'
                            : 'border-slate-300 text-slate-300 hover:border-slate-400'
                        )}
                      >
                        <Check className="size-3.5" />
                      </button>
                    </TableCell>
                    <TableCell>
                      <SourceQuote quote={a.source_quote} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Risks */}
      {output.open_risks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Open Risks
              <span className="ml-2 text-sm font-normal text-slate-500">
                ({output.open_risks.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">ID</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead className="w-28">Raised By</TableHead>
                  <TableHead className="w-24">Severity</TableHead>
                  <TableHead className="w-32">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {output.open_risks.map((r, idx) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs text-slate-500">{r.id}</TableCell>
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
          </CardContent>
        </Card>
      )}
    </div>
  )
}
