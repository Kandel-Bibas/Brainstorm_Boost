import { useState, useEffect } from 'react'
import { ChevronRight, Home, Loader2, MessageCircle, BookOpen, Download, AlertCircle } from 'lucide-react'
import { api, type AiOutput } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ReviewView } from '@/components/review/ReviewView'

interface MeetingDetailProps {
  meetingId: string
  onBack: () => void
  onOpenChat: (meetingId: string) => void
  onPrepareFollowUp: (agenda: string, participants: string) => void
}

export function MeetingDetail({ meetingId, onBack, onOpenChat, onPrepareFollowUp }: MeetingDetailProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [meetingTitle, setMeetingTitle] = useState('')
  const [aiOutput, setAiOutput] = useState<AiOutput | null>(null)
  const [approved, setApproved] = useState(false)
  const [exportLinks, setExportLinks] = useState<{ md?: string; json?: string }>({})

  useEffect(() => {
    let cancelled = false
    async function fetchMeeting() {
      try {
        setLoading(true)
        setError(null)
        const detail = await api.getMeeting(meetingId)
        if (cancelled) return
        setMeetingTitle(detail.title ?? 'Meeting')
        const output = detail.verified_output_json ?? detail.ai_output_json
        if (output) {
          setAiOutput(output)
          if (detail.verified_output_json) {
            setApproved(true)
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load meeting')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchMeeting()
    return () => { cancelled = true }
  }, [meetingId])

  const handleApprove = (exports: { md?: string; json?: string }) => {
    setApproved(true)
    setExportLinks(exports)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl" />
          <Loader2 className="relative size-10 animate-spin text-primary" />
        </div>
        <span className="mt-4 text-muted-foreground">Loading meeting...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-destructive/10">
          <AlertCircle className="size-8 text-destructive" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">Failed to load meeting</h3>
        <p className="mt-2 text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={onBack} className="mt-4 rounded-xl">
          Go Back
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <button
          onClick={onBack}
          className="flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <Home className="size-4" />
          Home
        </button>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground">{meetingTitle}</span>
      </nav>

      {/* No AI output state */}
      {!aiOutput && (
        <Card className="glass border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-secondary/50 ring-1 ring-border">
              <AlertCircle className="size-8 text-muted-foreground/50" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              This meeting hasn't been analyzed yet
            </h3>
            <p className="mt-2 max-w-md text-muted-foreground">
              Upload the meeting through the dashboard to generate an AI analysis.
            </p>
            <Button variant="outline" onClick={onBack} className="mt-6 rounded-xl">
              Go Back
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ReviewView */}
      {aiOutput && (
        <>
          <ReviewView
            meetingId={meetingId}
            aiOutput={aiOutput}
            onApprove={handleApprove}
          />

          {/* Post-approval actions */}
          {approved && (
            <Card className="glass border-border/50">
              <CardContent className="flex flex-wrap items-center gap-3 py-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    const participants = aiOutput.meeting_metadata?.participants?.join(', ') ?? ''
                    onPrepareFollowUp(`Follow-up: ${meetingTitle}`, participants)
                  }}
                  className="gap-2 rounded-xl border-border/50"
                >
                  <BookOpen className="size-4" />
                  Prepare Follow-up
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onOpenChat(meetingId)}
                  className="gap-2 rounded-xl border-border/50"
                >
                  <MessageCircle className="size-4" />
                  Ask About This
                </Button>
                {exportLinks.md && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 rounded-xl border-border/50"
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
                    className="gap-2 rounded-xl border-border/50"
                    render={<a href={exportLinks.json} download />}
                  >
                    <Download className="size-4" />
                    JSON
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
