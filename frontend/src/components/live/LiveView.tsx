import { useState, useEffect, useRef, useCallback } from 'react'
import { Radio, Loader2, Monitor, Eye, ExternalLink, Sparkles, ArrowRight, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { RoomView } from './RoomView'
import { ModeratorView } from './ModeratorView'
import type { Utterance } from './RoomView'
import type { Idea } from './IdeaPanel'
import type { ParticipationStat, ContextItem } from './ModeratorView'
import { cn } from '@/lib/utils'

type SessionPhase = 'setup' | 'active' | 'ended'

interface LiveViewProps {
  onReviewMeeting?: (meetingId: string) => void
}

export function LiveView({ onReviewMeeting }: LiveViewProps = {}) {
  const [phase, setPhase] = useState<SessionPhase>('setup')
  const [agenda, setAgenda] = useState('')
  const [participantsRaw, setParticipantsRaw] = useState('')
  const [loading, setLoading] = useState(false)

  // Session state
  const [joinCode, setJoinCode] = useState('')
  const [showModerator, setShowModerator] = useState(true)
  const [startTime, setStartTime] = useState<number>(0)
  const [elapsed, setElapsed] = useState('00:00')

  // Live data
  const [transcript, setTranscript] = useState<Utterance[]>([])
  const [participation, setParticipation] = useState<ParticipationStat[]>([])
  const [driftScore, setDriftScore] = useState<number | null>(null)
  const [contextItems, setContextItems] = useState<ContextItem[]>([])
  const [alerts, setAlerts] = useState<string[]>([])
  const [ideas, setIdeas] = useState<Idea[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  // Timer
  useEffect(() => {
    if (phase !== 'active' || !startTime) return
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - startTime) / 1000)
      const mins = Math.floor(diff / 60)
        .toString()
        .padStart(2, '0')
      const secs = (diff % 60).toString().padStart(2, '0')
      setElapsed(`${mins}:${secs}`)
    }, 1000)
    return () => clearInterval(interval)
  }, [phase, startTime])

  // Keyboard shortcut: Ctrl+M to toggle view
  useEffect(() => {
    if (phase !== 'active') return
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'm') {
        e.preventDefault()
        setShowModerator((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close()
      recognitionRef.current?.stop()
    }
  }, [])

  const connectWebSocket = useCallback((code: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/session?code=${code}&role=moderator`
    )
    wsRef.current = ws

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
        case 'participation':
          if (msg.stats && typeof msg.stats === 'object') {
            const arr = Object.entries(msg.stats).map(([speaker, data]: [string, any]) => ({
              speaker,
              word_count: data.word_count,
              percentage: data.percentage,
              seconds_since_last_spoke: data.seconds_since_last_spoke,
            }))
            setParticipation(arr)
          }
          break
        case 'drift':
          if (typeof msg.similarity === 'number') {
            setDriftScore(msg.similarity)
          }
          break
        case 'alert':
          setAlerts((prev) => [...prev, msg.message ?? 'Alert'])
          break
        case 'context':
          if (Array.isArray(msg.items)) {
            setContextItems(msg.items)
          }
          break
        case 'ideas_update':
          if (Array.isArray(msg.ideas)) {
            setIdeas(msg.ideas)
          }
          break
      }
    }

    ws.onclose = () => {
      // Reconnection could be added here
    }

    return ws
  }, [])

  const startSpeechCapture = useCallback((ws: WebSocket) => {
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) {
      toast.info('Speech recognition not supported in this browser')
      return
    }

    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'en-US'

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results[event.results.length - 1]
      if (result.isFinal) {
        const text = result[0].transcript
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'utterance', speaker: 'Speaker', text }))
        }
      }
    }

    recognition.onend = () => {
      // Restart if session is still active
      try {
        recognition.start()
      } catch {
        // ignore
      }
    }

    recognition.start()
    recognitionRef.current = recognition
  }, [])

  const handleStart = async () => {
    const trimmedAgenda = agenda.trim()
    if (!trimmedAgenda) return

    const participants = participantsRaw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)

    try {
      setLoading(true)
      const res = await api.startLiveSession(trimmedAgenda, participants)
      const code = res.join_code as string
      setJoinCode(code)
      setStartTime(Date.now())
      setPhase('active')

      const ws = connectWebSocket(code)
      startSpeechCapture(ws)

      toast.success('Live session started!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start session')
    } finally {
      setLoading(false)
    }
  }

  const [endedMeetingId, setEndedMeetingId] = useState<string | null>(null)

  const handleEnd = async () => {
    try {
      const result = await api.endLiveSession()
      wsRef.current?.close()
      recognitionRef.current?.stop()
      setEndedMeetingId(result.meeting_id ?? null)
      setPhase('ended')
      toast.success('Session ended')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to end session')
    }
  }

  const handleDismissAlert = (index: number) => {
    setAlerts((prev) => prev.filter((_, i) => i !== index))
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

  // Setup phase
  if (phase === 'setup') {
    return (
      <div className="space-y-8">
        {/* Header */}
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-chart-5/10 px-3 py-1.5 text-sm font-medium text-chart-5 ring-1 ring-chart-5/20">
            <Radio className="size-4" />
            Live Brainstorming
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Start a live session
          </h1>
          <p className="mt-2 text-lg text-muted-foreground">
            Real-time transcription, participation tracking, and collaborative ideation.
          </p>
        </div>

        <Card className="glass border-border/50 overflow-hidden">
          <CardContent className="p-6 space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Meeting Agenda
              </label>
              <Textarea
                value={agenda}
                onChange={(e) => setAgenda(e.target.value)}
                placeholder="What will this meeting cover?"
                className="min-h-28 resize-none border-border/50 bg-secondary/30 text-base placeholder:text-muted-foreground/60 focus:border-primary/50"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Participants
              </label>
              <Input
                value={participantsRaw}
                onChange={(e) => setParticipantsRaw(e.target.value)}
                placeholder="Alice, Bob, Carol..."
                className="border-border/50 bg-secondary/30 placeholder:text-muted-foreground/60 focus:border-primary/50"
              />
              <p className="text-xs text-muted-foreground">Comma-separated names</p>
            </div>

            <Button
              onClick={handleStart}
              disabled={!agenda.trim() || loading}
              className={cn(
                'gap-2 rounded-xl px-6',
                'bg-chart-5 text-white hover:bg-chart-5/90',
                agenda.trim() && !loading && 'glow-danger'
              )}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Radio className="size-4" />
              )}
              {loading ? 'Starting...' : 'Start Live Session'}
              <ArrowRight className="size-4" />
            </Button>
          </CardContent>
        </Card>

        {/* Feature cards */}
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Radio,
              title: 'Live Transcription',
              description: 'Real-time speech-to-text capture',
              color: 'text-chart-5',
              bg: 'bg-chart-5/10',
            },
            {
              icon: Users,
              title: 'Participation Tracking',
              description: 'Monitor who\'s speaking and balance',
              color: 'text-primary',
              bg: 'bg-primary/10',
            },
            {
              icon: Sparkles,
              title: 'Idea Voting',
              description: 'Anonymous idea submission and voting',
              color: 'text-chart-4',
              bg: 'bg-chart-4/10',
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="glass glass-hover rounded-xl border border-border/50 p-5"
            >
              <div className={cn('mb-3 inline-flex rounded-lg p-2', feature.bg)}>
                <feature.icon className={cn('size-5', feature.color)} />
              </div>
              <h3 className="font-semibold text-foreground">{feature.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>

        {/* Empty state */}
        {!loading && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-6 flex size-20 items-center justify-center rounded-2xl bg-secondary/50 ring-1 ring-border">
              <Radio className="size-9 text-muted-foreground/50" />
            </div>
            <p className="text-muted-foreground">
              Configure your meeting above to start a live session.
            </p>
          </div>
        )}
      </div>
    )
  }

  // Ended phase
  if (phase === 'ended') {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Session Ended</h1>
          <p className="mt-2 text-lg text-muted-foreground">
            Your live session has been saved.
          </p>
        </div>

        <Card className="glass border-border/50 overflow-hidden">
          <CardContent className="flex flex-col items-center gap-6 py-16">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-chart-3/20 blur-xl" />
              <div className="relative flex size-20 items-center justify-center rounded-2xl bg-chart-3/10 ring-1 ring-chart-3/20">
                <Radio className="size-9 text-chart-3" />
              </div>
            </div>
            <div className="text-center">
              <h3 className="text-xl font-semibold text-foreground">
                Meeting Saved
              </h3>
              <p className="mt-2 text-muted-foreground">
                Session <span className="font-mono font-semibold text-primary">{joinCode}</span> has been
                recorded and saved to your history.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {endedMeetingId && onReviewMeeting && (
                <Button
                  onClick={() => onReviewMeeting(endedMeetingId)}
                  className="gap-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Sparkles className="size-4" />
                  Review This Meeting
                </Button>
              )}
              <Button
                variant="outline"
                className="gap-2 rounded-xl border-border/50"
                onClick={() => setPhase('setup')}
              >
                <ExternalLink className="size-4" />
                Start New Session
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Active phase
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="absolute -inset-1 animate-ping rounded-full bg-chart-5/50" />
            <span className="relative size-3 rounded-full bg-chart-5 block" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Live Session</h2>
          <Badge className="bg-chart-5/10 text-chart-5 border-chart-5/20">
            Recording
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowModerator((prev) => !prev)}
            className="gap-2 rounded-xl border-border/50"
          >
            {showModerator ? (
              <>
                <Monitor className="size-4" />
                Room View
              </>
            ) : (
              <>
                <Eye className="size-4" />
                Moderator View
              </>
            )}
          </Button>
          <span className="text-xs text-muted-foreground">Ctrl+M</span>
        </div>
      </div>

      {showModerator ? (
        <ModeratorView
          joinCode={joinCode}
          transcript={transcript}
          elapsed={elapsed}
          participation={participation}
          driftScore={driftScore}
          contextItems={contextItems}
          alerts={alerts}
          ideas={ideas}
          onDismissAlert={handleDismissAlert}
          onIdeaSubmit={handleIdeaSubmit}
          onIdeaVote={handleIdeaVote}
          onEndSession={handleEnd}
        />
      ) : (
        <RoomView
          joinCode={joinCode}
          transcript={transcript}
          elapsed={elapsed}
          ideas={ideas}
        />
      )}
    </div>
  )
}
