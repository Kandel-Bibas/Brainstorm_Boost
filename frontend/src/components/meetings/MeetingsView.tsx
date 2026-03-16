import { useQuery } from '@tanstack/react-query'
import { FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, type AiOutput } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

interface MeetingsViewProps {
  onSelectMeeting: (meetingId: string, aiOutput: AiOutput) => void
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    uploaded: 'bg-slate-100 text-slate-600 border-slate-200',
    analyzed: 'bg-amber-100 text-amber-700 border-amber-200',
    approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  }
  return (
    <Badge variant="outline" className={cn('border text-xs capitalize', styles[status] ?? styles.uploaded)}>
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
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
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
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Meeting History</h2>
        <p className="mt-1 text-sm text-slate-500">
          View and revisit past meeting analyses.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-blue-500" />
        </div>
      )}

      {!isLoading && (!meetings || meetings.length === 0) && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FileText className="mb-4 size-12 text-slate-300" />
          <p className="text-lg font-medium text-slate-600">No meetings yet</p>
          <p className="mt-1 text-sm text-slate-400">
            Upload a transcript to get started.
          </p>
        </div>
      )}

      {!isLoading && meetings && meetings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              All Meetings
              <span className="ml-2 text-sm font-normal text-slate-500">
                ({meetings.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-44">Date</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meetings.map((m) => (
                  <TableRow
                    key={m.id}
                    onClick={() => handleRowClick(m.id, m.status)}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-medium text-slate-900">{m.title}</TableCell>
                    <TableCell className="text-slate-600">{formatDate(m.created_at)}</TableCell>
                    <TableCell>
                      <StatusBadge status={m.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
