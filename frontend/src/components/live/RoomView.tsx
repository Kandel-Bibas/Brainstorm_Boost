import { useEffect, useRef } from 'react'
import { Clock, Hash, Trophy } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import type { Idea } from './IdeaPanel'
import { cn } from '@/lib/utils'

export interface Utterance {
  speaker: string
  text: string
  timestamp: string
}

interface RoomViewProps {
  joinCode: string
  transcript: Utterance[]
  elapsed: string
  ideas: Idea[]
}

export function RoomView({ joinCode, transcript, elapsed, ideas }: RoomViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [transcript])

  const sortedIdeas = [...ideas].sort((a, b) => b.votes - a.votes)

  return (
    <div className="space-y-6">
      {/* Join code + timer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 rounded-xl bg-primary px-5 py-3 text-primary-foreground glow-sm">
            <Hash className="size-5" />
            <span className="text-2xl font-bold tracking-widest">{joinCode}</span>
          </div>
          <span className="text-sm text-muted-foreground">Share this code to join</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-4 py-2">
          <Clock className="size-4 text-muted-foreground" />
          <span className="font-mono text-lg font-semibold text-foreground">{elapsed}</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Transcript */}
        <Card className="glass border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="size-2 rounded-full bg-chart-5 animate-pulse" />
              Live Transcript
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-80">
              <div ref={scrollRef} className="space-y-3 pr-4">
                {transcript.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
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

        {/* Ideas results */}
        <Card className="glass border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="size-4 text-chart-4" />
              Top Ideas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sortedIdeas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-secondary/50">
                  <Trophy className="size-6 text-muted-foreground/50" />
                </div>
                <p className="text-muted-foreground">No ideas submitted yet</p>
              </div>
            ) : (
              <ScrollArea className="h-80">
                <ul className="space-y-3 pr-4">
                  {sortedIdeas.map((idea, index) => (
                    <li
                      key={idea.id}
                      className={cn(
                        'flex items-center justify-between rounded-xl border border-border/50 bg-secondary/30 px-4 py-3',
                        index === 0 && 'border-chart-4/30 bg-chart-4/5'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className={cn(
                          'flex size-7 items-center justify-center rounded-lg text-sm font-semibold',
                          index === 0 ? 'bg-chart-4/20 text-chart-4' : 'bg-secondary text-muted-foreground'
                        )}>
                          {index + 1}
                        </span>
                        <span className="text-foreground">{idea.text}</span>
                      </div>
                      <Badge 
                        variant="secondary" 
                        className={cn(
                          'text-sm',
                          index === 0 ? 'bg-chart-4/10 text-chart-4' : 'bg-secondary/50'
                        )}
                      >
                        {idea.votes} vote{idea.votes !== 1 ? 's' : ''}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
