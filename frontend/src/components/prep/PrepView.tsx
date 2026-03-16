import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Users, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ReadAheadResult {
  summary: string
  related_decisions: string[]
  open_action_items: Array<{
    id: string
    task: string
    owner: string
    deadline: string | null
    from_meeting: string
    status?: string
  }>
  recommended_participants: Array<{
    name: string
    reason: string
    past_contribution_count: number
  }>
  assumptions: string[]
}

export function PrepView() {
  const [agenda, setAgenda] = useState('')
  const [participantsRaw, setParticipantsRaw] = useState('')
  const [provider, setProvider] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ReadAheadResult | null>(null)
  const [completedItems, setCompletedItems] = useState<Set<string>>(new Set())

  const { data: providersData } = useQuery({
    queryKey: ['providers'],
    queryFn: api.getProviders,
  })

  const providers = providersData?.providers ?? []

  const handleGenerate = async () => {
    const trimmedAgenda = agenda.trim()
    if (!trimmedAgenda) return

    const participants = participantsRaw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)

    try {
      setLoading(true)
      setResult(null)
      setCompletedItems(new Set())
      const res = await api.getReadAhead(trimmedAgenda, participants, provider)
      setResult(res)
      toast.success('Read-ahead brief generated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate read-ahead')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleComplete = async (itemId: string) => {
    if (completedItems.has(itemId)) return
    try {
      await api.updateActionItemStatus(itemId, 'completed')
      setCompletedItems((prev) => new Set(prev).add(itemId))
      toast.success('Action item marked as completed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update action item')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Prepare for a Meeting</h2>
        <p className="mt-1 text-sm text-slate-500">
          Generate a pre-meeting read-ahead brief based on past decisions and action items.
        </p>
      </div>

      {/* Input section */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">
              What is this meeting about?
            </label>
            <Textarea
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              placeholder="Describe the meeting agenda, goals, and topics to be discussed..."
              className="min-h-[100px] resize-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">
              Who is attending? (comma-separated names)
            </label>
            <Input
              value={participantsRaw}
              onChange={(e) => setParticipantsRaw(e.target.value)}
              placeholder="Alice, Bob, Carol..."
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            {providers.length > 0 && (
              <Select value={provider} onValueChange={(v) => setProvider(v ?? undefined)}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button
              onClick={handleGenerate}
              disabled={!agenda.trim() || loading}
              className="gap-2 bg-blue-600 px-6 text-white hover:bg-blue-700"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BookOpen className="size-4" />
              )}
              {loading ? 'Generating…' : 'Generate Read-Ahead'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-blue-500" />
          <span className="ml-3 text-sm text-slate-500">Generating your read-ahead brief…</span>
        </div>
      )}

      {/* Results section */}
      {result && !loading && (
        <div className="space-y-4">
          {/* Summary card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BookOpen className="size-5 text-blue-500" />
                <CardTitle className="text-lg">Briefing Summary</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="leading-relaxed text-slate-700 whitespace-pre-wrap">{result.summary}</p>
            </CardContent>
          </Card>

          {/* Related Past Decisions */}
          {result.related_decisions && result.related_decisions.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle className="size-5 text-emerald-500" />
                  <CardTitle className="text-base">Related Past Decisions</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {result.related_decisions.map((decision, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-400" />
                      {decision}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Open Action Items */}
          {result.open_action_items && result.open_action_items.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <AlertCircle className="size-5 text-amber-500" />
                  <CardTitle className="text-base">Open Action Items</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-72">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                        <th className="pb-2 pr-3 font-medium">Done</th>
                        <th className="pb-2 pr-3 font-medium">Task</th>
                        <th className="pb-2 pr-3 font-medium">Owner</th>
                        <th className="pb-2 pr-3 font-medium">Deadline</th>
                        <th className="pb-2 font-medium">From Meeting</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {result.open_action_items.map((item) => {
                        const done = completedItems.has(item.id)
                        return (
                          <tr key={item.id} className={done ? 'opacity-50' : ''}>
                            <td className="py-2 pr-3">
                              <button
                                onClick={() => handleToggleComplete(item.id)}
                                disabled={done}
                                title={done ? 'Completed' : 'Mark as completed'}
                                className="flex items-center justify-center"
                              >
                                <CheckCircle
                                  className={`size-4 ${done ? 'text-emerald-500' : 'text-slate-300 hover:text-emerald-400'}`}
                                />
                              </button>
                            </td>
                            <td className="py-2 pr-3 text-slate-800">{item.task}</td>
                            <td className="py-2 pr-3">
                              <Badge variant="secondary" className="text-xs">
                                {item.owner}
                              </Badge>
                            </td>
                            <td className="py-2 pr-3 text-slate-500">
                              {item.deadline ?? '—'}
                            </td>
                            <td className="py-2 text-slate-500 text-xs">{item.from_meeting}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Recommended Participants */}
          {result.recommended_participants && result.recommended_participants.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Users className="size-5 text-violet-500" />
                  <CardTitle className="text-base">Recommended Participants</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {result.recommended_participants.map((rec, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700">
                        {rec.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-800">{rec.name}</span>
                          <Badge variant="outline" className="text-xs text-slate-500">
                            {rec.past_contribution_count} contributions
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-500">{rec.reason}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Assumptions */}
          {result.assumptions && result.assumptions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-slate-600">Assumptions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {result.assumptions.map((assumption, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-slate-400" />
                      {assumption}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BookOpen className="mb-4 size-12 text-slate-300" />
          <p className="text-sm text-slate-400">
            Enter your meeting agenda and generate a read-ahead brief.
          </p>
        </div>
      )}
    </div>
  )
}
