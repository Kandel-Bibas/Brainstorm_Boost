import { useState } from 'react'
import { ThumbsUp, Send, Lightbulb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface Idea {
  id: string
  text: string
  votes: number
}

interface IdeaPanelProps {
  ideas: Idea[]
  onSubmit: (text: string) => void
  onVote: (ideaId: string) => void
}

export function IdeaPanel({ ideas, onSubmit, onVote }: IdeaPanelProps) {
  const [text, setText] = useState('')
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set())

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    setText('')
  }

  const handleVote = (ideaId: string) => {
    if (votedIds.has(ideaId)) return
    setVotedIds((prev) => new Set(prev).add(ideaId))
    onVote(ideaId)
  }

  const sorted = [...ideas].sort((a, b) => b.votes - a.votes)

  return (
    <Card className="glass border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-chart-4/10">
            <Lightbulb className="size-5 text-chart-4" />
          </div>
          <div>
            <CardTitle className="text-base">Idea Board</CardTitle>
            <p className="text-sm text-muted-foreground">Anonymous submissions</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Share an idea anonymously..."
            className="border-border/50 bg-secondary/30 placeholder:text-muted-foreground/60 focus:border-primary/50"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
            }}
          />
          <Button
            onClick={handleSubmit}
            disabled={!text.trim()}
            className="gap-2 rounded-xl bg-chart-4 text-white hover:bg-chart-4/90"
          >
            <Send className="size-4" />
            Submit
          </Button>
        </div>

        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-secondary/50">
              <Lightbulb className="size-6 text-muted-foreground/50" />
            </div>
            <p className="text-muted-foreground">No ideas yet. Be the first!</p>
          </div>
        ) : (
          <ScrollArea className="max-h-64">
            <ul className="space-y-2 pr-4">
              {sorted.map((idea, index) => {
                const hasVoted = votedIds.has(idea.id)
                return (
                  <li
                    key={idea.id}
                    className={cn(
                      'flex items-center justify-between rounded-xl border border-border/50 bg-secondary/30 px-4 py-3 transition-all',
                      index === 0 && ideas.length > 1 && 'border-chart-4/30 bg-chart-4/5'
                    )}
                  >
                    <span className="text-foreground">{idea.text}</span>
                    <button
                      onClick={() => handleVote(idea.id)}
                      disabled={hasVoted}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
                        hasVoted
                          ? 'cursor-default text-primary'
                          : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
                      )}
                    >
                      <ThumbsUp className={cn('size-4', hasVoted && 'fill-current')} />
                      <Badge 
                        variant="secondary" 
                        className={cn(
                          'px-2',
                          hasVoted ? 'bg-primary/10 text-primary' : 'bg-secondary/50'
                        )}
                      >
                        {idea.votes}
                      </Badge>
                    </button>
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
