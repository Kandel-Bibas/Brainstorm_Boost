import { useState } from 'react'
import { ThumbsUp, Send, Lightbulb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

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
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Lightbulb className="size-5 text-amber-500" />
          <CardTitle className="text-base">Idea Board</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Submit an idea anonymously..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
            }}
          />
          <Button
            onClick={handleSubmit}
            disabled={!text.trim()}
            size="sm"
            className="gap-1.5 bg-amber-600 text-white hover:bg-amber-700"
          >
            <Send className="size-3.5" />
            Submit
          </Button>
        </div>

        {sorted.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            No ideas yet. Be the first!
          </p>
        ) : (
          <ScrollArea className="max-h-64">
            <ul className="space-y-2">
              {sorted.map((idea) => {
                const hasVoted = votedIds.has(idea.id)
                return (
                  <li
                    key={idea.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                  >
                    <span className="text-sm text-slate-700">{idea.text}</span>
                    <button
                      onClick={() => handleVote(idea.id)}
                      disabled={hasVoted}
                      className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                        hasVoted
                          ? 'cursor-default text-blue-400'
                          : 'text-slate-400 hover:bg-blue-50 hover:text-blue-600'
                      }`}
                    >
                      <ThumbsUp className="size-3.5" />
                      {idea.votes}
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
