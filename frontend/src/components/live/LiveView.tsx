import { useState, useEffect, useRef, useCallback } from 'react'
import { Radio, Loader2, Monitor, Eye, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { RoomView } from './RoomView'
import { ModeratorView } from './ModeratorView'
import type { Utterance } from './RoomView'
import type { Idea } from './IdeaPanel'
import type { ParticipationStat, ContextItem } from './ModeratorView'

type SessionPhase = 'setup' | 'active' | 'ended'

export function LiveView() {
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
          if (Array.isArray(msg.stats)) {
            setParticipation(msg.stats)
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

  const handleEnd = async () => {
    try {
      await api.endLiveSession()
      wsRef.current?.close()
      recognitionRef.current?.stop()
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
      wsRef.current?.send(JSON.stringify({ type: 'idea', text }))
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
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Live Meeting</h2>
          <p className="mt-1 text-sm text-slate-500">
            Start a live brainstorming session with real-time transcription and analytics.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">
                Meeting Agenda
              </label>
              <Textarea
                value={agenda}
                onChange={(e) => setAgenda(e.target.value)}
                placeholder="What will this meeting cover?"
                className="min-h-[100px] resize-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">
                Participants (comma-separated)
              </label>
              <Input
                value={participantsRaw}
                onChange={(e) => setParticipantsRaw(e.target.value)}
                placeholder="Alice, Bob, Carol..."
              />
            </div>

            <Button
              onClick={handleStart}
              disabled={!agenda.trim() || loading}
              className="gap-2 bg-blue-600 px-6 text-white hover:bg-blue-700"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Radio className="size-4" />
              )}
              {loading ? 'Starting...' : 'Start Live Session'}
            </Button>
          </CardContent>
        </Card>

        {/* Empty state */}
        {!loading && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Radio className="mb-4 size-12 text-slate-300" />
            <p className="text-sm text-slate-400">
              Set up your meeting agenda and start a live session.
            </p>
          </div>
        )}
      </div>
    )
  }

  // Ended phase
  if (phase === 'ended') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Session Ended</h2>
          <p className="mt-1 text-sm text-slate-500">
            Your live session has been saved. A meeting record has been created.
          </p>
        </div>

        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100">
              <Radio className="size-8 text-emerald-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800">
              Meeting Created
            </h3>
            <p className="text-sm text-slate-500">
              Session <span className="font-mono font-medium">{joinCode}</span> has been
              saved. You can review it in the Meetings tab.
            </p>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setPhase('setup')}
            >
              <ExternalLink className="size-4" />
              Start New Session
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Active phase
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="size-2 animate-pulse rounded-full bg-red-500" />
          <h2 className="text-lg font-semibold text-slate-900">Live Session</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowModerator((prev) => !prev)}
            className="gap-1.5"
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
          <span className="text-xs text-slate-400">Ctrl+M to toggle</span>
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
