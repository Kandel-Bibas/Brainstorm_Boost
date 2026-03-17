import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Home, Loader2, MessageCircle, BookOpen, Download, AlertCircle, Database, DatabaseZap, GitMerge } from 'lucide-react'
import { toast } from 'sonner'
import { api, type AiOutput } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ReviewView } from '@/components/review/ReviewView'
import { TranscriptPanel } from '@/components/meeting/TranscriptPanel'
import { MeetingTimeline, type TimelineItem } from '@/components/meeting/MeetingTimeline'

interface MeetingDetailProps {
  meetingId: string
  onBack: () => void
  onPrepareFollowUp: (agenda: string, participants: string) => void
  provider?: string
}

export function MeetingDetail({ meetingId, onBack, onPrepareFollowUp }: MeetingDetailProps) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [meetingTitle, setMeetingTitle] = useState('')
  const [aiOutput, setAiOutput] = useState<AiOutput | null>(null)
  const [approved, setApproved] = useState(false)
  const [exportLinks, setExportLinks] = useState<{ md?: string; json?: string }>({})
  const [indexed, setIndexed] = useState<boolean | null>(null)
  const [indexing, setIndexing] = useState(false)
  const [graphData, setGraphData] = useState<any>(null)
  const [reindexing, setReindexing] = useState(false)
  const [transcript, setTranscript] = useState<string>('')
  const [highlightedRange, setHighlightedRange] = useState<{ start: number; end: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchMeeting() {
      try {
        setLoading(true)
        setError(null)

        // Parallel fetch: meeting detail, transcript, graph
        const [detail, transcriptResult] = await Promise.all([
          api.getMeeting(meetingId),
          api.getMeetingTranscript(meetingId).catch(() => ({ transcript: '' })),
        ])

        if (cancelled) return

        setMeetingTitle(detail.title ?? 'Meeting')
        setTranscript(transcriptResult.transcript ?? '')

        const output = detail.verified_output_json ?? detail.ai_output_json
        if (output) {
          setAiOutput(output)
          if (detail.verified_output_json) {
            setApproved(true)
          }
        }

        // Non-critical: memory status + graph (parallel)
        const [memStatus, graph] = await Promise.all([
          api.getMemoryStatus(meetingId).catch(() => null),
          api.getMeetingGraph(meetingId).catch(() => null),
        ])

        if (cancelled) return
        if (memStatus) setIndexed(memStatus.indexed)
        if (graph) setGraphData(graph)
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

  // Build timeline items from graphData
  const timelineItems = useMemo<TimelineItem[]>(() => {
    if (!graphData?.nodes || !transcript) return []
    const tLen = transcript.length
    if (tLen === 0) return []

    return graphData.nodes
      .filter((n: any) => ['decision', 'action_item', 'risk'].includes(n.node_type))
      .map((n: any) => {
        const sourceStart = n.properties?.source_start ?? 0
        return {
          type: n.node_type as TimelineItem['type'],
          id: n.id,
          position: Math.max(0, Math.min(1, sourceStart / tLen)),
          label: n.content,
        }
      })
      .sort((a: TimelineItem, b: TimelineItem) => a.position - b.position)
  }, [graphData, transcript])

  const handleApprove = (exports: { md?: string; json?: string }) => {
    setApproved(true)
    setExportLinks(exports)
  }

  const handleReindex = async () => {
    setReindexing(true)
    try {
      await api.reindexMeeting(meetingId)
      const graph = await api.getMeetingGraph(meetingId)
      setGraphData(graph)
      toast.success('Knowledge graph built successfully')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reindex meeting')
    } finally {
      setReindexing(false)
    }
  }

  const handleToggleMemory = async () => {
    setIndexing(true)
    try {
      if (indexed) {
        await api.removeMeetingFromMemory(meetingId)
        setIndexed(false)
        toast.success('Removed from knowledge base')
      } else {
        await api.indexMeeting(meetingId)
        setIndexed(true)
        toast.success('Added to knowledge base')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update knowledge base')
    } finally {
      setIndexing(false)
    }
  }

  const handleTimelineClick = (_id: string, position: number) => {
    const start = Math.floor(position * transcript.length)
    const end = Math.min(start + 200, transcript.length)
    setHighlightedRange({ start, end })
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
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Breadcrumb + controls */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground">
          <button
            onClick={onBack}
            className="flex items-center gap-1 transition-colors hover:text-foreground"
          >
            <Home className="size-4" />
            Home
          </button>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground font-medium">{meetingTitle}</span>
        </nav>

        <div className="flex items-center gap-2">
          {aiOutput && graphData && graphData.nodes?.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReindex}
              disabled={reindexing}
              className="gap-2 rounded-xl border-border/50 text-xs hover:bg-chart-2/10 hover:text-chart-2 hover:border-chart-2/30"
            >
              {reindexing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <GitMerge className="size-3.5" />
              )}
              Reindex
            </Button>
          )}
          {aiOutput && indexed !== null && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleMemory}
              disabled={indexing}
              className={`gap-2 rounded-xl border-border/50 text-xs ${
                indexed
                  ? 'bg-primary/10 text-primary hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30'
                  : 'hover:bg-primary/10 hover:text-primary hover:border-primary/30'
              }`}
            >
              {indexing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : indexed ? (
                <DatabaseZap className="size-3.5" />
              ) : (
                <Database className="size-3.5" />
              )}
              {indexed ? 'In KB' : 'Add to KB'}
            </Button>
          )}
        </div>
      </div>

      {/* No AI output state */}
      {!aiOutput && (
        <div className="flex-1 flex items-center justify-center">
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
        </div>
      )}

      {/* Main content with timeline + split pane */}
      {aiOutput && (
        <>
          {/* Timeline */}
          {timelineItems.length > 0 && (
            <div className="px-4 py-2 border-b border-border/30">
              <MeetingTimeline
                items={timelineItems}
                onItemClick={handleTimelineClick}
              />
            </div>
          )}

          {/* Split pane */}
          <div className="flex flex-1 min-h-0">
            {/* Left panel — Transcript */}
            {transcript && (
              <div className="w-[40%] border-r border-border/50 flex flex-col min-h-0">
                <TranscriptPanel
                  transcript={transcript}
                  highlightedRange={highlightedRange}
                  onClearHighlight={() => setHighlightedRange(null)}
                />
              </div>
            )}

            {/* Right panel — Analysis */}
            <div className={transcript ? 'w-[60%] overflow-y-auto min-h-0' : 'w-full overflow-y-auto min-h-0'}>
              <ReviewView
                meetingId={meetingId}
                aiOutput={aiOutput}
                onApprove={handleApprove}
                graphData={graphData}
                onHighlightTranscript={(range) => {
                  if (range && (range as any).searchText) {
                    // Source quote click — search transcript for the text
                    const searchText = (range as any).searchText as string
                    if (transcript) {
                      const lower = transcript.toLowerCase()
                      // Try exact match first
                      let idx = lower.indexOf(searchText.toLowerCase())
                      if (idx === -1) {
                        // Try first 5 words as a window
                        const words = searchText.toLowerCase().split(/\s+/)
                        if (words.length >= 5) {
                          const window = words.slice(0, 5).join(' ')
                          idx = lower.indexOf(window)
                        }
                      }
                      if (idx !== -1) {
                        setHighlightedRange({ start: idx, end: idx + searchText.length })
                      }
                    }
                  } else {
                    setHighlightedRange(range)
                  }
                }}
              />
            </div>
          </div>

          {/* Post-approval actions */}
          {approved && (
            <div className="border-t border-border/30 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
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
                  size="sm"
                  onClick={() => navigate(`/chat?meeting=${meetingId}`)}
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
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
