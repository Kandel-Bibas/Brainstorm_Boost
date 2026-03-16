import { useQuery } from '@tanstack/react-query'
import { FileText, Loader2, Calendar, ChevronRight, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { api, type AiOutput } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface MeetingsViewProps {
  onSelectMeeting: (meetingId: string, aiOutput: AiOutput) => void
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string }> = {
    uploaded: { bg: 'bg-secondary/50', text: 'text-muted-foreground' },
    analyzed: { bg: 'bg-chart-4/10', text: 'text-chart-4' },
    approved: { bg: 'bg-chart-3/10', text: 'text-chart-3' },
  }
  const style = styles[status] ?? styles.uploaded
  return (
    <Badge className={cn('border-0 capitalize', style.bg, style.text)}>
      {status}
    </Badge>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export function MeetingsView({ onSelectMeeting }: MeetingsViewProps) {
  const { data: meetings, isLoading } = useQuery({
    queryKey: ['meetings'],
    queryFn: api.getMeetings,
  })

  const handleRowClick = async (id: string, status: string) => {
    if (status === 'uploaded') {
      toast.info('This meeting has not been analyzed yet.')
      return
    }
    try {
      const detail = await api.getMeeting(id)
      onSelectMeeting(id, detail.verified_output_json ?? detail.ai_output_json)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load meeting')
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-secondary/50 px-3 py-1.5 text-sm font-medium text-muted-foreground ring-1 ring-border/50">
          <Clock className="size-4" />
          History
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Meeting History</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          View and revisit past meeting analyses.
        </p>
      </div>

      {isLoading && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl" />
            <Loader2 className="relative size-10 animate-spin text-primary" />
          </div>
          <span className="mt-4 text-muted-foreground">Loading meetings...</span>
        </div>
      )}

      {!isLoading && (!meetings || meetings.length === 0) && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-6 flex size-20 items-center justify-center rounded-2xl bg-secondary/50 ring-1 ring-border">
            <FileText className="size-9 text-muted-foreground/50" />
          </div>
          <h3 className="text-xl font-semibold text-foreground">No meetings yet</h3>
          <p className="mt-2 max-w-md text-muted-foreground">
            Upload a transcript to get started with your first meeting analysis.
          </p>
        </div>
      )}

      {!isLoading && meetings && meetings.length > 0 && (
        <Card className="glass border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              All Meetings
              <Badge variant="secondary" className="bg-secondary/50">
                {meetings.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {meetings.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleRowClick(m.id, m.status)}
                  className="flex w-full items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-secondary/30"
                >
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <FileText className="size-6 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground truncate">{m.title}</p>
                    <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="size-3.5" />
                        {formatDate(m.created_at)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="size-3.5" />
                        {formatTime(m.created_at)}
                      </span>
                    </div>
                  </div>
                  <StatusBadge status={m.status} />
                  <ChevronRight className="size-5 text-muted-foreground" />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
