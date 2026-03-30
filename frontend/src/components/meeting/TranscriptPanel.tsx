import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface TranscriptPanelProps {
  transcript: string
  highlightedRange?: { start: number; end: number } | null
  onClearHighlight?: () => void
  initialSearch?: string
}

// Detect speaker lines like "Alice:" or "Speaker 1:" at start of line
const SPEAKER_RE = /^([A-Z][A-Za-z0-9 _-]+):/gm

function formatTranscript(
  text: string,
  highlightedRange: { start: number; end: number } | null | undefined,
  searchQuery: string
) {
  const segments: Array<{
    text: string
    isHighlighted: boolean
    isSpeaker: boolean
    isSearchMatch: boolean
  }> = []

  // Split into characters and mark regions
  const chars = Array.from(text)
  const flags = chars.map(() => ({
    highlighted: false,
    speaker: false,
    searchMatch: false,
  }))

  // Mark highlighted range
  if (highlightedRange) {
    for (let i = highlightedRange.start; i < highlightedRange.end && i < chars.length; i++) {
      flags[i].highlighted = true
    }
  }

  // Mark speaker names
  let match: RegExpExecArray | null
  const speakerRe = new RegExp(SPEAKER_RE.source, 'gm')
  while ((match = speakerRe.exec(text)) !== null) {
    for (let i = match.index; i < match.index + match[0].length && i < chars.length; i++) {
      flags[i].speaker = true
    }
  }

  // Mark search matches
  if (searchQuery.length >= 2) {
    const lower = text.toLowerCase()
    const q = searchQuery.toLowerCase()
    let pos = 0
    while ((pos = lower.indexOf(q, pos)) !== -1) {
      for (let i = pos; i < pos + q.length; i++) {
        flags[i].searchMatch = true
      }
      pos += 1
    }
  }

  // Build segments by grouping consecutive chars with same flags
  let i = 0
  while (i < chars.length) {
    const f = flags[i]
    let j = i + 1
    while (
      j < chars.length &&
      flags[j].highlighted === f.highlighted &&
      flags[j].speaker === f.speaker &&
      flags[j].searchMatch === f.searchMatch
    ) {
      j++
    }
    segments.push({
      text: chars.slice(i, j).join(''),
      isHighlighted: f.highlighted,
      isSpeaker: f.speaker,
      isSearchMatch: f.searchMatch,
    })
    i = j
  }

  return segments
}

export function TranscriptPanel({
  transcript,
  highlightedRange,
  onClearHighlight,
  initialSearch,
}: TranscriptPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')

  // Sync external search (fallback for items without source_start/end)
  useEffect(() => {
    if (initialSearch) {
      setSearchQuery(initialSearch)
    }
  }, [initialSearch])
  const highlightRef = useRef<HTMLSpanElement>(null)
  const searchMatchRef = useRef<HTMLSpanElement>(null)

  // Auto-scroll to highlighted range (from source quote clicks)
  useEffect(() => {
    if (highlightedRange) {
      const timer = setTimeout(() => {
        if (highlightRef.current) {
          highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [highlightedRange])

  // Auto-scroll to first search match
  useEffect(() => {
    if (searchQuery.length >= 2) {
      const timer = setTimeout(() => {
        if (searchMatchRef.current) {
          searchMatchRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [searchQuery])

  const segments = useMemo(
    () => formatTranscript(transcript, highlightedRange, searchQuery),
    [transcript, highlightedRange, searchQuery]
  )

  let assignedHighlightRef = false
  let assignedSearchRef = false

  return (
    <div className="flex h-full flex-col">
      {/* Search bar */}
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <Search className="size-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search transcript..."
          className="h-7 border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
        />
        {(searchQuery || highlightedRange) && (
          <Button
            variant="ghost"
            size="sm"
            className="size-6 p-0"
            onClick={() => {
              setSearchQuery('')
              onClearHighlight?.()
            }}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Transcript content */}
      <ScrollArea className="flex-1 overflow-auto">
        <div className="p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap text-foreground/80">
          {segments.map((seg, idx) => {
            // Assign refs to first highlighted / search match segments
            let ref: React.Ref<HTMLSpanElement> | undefined
            if (seg.isHighlighted && !assignedHighlightRef) {
              ref = highlightRef
              assignedHighlightRef = true
            } else if (seg.isSearchMatch && !assignedSearchRef) {
              ref = searchMatchRef
              assignedSearchRef = true
            }

            return (
              <span
                key={idx}
                ref={ref}
                className={cn(
                  seg.isSpeaker && 'font-bold text-primary',
                  seg.isHighlighted && 'bg-primary/20 border-l-2 border-primary',
                  seg.isSearchMatch && 'bg-chart-4/30 rounded-sm'
                )}
              >
                {seg.text}
              </span>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
