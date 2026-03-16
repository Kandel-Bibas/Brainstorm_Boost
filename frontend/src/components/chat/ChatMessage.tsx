import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  sources?: Array<{ meeting_id: string; meeting_title: string; item_type: string }>
  onSourceClick?: (meetingId: string) => void
}

export function ChatMessage({ role, content, sources, onSourceClick }: ChatMessageProps) {
  const isUser = role === 'user'

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-primary/10 text-foreground'
            : 'glass text-foreground'
        )}
      >
        <p className="whitespace-pre-wrap">{content}</p>

        {!isUser && sources && sources.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {sources.map((source, i) => (
              <button
                key={i}
                onClick={() => onSourceClick?.(source.meeting_id)}
                className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-secondary/50 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <Badge variant="secondary" className="h-auto bg-transparent p-0 text-xs">
                  {source.meeting_title} - {source.item_type}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
