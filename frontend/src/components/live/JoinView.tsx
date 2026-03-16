import { useState, useEffect, useRef, useCallback } from 'react'
import { Hash, Loader2, Sparkles, ArrowRight, Radio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { IdeaPanel } from './IdeaPanel'
import type { Utterance } from './RoomView'
import type { Idea } from './IdeaPanel'

export function JoinView() {
  const [codeInput, setCodeInput] = useState('')
  const [joinCode, setJoinCode] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [transcript, setTranscript] = useState<Utterance[]>([])
  const [ideas, setIdeas] = useState<Idea[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Check URL for join code on mount
  useEffect(() => {
    const path = window.location.pathname
    if (path.startsWith('/join/')) {
      const code = path.slice(6)
      if (code) {
        setJoinCode(code)
      }
    } else if (path === '/join') {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      if (code) {
        setJoinCode(code)
      }
    }
  }, [])

  // Connect WebSocket when joinCode is set
  useEffect(() => {
    if (!joinCode) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/session?code=${joinCode}&role=participant`
    )
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      switch (msg.type) {
        case 'utterance':
          setTranscript((prev) => [
            ...prev,
            {
              speaker: msg.speaker ?? 'Unknown',
              text: msg.text ?? '',
              timestamp: msg.timestamp ?? new Date().toLocaleTimeString(),
            },
          ])
          break
        case 'ideas_update':
          if (Array.isArray(msg.ideas)) {
            setIdeas(msg.ideas)
          }
          break
      }
    }

    return () => {
      ws.close()
    }
  }, [joinCode])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [transcript])

  const handleJoin = () => {
    const trimmed = codeInput.trim().toUpperCase()
    if (trimmed) {
      setJoinCode(trimmed)
    }
  }

  const handleIdeaSubmit = useCallback(
    (text: string) => {
      wsRef.current?.send(JSON.stringify({ type: 'submit_idea', text }))
    },
    []
  )

  const handleIdeaVote = useCallback(
    (ideaId: string) => {
      wsRef.current?.send(JSON.stringify({ type: 'vote', idea_id: ideaId }))
    },
    []
  )

  // Pre-join: show code input
  if (!joinCode) {
    return (
      <div className="relative flex min-h-screen items-center justify-center p-4">
        {/* Ambient background */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
        </div>

        <Card className="relative z-10 w-full max-w-md glass border-border/50">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
              <Radio className="size-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Join Meeting</CardTitle>
            <p className="mt-2 text-muted-foreground">
              Enter the session code to participate
            </p>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <Input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="Enter code"
              className="h-14 text-center text-2xl font-bold tracking-[0.3em] border-border/50 bg-secondary/30 placeholder:text-muted-foreground/40 placeholder:tracking-normal placeholder:font-normal placeholder:text-base focus:border-primary/50"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleJoin()
              }}
            />
            <Button
              onClick={handleJoin}
              disabled={!codeInput.trim()}
              className="w-full h-12 gap-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Sparkles className="size-4" />
              Join Session
              <ArrowRight className="size-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Connecting state
  if (!connected) {
    return (
      <div className="relative flex min-h-screen items-center justify-center p-4">
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
        </div>

        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl animate-pulse" />
            <Loader2 className="relative size-10 animate-spin text-primary" />
          </div>
          <span className="text-lg text-muted-foreground">
            Connecting to session <span className="font-mono font-semibold text-primary">{joinCode}</span>...
          </span>
        </div>
      </div>
    )
  }

  // Connected: show transcript + ideas
  return (
    <div className="relative min-h-screen p-4">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-3xl space-y-6 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-primary-foreground">
              <Hash className="size-4" />
              <span className="font-mono text-lg font-bold">{joinCode}</span>
            </div>
            <Badge className="bg-chart-3/10 text-chart-3 border-chart-3/20">
              Connected
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-chart-5 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-chart-5" />
            </span>
            <span className="text-sm text-muted-foreground">Live</span>
          </div>
        </div>

        {/* Transcript */}
        <Card className="glass border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="size-2 rounded-full bg-chart-5 animate-pulse" />
              Live Transcript
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
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

        {/* Ideas */}
        <IdeaPanel ideas={ideas} onSubmit={handleIdeaSubmit} onVote={handleIdeaVote} />
      </div>
    </div>
  )
}
