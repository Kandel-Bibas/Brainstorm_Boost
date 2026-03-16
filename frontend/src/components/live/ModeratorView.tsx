import { useEffect, useRef } from 'react'
import {
  Clock,
  Hash,
  X,
  AlertTriangle,
  BarChart3,
  Compass,
  FileText,
  StopCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IdeaPanel } from './IdeaPanel'
import type { Utterance } from './RoomView'
import type { Idea } from './IdeaPanel'
import { cn } from '@/lib/utils'

export interface ParticipationStat {
  speaker: string
  word_count: number
  percentage: number
  seconds_since_last_spoke: number | null
}

export interface ContextItem {
  meeting_title: string
  content: string
}

interface ModeratorViewProps {
  joinCode: string
  transcript: Utterance[]
  elapsed: string
  participation: ParticipationStat[]
  driftScore: number | null
  contextItems: ContextItem[]
  alerts: string[]
  ideas: Idea[]
  onDismissAlert: (index: number) => void
  onIdeaSubmit: (text: string) => void
  onIdeaVote: (ideaId: string) => void
  onEndSession: () => void
}

function getParticipationColor(pct: number) {
  if (pct > 45) return 'bg-chart-5'
  if (pct > 30) return 'bg-chart-4'
  return 'bg-chart-3'
}

function getDriftColor(score: number) {
  if (score > 0.5) return 'text-chart-3'
  if (score >= 0.35) return 'text-chart-4'
  return 'text-chart-5'
}

function getDriftLabel(score: number) {
  if (score > 0.5) return 'On Topic'
  if (score >= 0.35) return 'Slight Drift'
  return 'Off Topic'
}

function getDriftBg(score: number) {
  if (score > 0.5) return 'bg-chart-3/10'
  if (score >= 0.35) return 'bg-chart-4/10'
  return 'bg-chart-5/10'
}

export function ModeratorView({
  joinCode,
  transcript,
  elapsed,
  participation,
  driftScore,
  contextItems,
  alerts,
  ideas,
  onDismissAlert,
  onIdeaSubmit,
  onIdeaVote,
  onEndSession,
}: ModeratorViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [transcript])

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 rounded-xl bg-primary px-5 py-3 text-primary-foreground glow-sm">
            <Hash className="size-5" />
            <span className="text-2xl font-bold tracking-widest">{joinCode}</span>
          </div>
          <Badge variant="secondary" className="bg-secondary/50 text-secondary-foreground">
            Moderator
          </Badge>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-4 py-2">
            <Clock className="size-4 text-muted-foreground" />
            <span className="font-mono text-lg font-semibold text-foreground">{elapsed}</span>
          </div>
          <Button
            onClick={onEndSession}
            variant="destructive"
            className="gap-2 rounded-xl"
          >
            <StopCircle className="size-4" />
            End Session
          </Button>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-xl border border-chart-4/30 bg-chart-4/10 px-5 py-3"
            >
              <div className="flex items-center gap-3 text-chart-4">
                <AlertTriangle className="size-5 shrink-0" />
                <span className="font-medium">{alert}</span>
              </div>
              <button
                onClick={() => onDismissAlert(i)}
                className="rounded-lg p-1.5 text-chart-4/60 transition-colors hover:bg-chart-4/20 hover:text-chart-4"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: Transcript + Ideas */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="glass border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <div className="size-2 rounded-full bg-chart-5 animate-pulse" />
                Live Transcript
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-72">
                <div ref={scrollRef} className="space-y-3 pr-4">
                  {transcript.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-secondary/50">
                        <Hash className="size-6 text-muted-foreground/50" />
                      </div>
                      <p className="text-muted-foreground">Waiting for speech...</p>
                    </div>
                  ) : (
                    transcript.map((u, i) => (
                      <div key={i} className="flex gap-3 text-sm">
                        <span className="shrink-0 font-semibold text-primary">
                          {u.speaker}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0 pt-0.5">
                          {u.timestamp}
                        </span>
                        <span className="text-foreground/90">{u.text}</span>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Idea panel */}
          <IdeaPanel ideas={ideas} onSubmit={onIdeaSubmit} onVote={onIdeaVote} />
        </div>

        {/* Right column: Analytics */}
        <div className="space-y-6">
          {/* Participation */}
          <Card className="glass border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
                  <BarChart3 className="size-4 text-primary" />
                </div>
                <CardTitle className="text-sm">Participation</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {participation.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data yet</p>
              ) : (
                participation.map((p) => (
                  <div key={p.speaker} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-foreground">{p.speaker}</span>
                      <span className="text-muted-foreground">{Math.round(p.percentage)}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-secondary">
                      <div
                        className={cn(
                          'h-2 rounded-full transition-all duration-500',
                          getParticipationColor(p.percentage)
                        )}
                        style={{ width: `${Math.min(p.percentage, 100)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Topic Drift */}
          <Card className="glass border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-chart-2/10">
                  <Compass className="size-4 text-chart-2" />
                </div>
                <CardTitle className="text-sm">Topic Drift</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {driftScore === null ? (
                <p className="text-sm text-muted-foreground">Waiting for data...</p>
              ) : (
                <div className="flex items-center gap-4">
                  <span className={cn('text-3xl font-bold', getDriftColor(driftScore))}>
                    {driftScore.toFixed(2)}
                  </span>
                  <Badge
                    className={cn(
                      'border-0',
                      getDriftBg(driftScore),
                      getDriftColor(driftScore)
                    )}
                  >
                    {getDriftLabel(driftScore)}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Context Cards */}
          {contextItems.length > 0 && (
            <Card className="glass border-border/50">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-chart-3/10">
                    <FileText className="size-4 text-chart-3" />
                  </div>
                  <CardTitle className="text-sm">Related Context</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-48">
                  <ul className="space-y-3">
                    {contextItems.map((item, i) => (
                      <li
                        key={i}
                        className="rounded-xl border border-border/50 bg-secondary/30 p-3"
                      >
                        <p className="text-sm font-medium text-foreground">
                          {item.meeting_title}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                          {item.content}
                        </p>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
