import { useEffect, useRef } from 'react'
import {
  Clock,
  Hash,
  X,
  AlertTriangle,
  BarChart3,
  Compass,
  FileText,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IdeaPanel } from './IdeaPanel'
import type { Utterance } from './RoomView'
import type { Idea } from './IdeaPanel'

export interface ParticipationStat {
  speaker: string
  word_count: number
  percentage: number
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
  if (pct > 45) return 'bg-red-500'
  if (pct > 30) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function getDriftColor(score: number) {
  if (score > 0.5) return 'text-emerald-600'
  if (score >= 0.35) return 'text-amber-600'
  return 'text-red-600'
}

function getDriftLabel(score: number) {
  if (score > 0.5) return 'On Topic'
  if (score >= 0.35) return 'Slight Drift'
  return 'Off Topic'
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
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white">
            <Hash className="size-5" />
            <span className="text-2xl font-bold tracking-widest">{joinCode}</span>
          </div>
          <Badge variant="secondary">Moderator</Badge>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-slate-600">
            <Clock className="size-4" />
            <span className="font-mono text-sm">{elapsed}</span>
          </div>
          <Button
            onClick={onEndSession}
            variant="destructive"
            size="sm"
            className="gap-1.5"
          >
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
              className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2"
            >
              <div className="flex items-center gap-2 text-sm text-amber-800">
                <AlertTriangle className="size-4 shrink-0" />
                {alert}
              </div>
              <button
                onClick={() => onDismissAlert(i)}
                className="text-amber-400 hover:text-amber-600"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left column: Transcript */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Live Transcript</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64">
                <div ref={scrollRef} className="space-y-2 pr-2">
                  {transcript.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-400">
                      Waiting for speech...
                    </p>
                  ) : (
                    transcript.map((u, i) => (
                      <div key={i} className="flex gap-2 text-sm">
                        <span className="shrink-0 font-medium text-blue-600">
                          {u.speaker}
                        </span>
                        <span className="text-xs text-slate-400 shrink-0">
                          {u.timestamp}
                        </span>
                        <span className="text-slate-700">{u.text}</span>
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
        <div className="space-y-4">
          {/* Participation */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart3 className="size-4 text-blue-500" />
                <CardTitle className="text-sm">Participation</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {participation.length === 0 ? (
                <p className="text-xs text-slate-400">No data yet</p>
              ) : (
                participation.map((p) => (
                  <div key={p.speaker} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">{p.speaker}</span>
                      <span className="text-slate-500">{Math.round(p.percentage)}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100">
                      <div
                        className={`h-2 rounded-full transition-all ${getParticipationColor(p.percentage)}`}
                        style={{ width: `${Math.min(p.percentage, 100)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Topic Drift */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Compass className="size-4 text-violet-500" />
                <CardTitle className="text-sm">Topic Drift</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {driftScore === null ? (
                <p className="text-xs text-slate-400">Waiting for data...</p>
              ) : (
                <div className="flex items-center gap-3">
                  <span className={`text-2xl font-bold ${getDriftColor(driftScore)}`}>
                    {driftScore.toFixed(2)}
                  </span>
                  <Badge
                    variant="outline"
                    className={getDriftColor(driftScore)}
                  >
                    {getDriftLabel(driftScore)}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Context Cards */}
          {contextItems.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-emerald-500" />
                  <CardTitle className="text-sm">Related Context</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-48">
                  <ul className="space-y-2">
                    {contextItems.map((item, i) => (
                      <li
                        key={i}
                        className="rounded border border-slate-100 bg-slate-50 p-2"
                      >
                        <p className="text-xs font-medium text-slate-700">
                          {item.meeting_title}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">
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
