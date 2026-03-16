import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Loader2, MessageSquare, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface QueryResult {
  answer: string
  sources?: Array<{
    meeting_title?: string
    item_type?: string
    content?: string
  }>
}

export function QueryView() {
  const [question, setQuestion] = useState('')
  const [provider, setProvider] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)

  const { data: providersData } = useQuery({
    queryKey: ['providers'],
    queryFn: api.getProviders,
  })

  const providers = providersData?.providers ?? []

  const handleQuery = async () => {
    const trimmed = question.trim()
    if (!trimmed) return

    try {
      setLoading(true)
      setResult(null)
      const res = await api.queryMemory(trimmed, provider)
      setResult(res)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Query failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Ask About Past Meetings</h2>
        <p className="mt-1 text-sm text-slate-500">
          Search across all analyzed meetings using natural language.
        </p>
      </div>

      {/* Search input */}
      <Card>
        <CardContent>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !loading) handleQuery()
                }}
                placeholder="Ask about past meetings..."
                className="h-10 pl-10 text-base"
              />
            </div>

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
              onClick={handleQuery}
              disabled={!question.trim() || loading}
              className="h-10 gap-2 bg-blue-600 px-5 text-white hover:bg-blue-700"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Result */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-blue-500" />
          <span className="ml-3 text-sm text-slate-500">Searching meeting memory...</span>
        </div>
      )}

      {result && !loading && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <MessageSquare className="size-5 text-blue-500" />
                <CardTitle className="text-lg">Answer</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="leading-relaxed text-slate-700 whitespace-pre-wrap">{result.answer}</p>
            </CardContent>
          </Card>

          {result.sources && result.sources.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-slate-600">Sources</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {result.sources.map((src, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm"
                    >
                      <FileText className="mt-0.5 size-4 shrink-0 text-slate-400" />
                      <div>
                        {src.meeting_title && (
                          <span className="font-medium text-slate-800">
                            {src.meeting_title}
                          </span>
                        )}
                        {src.item_type && (
                          <Badge variant="secondary" className="ml-2 text-xs">
                            {src.item_type}
                          </Badge>
                        )}
                        {src.content && (
                          <p className="mt-1 text-slate-600">{src.content}</p>
                        )}
                      </div>
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
          <Search className="mb-4 size-12 text-slate-300" />
          <p className="text-sm text-slate-400">
            Ask a question to search across your meeting history.
          </p>
        </div>
      )}
    </div>
  )
}
