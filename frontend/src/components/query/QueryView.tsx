import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Loader2, MessageSquare, FileText, Sparkles, Send } from 'lucide-react'
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
import { cn } from '@/lib/utils'

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

  const suggestedQueries = [
    'What decisions were made about the product roadmap?',
    'Who is responsible for the marketing campaign?',
    'What are the open action items from last week?',
    'Were there any risks discussed recently?',
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary ring-1 ring-primary/20">
          <Sparkles className="size-4" />
          AI-Powered Search
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          Ask anything about your meetings
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-lg text-muted-foreground">
          Search across all your analyzed meetings using natural language.
        </p>
      </div>

      {/* Search input */}
      <Card className="glass border-border/50 overflow-hidden">
        <CardContent className="p-6">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !loading) handleQuery()
                }}
                placeholder="Ask about past meetings..."
                className="h-14 pl-12 pr-4 text-lg border-border/50 bg-secondary/30 placeholder:text-muted-foreground/60 focus:border-primary/50"
              />
            </div>

            {providers.length > 0 && (
              <Select value={provider} onValueChange={(v) => setProvider(v ?? undefined)}>
                <SelectTrigger className="h-14 w-44 border-border/50 bg-secondary/50">
                  <SelectValue placeholder="AI Provider" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
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
              className={cn(
                'h-14 gap-2 rounded-xl px-6',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                question.trim() && !loading && 'glow-sm'
              )}
            >
              {loading ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Send className="size-5" />
              )}
              Search
            </Button>
          </div>

          {/* Suggested queries */}
          {!result && !loading && (
            <div className="mt-6">
              <p className="mb-3 text-sm font-medium text-muted-foreground">Try asking</p>
              <div className="flex flex-wrap gap-2">
                {suggestedQueries.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setQuestion(q)}
                    className="rounded-full border border-border/50 bg-secondary/30 px-4 py-2 text-sm text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl" />
            <Loader2 className="relative size-10 animate-spin text-primary" />
          </div>
          <span className="mt-4 text-muted-foreground">Searching meeting memory...</span>
        </div>
      )}

      {/* Result */}
      {result && !loading && (
        <div className="space-y-6 fade-in">
          <Card className="glass border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                  <MessageSquare className="size-5 text-primary" />
                </div>
                <CardTitle className="text-xl">Answer</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-lg leading-relaxed text-foreground/90 whitespace-pre-wrap">{result.answer}</p>
            </CardContent>
          </Card>

          {result.sources && result.sources.length > 0 && (
            <Card className="glass border-border/50">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-secondary">
                    <FileText className="size-5 text-muted-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Sources</CardTitle>
                    <p className="text-sm text-muted-foreground">{result.sources.length} references found</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {result.sources.map((src, i) => (
                    <li
                      key={i}
                      className="rounded-xl border border-border/50 bg-secondary/30 p-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-sm font-medium text-muted-foreground">
                          {i + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {src.meeting_title && (
                              <span className="font-medium text-foreground">
                                {src.meeting_title}
                              </span>
                            )}
                            {src.item_type && (
                              <Badge variant="secondary" className="bg-secondary/50 text-xs">
                                {src.item_type}
                              </Badge>
                            )}
                          </div>
                          {src.content && (
                            <p className="mt-2 text-sm text-muted-foreground">{src.content}</p>
                          )}
                        </div>
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
          <div className="mb-6 flex size-20 items-center justify-center rounded-2xl bg-secondary/50 ring-1 ring-border">
            <Search className="size-9 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Ready to search</h3>
          <p className="mt-2 max-w-md text-muted-foreground">
            Ask a question to search across your entire meeting history.
          </p>
        </div>
      )}
    </div>
  )
}
