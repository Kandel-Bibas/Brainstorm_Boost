import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Users, CheckCircle, AlertCircle, Loader2, Sparkles, ArrowRight, Calendar } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface ReadAheadResult {
  summary: string
  related_decisions: string[]
  open_action_items: Array<{
    id: string
    task: string
    owner: string
    deadline: string | null
    from_meeting: string
    status?: string
  }>
  recommended_participants: Array<{
    name: string
    reason: string
    past_contribution_count: number
  }>
  assumptions: string[]
}

export function PrepView() {
  const [agenda, setAgenda] = useState('')
  const [participantsRaw, setParticipantsRaw] = useState('')
  const [provider, setProvider] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ReadAheadResult | null>(null)
  const [completedItems, setCompletedItems] = useState<Set<string>>(new Set())

  const { data: providersData } = useQuery({
    queryKey: ['providers'],
    queryFn: api.getProviders,
  })

  const providers = providersData?.providers ?? []

  const handleGenerate = async () => {
    const trimmedAgenda = agenda.trim()
    if (!trimmedAgenda) return

    const participants = participantsRaw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)

    try {
      setLoading(true)
      setResult(null)
      setCompletedItems(new Set())
      const res = await api.getReadAhead(trimmedAgenda, participants, provider)
      setResult(res)
      toast.success('Read-ahead brief generated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate read-ahead')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleComplete = async (itemId: string) => {
    if (completedItems.has(itemId)) return
    try {
      await api.updateActionItemStatus(itemId, 'completed')
      setCompletedItems((prev) => new Set(prev).add(itemId))
      toast.success('Action item marked as completed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update action item')
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-chart-2/10 px-3 py-1.5 text-sm font-medium text-chart-2 ring-1 ring-chart-2/20">
          <BookOpen className="size-4" />
          Meeting Preparation
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Prepare for your next meeting
        </h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Generate a pre-meeting brief based on past decisions and action items.
        </p>
      </div>

      {/* Input section */}
      <Card className="glass border-border/50 overflow-hidden">
        <CardContent className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Meeting Agenda
            </label>
            <Textarea
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              placeholder="What will this meeting cover? Goals, topics, and key questions..."
              className="min-h-28 resize-none border-border/50 bg-secondary/30 text-base placeholder:text-muted-foreground/60 focus:border-primary/50"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Attendees
            </label>
            <Input
              value={participantsRaw}
              onChange={(e) => setParticipantsRaw(e.target.value)}
              placeholder="Alice, Bob, Carol..."
              className="border-border/50 bg-secondary/30 placeholder:text-muted-foreground/60 focus:border-primary/50"
            />
            <p className="text-xs text-muted-foreground">Comma-separated names</p>
          </div>

          <div className="flex items-center gap-4 pt-2">
            {providers.length > 0 && (
              <Select value={provider} onValueChange={(v) => setProvider(v ?? undefined)}>
                <SelectTrigger className="w-44 border-border/50 bg-secondary/50">
                  <SelectValue placeholder="AI Provider" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {providers.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button
              onClick={handleGenerate}
              disabled={!agenda.trim() || loading}
              className={cn(
                'gap-2 rounded-xl px-6',
                'bg-chart-2 text-chart-2-foreground hover:bg-chart-2/90',
                agenda.trim() && !loading && 'glow-sm'
              )}
              style={{ '--glow-primary': 'var(--chart-2)' } as React.CSSProperties}
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  Generate Brief
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-chart-2/20 blur-xl" />
            <Loader2 className="relative size-10 animate-spin text-chart-2" />
          </div>
          <span className="mt-4 text-muted-foreground">Generating your read-ahead brief...</span>
        </div>
      )}

      {/* Results section */}
      {result && !loading && (
        <div className="space-y-6 fade-in">
          {/* Summary card */}
          <Card className="glass border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-chart-2/10">
                  <BookOpen className="size-5 text-chart-2" />
                </div>
                <CardTitle className="text-xl">Briefing Summary</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="leading-relaxed text-muted-foreground whitespace-pre-wrap">{result.summary}</p>
            </CardContent>
          </Card>

          {/* Two-column layout */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Related Past Decisions */}
            {result.related_decisions && result.related_decisions.length > 0 && (
              <Card className="glass border-border/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-chart-3/10">
                      <CheckCircle className="size-5 text-chart-3" />
                    </div>
                    <div>
                      <CardTitle className="text-base">Past Decisions</CardTitle>
                      <p className="text-sm text-muted-foreground">Related to this meeting</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {result.related_decisions.map((decision, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm">
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-chart-3" />
                        <span className="text-foreground/90">{decision}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Recommended Participants */}
            {result.recommended_participants && result.recommended_participants.length > 0 && (
              <Card className="glass border-border/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                      <Users className="size-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">Recommended Participants</CardTitle>
                      <p className="text-sm text-muted-foreground">Based on past contributions</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-4">
                    {result.recommended_participants.map((rec, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                          {rec.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{rec.name}</span>
                            <Badge variant="secondary" className="text-xs bg-secondary/50">
                              {rec.past_contribution_count} contributions
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-sm text-muted-foreground">{rec.reason}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Open Action Items */}
          {result.open_action_items && result.open_action_items.length > 0 && (
            <Card className="glass border-border/50">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-chart-4/10">
                    <AlertCircle className="size-5 text-chart-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Open Action Items</CardTitle>
                    <p className="text-sm text-muted-foreground">Tasks requiring attention</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-80">
                  <div className="space-y-3">
                    {result.open_action_items.map((item) => {
                      const done = completedItems.has(item.id)
                      return (
                        <div
                          key={item.id}
                          className={cn(
                            'group flex items-start gap-4 rounded-xl border border-border/50 bg-secondary/30 p-4 transition-all',
                            done && 'opacity-50'
                          )}
                        >
                          <button
                            onClick={() => handleToggleComplete(item.id)}
                            disabled={done}
                            className={cn(
                              'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                              done
                                ? 'border-chart-3 bg-chart-3 text-chart-3-foreground'
                                : 'border-border hover:border-chart-3 hover:bg-chart-3/10'
                            )}
                          >
                            {done && <CheckCircle className="size-3.5" />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className={cn('font-medium text-foreground', done && 'line-through')}>{item.task}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Badge variant="secondary" className="bg-primary/10 text-primary">
                                {item.owner}
                              </Badge>
                              {item.deadline && (
                                <Badge variant="outline" className="gap-1 border-border/50 text-muted-foreground">
                                  <Calendar className="size-3" />
                                  {item.deadline}
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">
                                from {item.from_meeting}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Assumptions */}
          {result.assumptions && result.assumptions.length > 0 && (
            <Card className="glass border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-muted-foreground">Assumptions Made</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {result.assumptions.map((assumption, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                      {assumption}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-6 flex size-20 items-center justify-center rounded-2xl bg-secondary/50 ring-1 ring-border">
            <BookOpen className="size-9 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">No brief generated yet</h3>
          <p className="mt-2 max-w-md text-muted-foreground">
            Enter your meeting agenda above to generate a comprehensive read-ahead brief.
          </p>
        </div>
      )}
    </div>
  )
}
