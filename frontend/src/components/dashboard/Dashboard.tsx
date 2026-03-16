import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Upload, Radio, Loader2, Sparkles } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { MeetingCard } from './MeetingCard'
import { PrepView } from '@/components/prep/PrepView'
import { cn } from '@/lib/utils'

interface DashboardProps {
  onUploadClick: () => void
  onGoLive: () => void
  onMeetingClick: (meetingId: string) => void
  prepAgendaPreFill?: string
  prepParticipantsPreFill?: string
  onClearPreFill: () => void
  provider?: string
}

export function Dashboard({
  onUploadClick,
  onGoLive,
  onMeetingClick,
  prepAgendaPreFill,
  prepParticipantsPreFill,
  onClearPreFill,
  provider,
}: DashboardProps) {
  const { data: meetings, isLoading } = useQuery({
    queryKey: ['meetings'],
    queryFn: api.getMeetings,
  })

  const recentMeetings = meetings?.slice(0, 6) ?? []

  // Clear pre-fill after it's been consumed
  useEffect(() => {
    if (prepAgendaPreFill || prepParticipantsPreFill) {
      // Allow PrepView to pick up the values before clearing
      const timer = setTimeout(onClearPreFill, 100)
      return () => clearTimeout(timer)
    }
  }, [prepAgendaPreFill, prepParticipantsPreFill, onClearPreFill])

  return (
    <div className="space-y-10">
      {/* Welcome */}
      <div>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary ring-1 ring-primary/20">
          <Sparkles className="size-4" />
          Dashboard
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Welcome to Brainstorm{' '}
          <span className="text-gradient">Boost</span>
        </h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Upload meetings, go live, or prepare for your next session.
        </p>
      </div>

      {/* Action Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <button
          onClick={onUploadClick}
          className={cn(
            'glass glass-hover group flex flex-col items-start gap-4 rounded-xl border border-border/50 p-6',
            'text-left transition-all duration-200 hover:ring-1 hover:ring-primary/20'
          )}
        >
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/20">
            <Upload className="size-6 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Upload Meeting</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload a transcript or audio file for AI analysis.
            </p>
          </div>
        </button>

        <button
          onClick={onGoLive}
          className={cn(
            'glass glass-hover group flex flex-col items-start gap-4 rounded-xl border border-border/50 p-6',
            'text-left transition-all duration-200 hover:ring-1 hover:ring-chart-5/20'
          )}
        >
          <div className="flex size-12 items-center justify-center rounded-xl bg-chart-5/10 transition-colors group-hover:bg-chart-5/20">
            <Radio className="size-6 text-chart-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Go Live</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Start a live session with real-time transcription and collaboration.
            </p>
          </div>
        </button>
      </div>

      {/* Recent Meetings */}
      <div>
        <h2 className="mb-4 text-xl font-semibold text-foreground">Recent Meetings</h2>
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isLoading && recentMeetings.length === 0 && (
          <Card className="glass border-border/50">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-muted-foreground">
                No meetings yet. Upload a transcript or start a live session to get started.
              </p>
            </CardContent>
          </Card>
        )}
        {!isLoading && recentMeetings.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {recentMeetings.map((meeting) => (
              <MeetingCard
                key={meeting.id}
                meeting={meeting}
                onClick={() => onMeetingClick(meeting.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Prepare Section */}
      <div>
        <PrepView
          initialAgenda={prepAgendaPreFill}
          initialParticipants={prepParticipantsPreFill}
          provider={provider}
        />
      </div>
    </div>
  )
}
