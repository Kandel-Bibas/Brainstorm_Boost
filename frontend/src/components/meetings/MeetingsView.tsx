import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Loader2, Calendar, ChevronRight, Clock, Search, Trash2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface MeetingsViewProps {
  onSelectMeeting: (meetingId: string) => void
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

const STATUS_OPTIONS = ['all', 'uploaded', 'analyzed', 'approved'] as const

export function MeetingsView({ onSelectMeeting }: MeetingsViewProps) {
  const queryClient = useQueryClient()
  const { data: meetings, isLoading } = useQuery({
    queryKey: ['meetings'],
    queryFn: api.getMeetings,
  })

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string; status: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleDeleteClick = (e: React.MouseEvent, meeting: { id: string; title: string; status: string }) => {
    e.stopPropagation()
    setDeleteTarget(meeting)
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteMeeting(deleteTarget.id)
      queryClient.invalidateQueries({ queryKey: ['meetings'] })
      toast.success(`"${deleteTarget.title}" deleted`)
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete meeting')
    } finally {
      setDeleting(false)
    }
  }

  const filteredMeetings = meetings?.filter((m) => {
    const matchesSearch = !search || m.title.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === 'all' || m.status === statusFilter
    return matchesSearch && matchesStatus
  }) ?? []

  const handleRowClick = (id: string) => {
    onSelectMeeting(id)
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

      {/* Search + Status filters */}
      {!isLoading && meetings && meetings.length > 0 && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Search input */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search meetings…"
              className={cn(
                'w-full rounded-xl border border-border/50 bg-secondary/20 py-2 pl-9 pr-4 text-sm text-foreground',
                'placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:bg-primary/5 transition-all'
              )}
            />
          </div>

          {/* Status pill filters */}
          <div className="flex items-center gap-1 rounded-xl bg-secondary/50 p-1 ring-1 ring-border/50">
            {STATUS_OPTIONS.map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  'rounded-lg px-3 py-1 text-xs font-medium capitalize transition-all duration-150',
                  statusFilter === status
                    ? 'bg-card text-foreground shadow-sm ring-1 ring-border/50'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {status === 'all' ? 'All' : status}
              </button>
            ))}
          </div>
        </div>
      )}

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

      {!isLoading && meetings && meetings.length > 0 && filteredMeetings.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-secondary/50 ring-1 ring-border">
            <Search className="size-6 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">No results found</h3>
          <p className="mt-2 text-muted-foreground">Try adjusting your search or filter.</p>
        </div>
      )}

      {!isLoading && meetings && meetings.length > 0 && filteredMeetings.length > 0 && (
        <Card className="glass border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              All Meetings
              <Badge variant="secondary" className="bg-secondary/50">
                {filteredMeetings.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {filteredMeetings.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleRowClick(m.id)}
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
                  <button
                    onClick={(e) => handleDeleteClick(e, { id: m.id, title: m.title, status: m.status })}
                    className="rounded-lg p-2 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title="Delete meeting"
                  >
                    <Trash2 className="size-4" />
                  </button>
                  <ChevronRight className="size-5 text-muted-foreground" />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="glass border-border/50 sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-destructive/10">
                <AlertTriangle className="size-5 text-destructive" />
              </div>
              <div>
                <DialogTitle>Delete Meeting</DialogTitle>
                <DialogDescription className="mt-1">
                  This action cannot be undone.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {deleteTarget && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-foreground">
                Are you sure you want to delete <strong>"{deleteTarget.title}"</strong>?
              </p>
              <div className="space-y-2 rounded-lg bg-destructive/5 border border-destructive/20 p-3 text-xs text-destructive">
                <p className="font-medium">This will permanently remove:</p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>The meeting transcript and all analysis data</li>
                  <li>All extracted decisions, action items, and risks</li>
                  <li>Knowledge graph nodes and relationships</li>
                  <li>Any exported files linked to this meeting</li>
                  <li>This meeting's data from the knowledge base (ChromaDB)</li>
                </ul>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="rounded-xl border-border/50"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="gap-2 rounded-xl"
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete Meeting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
