import { useEffect, useRef } from 'react'
import { Clock, Hash } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Idea } from './IdeaPanel'

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

  return (
    <div className="space-y-4">
      {/* Join code + timer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white">
            <Hash className="size-5" />
            <span className="text-2xl font-bold tracking-widest">{joinCode}</span>
          </div>
          <span className="text-sm text-slate-500">Share this code to join</span>
        </div>
        <div className="flex items-center gap-2 text-slate-600">
          <Clock className="size-4" />
          <span className="font-mono text-sm">{elapsed}</span>
        </div>
      </div>

      {/* Transcript */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-80">
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
                    <span className="text-xs text-slate-400 shrink-0">{u.timestamp}</span>
                    <span className="text-slate-700">{u.text}</span>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Ideas results */}
      {ideas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ideas</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {[...ideas]
                .sort((a, b) => b.votes - a.votes)
                .map((idea) => (
                  <li
                    key={idea.id}
                    className="flex items-center justify-between rounded px-2 py-1 text-sm"
                  >
                    <span className="text-slate-700">{idea.text}</span>
                    <span className="text-xs font-medium text-blue-500">
                      {idea.votes} vote{idea.votes !== 1 ? 's' : ''}
                    </span>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
