import { Calendar, CheckCircle2, ListChecks } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Meeting } from '@/lib/api'

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

interface MeetingCardProps {
  meeting: Meeting & { ai_output_json?: Record<string, unknown> }
  onClick: () => void
}

export function MeetingCard({ meeting, onClick }: MeetingCardProps) {
  const aiOutput = meeting.ai_output_json as
    | { decisions?: unknown[]; action_items?: unknown[] }
    | undefined

  const decisionCount = aiOutput?.decisions?.length ?? 0
  const actionCount = aiOutput?.action_items?.length ?? 0
  const hasStats = decisionCount > 0 || actionCount > 0

  return (
    <button
      onClick={onClick}
      className="glass glass-hover flex flex-col gap-3 rounded-xl border border-border/50 p-5 text-left transition-all duration-200 hover:ring-1 hover:ring-primary/20"
    >
      <div className="flex items-start justify-between">
        <h3 className="font-semibold text-foreground line-clamp-2">{meeting.title}</h3>
        <StatusBadge status={meeting.status} />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Calendar className="size-3.5" />
        {formatDate(meeting.created_at)}
      </div>

      {hasStats && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {decisionCount > 0 && (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="size-3 text-chart-3" />
              {decisionCount} decision{decisionCount !== 1 ? 's' : ''}
            </span>
          )}
          {actionCount > 0 && (
            <span className="flex items-center gap-1">
              <ListChecks className="size-3 text-primary" />
              {actionCount} action{actionCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </button>
  )
}
