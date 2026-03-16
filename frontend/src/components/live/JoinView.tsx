import { useState, useEffect, useRef, useCallback } from 'react'
import { Hash, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
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
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Join Meeting</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="Enter join code"
              className="text-center text-lg tracking-widest"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleJoin()
              }}
            />
            <Button
              onClick={handleJoin}
              disabled={!codeInput.trim()}
              className="w-full gap-2 bg-blue-600 text-white hover:bg-blue-700"
            >
              <Hash className="size-4" />
              Join
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Connecting state
  if (!connected) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 animate-spin text-blue-500" />
          <span className="text-slate-500">Connecting to session {joinCode}...</span>
        </div>
      </div>
    )
  }

  // Connected: show transcript + ideas
  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-600">
            <Hash className="size-4" />
            <span className="font-mono text-sm font-medium">{joinCode}</span>
          </div>
          <span className="text-xs text-emerald-600 font-medium">Connected</span>
        </div>

        {/* Transcript */}
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

        {/* Ideas */}
        <IdeaPanel ideas={ideas} onSubmit={handleIdeaSubmit} onVote={handleIdeaVote} />
      </div>
    </div>
  )
}
