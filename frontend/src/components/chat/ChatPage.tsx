import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Send, MessageCircle, FileText } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ChatMessage } from '@/components/chat/ChatMessage'
import { cn } from '@/lib/utils'

interface ChatPageProps {
  provider?: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: Array<{ meeting_id: string; meeting_title: string; content: string; item_type: string }>
}

interface Source {
  meeting_id: string
  meeting_title: string
  content: string
  item_type: string
}

const SUGGESTED_PROMPTS = [
  'What action items are still open?',
  'Summarize the last meeting',
  'Who has the most open tasks?',
  'What decisions were made recently?',
  'Compare discussions across meetings',
]

export function ChatPage({ provider }: ChatPageProps) {
  const navigate = useNavigate()
  const location = useLocation()

  const searchParams = new URLSearchParams(location.search)
  const meetingParam = searchParams.get('meeting')

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>(undefined)
  const [contextMeetingId] = useState<string | null>(meetingParam)
  const [latestSources, setLatestSources] = useState<Source[]>([])

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return

    const userMsg: Message = { role: 'user', content: text.trim() }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const result = await api.sendChatMessage(
        text.trim(),
        sessionId,
        contextMeetingId ?? undefined,
        provider
      )
      setSessionId(result.session_id)
      setLatestSources(result.sources ?? [])
      const assistantMsg: Message = {
        role: 'assistant',
        content: result.response,
        sources: result.sources,
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      const errorMsg: Message = {
        role: 'assistant',
        content: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div className="flex h-[calc(100vh-5rem)] gap-0 overflow-hidden rounded-2xl border border-border/50">
      {/* Left: Conversation (60%) */}
      <div className="flex w-[60%] flex-col border-r border-border/50">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border/30 px-6 py-4">
          <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10">
            <MessageCircle className="size-4 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">Chat</h2>
            {contextMeetingId && (
              <p className="text-xs text-muted-foreground">Scoped to meeting context</p>
            )}
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 ? (
            <div className="space-y-6">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  Ask anything about your meetings, or pick a suggestion below.
                </p>
              </div>
              <div className="grid gap-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    disabled={loading}
                    className={cn(
                      'w-full rounded-xl border border-border/50 bg-secondary/20 px-4 py-3 text-left text-sm text-foreground',
                      'transition-all duration-150 hover:border-primary/40 hover:bg-primary/5 hover:text-foreground',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                      'disabled:cursor-not-allowed disabled:opacity-50'
                    )}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, i) => (
                <ChatMessage
                  key={i}
                  role={msg.role}
                  content={msg.content}
                  sources={msg.sources}
                  onSourceClick={(id) => navigate(`/meeting/${id}`)}
                />
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="glass rounded-2xl px-4 py-3 text-sm text-muted-foreground">
                    <span className="inline-flex gap-1">
                      <span className="animate-bounce [animation-delay:0ms]">.</span>
                      <span className="animate-bounce [animation-delay:150ms]">.</span>
                      <span className="animate-bounce [animation-delay:300ms]">.</span>
                    </span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="border-t border-border/30 px-6 py-4">
          <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-secondary/20 px-4 py-2 focus-within:border-primary/50 focus-within:bg-primary/5 transition-all">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder="Ask about your meetings…"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
            />
            <Button
              size="icon"
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              className="size-7 shrink-0 rounded-lg bg-primary/90 text-primary-foreground hover:bg-primary disabled:opacity-40"
            >
              <Send className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Right: Source context (40%) */}
      <div className="flex w-[40%] flex-col">
        <div className="border-b border-border/30 px-6 py-4">
          <h2 className="font-semibold text-foreground">Source Context</h2>
          <p className="text-xs text-muted-foreground">References from AI responses</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {latestSources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-secondary/50 ring-1 ring-border">
                <FileText className="size-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">
                Sources will appear here when the AI responds
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {latestSources.map((source, i) => (
                <button
                  key={i}
                  onClick={() => navigate(`/meeting/${source.meeting_id}`)}
                  className={cn(
                    'w-full rounded-xl border border-border/50 bg-secondary/20 p-4 text-left',
                    'transition-all duration-150 hover:border-primary/40 hover:bg-primary/5',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'
                  )}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {source.meeting_title}
                    </p>
                    <span className="shrink-0 rounded-full bg-secondary/70 px-2 py-0.5 text-xs text-muted-foreground">
                      {source.item_type}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                    {source.content}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
