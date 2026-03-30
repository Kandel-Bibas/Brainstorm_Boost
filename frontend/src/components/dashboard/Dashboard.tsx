import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  ChevronDown,
  List,
  Clock,
  CheckCircle2,
  AlertCircle,
  Filter,
  ArrowUpDown,
  MessageSquare,
  Link,
  MoreVertical,
  Upload,
  Loader2,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Meeting, AiOutput } from '@/lib/api'

interface DashboardProps {
  onUploadClick: () => void
  onGoLive: () => void
  onMeetingClick: (meetingId: string) => void
  prepAgendaPreFill?: string
  prepParticipantsPreFill?: string
  onClearPreFill?: () => void
  provider?: string
}

type TabKey = 'all' | 'recent' | 'approved' | 'needs_review'

const TABS: { key: TabKey; label: string; icon: typeof List }[] = [
  { key: 'all', label: 'All', icon: List },
  { key: 'recent', label: 'Recent', icon: Clock },
  { key: 'approved', label: 'Approved', icon: CheckCircle2 },
  { key: 'needs_review', label: 'Needs Review', icon: AlertCircle },
]

const AVATAR_COLORS = [
  'bg-[var(--bb-status-blue)] text-white',
  'bg-[var(--bb-status-green)] text-white',
  'bg-[var(--bb-status-orange)] text-white',
  'bg-[var(--bb-status-red,#e2445c)] text-white',
  'bg-[var(--bb-status-purple,#a25ddc)] text-white',
]

type MeetingWithAi = Meeting & { ai_output_json?: AiOutput }

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function getStatusConfig(status: string) {
  switch (status) {
    case 'approved':
      return {
        label: 'Approved',
        barColor: 'bg-[var(--bb-status-green)]',
        pillBg: 'bg-[var(--bb-status-green-bg)]',
        pillText: 'text-[var(--bb-status-green-text)]',
      }
    case 'analyzed':
      return {
        label: 'Analyzed',
        barColor: 'bg-[var(--bb-status-orange)]',
        pillBg: 'bg-[var(--bb-status-orange-bg)]',
        pillText: 'text-[var(--bb-status-orange-text)]',
      }
    default:
      return {
        label: 'Uploaded',
        barColor: 'bg-[var(--bb-status-blue)]',
        pillBg: 'bg-[var(--bb-status-blue-bg)]',
        pillText: 'text-[var(--bb-status-blue-text)]',
      }
  }
}

function MeetingRowMenu({ meetingId, onDeleted }: { meetingId: string; onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleDelete = async () => {
    if (!confirm('Delete this meeting? This cannot be undone.')) return
    try {
      await api.deleteMeeting(meetingId)
      toast.success('Meeting deleted')
      onDeleted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    }
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <div
        role="button"
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="flex-shrink-0 rounded p-1 text-[var(--bb-text-muted)] transition-colors hover:bg-[var(--bb-border-light)] hover:text-[var(--bb-text-secondary)]"
      >
        <MoreVertical className="size-4" />
      </div>
      {open && (
        <div
          className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-lg border bg-[var(--bb-surface)] py-1 shadow-lg"
          style={{ borderColor: 'var(--bb-border)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={handleDelete}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
          >
            <Trash2 className="size-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

export function Dashboard({
  onMeetingClick,
}: DashboardProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('recent')
  const [searchParams] = useSearchParams()
  const searchQuery = searchParams.get('q') || ''
  const queryClient = useQueryClient()

  const { data: meetings, isLoading } = useQuery({
    queryKey: ['meetings'],
    queryFn: api.getMeetings,
  })

  const filteredMeetings = useMemo(() => {
    if (!meetings) return []
    let typed = meetings as MeetingWithAi[]

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      typed = typed.filter((m) =>
        m.title.toLowerCase().includes(q) ||
        m.ai_output_json?.meeting_metadata?.participants?.some((p: string) => p.toLowerCase().includes(q))
      )
    }

    switch (activeTab) {
      case 'recent':
        return [...typed]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 20)
      case 'approved':
        return typed.filter((m) => m.status === 'approved')
      case 'needs_review':
        return typed.filter((m) => m.status === 'analyzed' || m.status === 'uploaded')
      default:
        return typed
    }
  }, [meetings, activeTab, searchQuery])

  return (
    <div className="px-7 py-6">
      {/* Page header */}
      <div className="mb-5 flex items-center gap-1.5">
        <h1 className="text-xl font-semibold text-[var(--bb-text-primary)]">
          All Meetings
        </h1>
        <ChevronDown className="size-4 text-[var(--bb-text-muted)]" />
      </div>

      {/* Tab row */}
      <div className="mb-4 flex items-center gap-0 border-b border-[var(--bb-border)]">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'border-b-2 border-[var(--bb-accent)] font-medium text-[var(--bb-text-primary)]'
                  : 'border-b-2 border-transparent text-[var(--bb-text-secondary)] hover:text-[var(--bb-text-primary)]'
              }`}
            >
              <Icon className="size-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 rounded-md border border-[var(--bb-border)] px-2.5 py-1.5 text-xs text-[var(--bb-text-secondary)] transition-colors hover:bg-[var(--bb-border-light)]">
            <Filter className="size-3" />
            Filter
          </button>
          <button className="flex items-center gap-1.5 rounded-md border border-[var(--bb-border)] px-2.5 py-1.5 text-xs text-[var(--bb-text-secondary)] transition-colors hover:bg-[var(--bb-border-light)]">
            <ArrowUpDown className="size-3" />
            Sort
          </button>
        </div>
        <span className="text-xs text-[var(--bb-text-muted)]">
          {filteredMeetings.length} meeting{filteredMeetings.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-[var(--bb-text-muted)]" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filteredMeetings.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--bb-border)] bg-[var(--bb-surface)] py-16">
          <Upload className="mb-3 size-8 text-[var(--bb-text-muted)]" />
          <p className="text-sm text-[var(--bb-text-muted)]">No meetings yet</p>
        </div>
      )}

      {/* Meeting list */}
      {!isLoading && filteredMeetings.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[var(--bb-border)] bg-[var(--bb-surface)]">
          {filteredMeetings.map((meeting, idx) => {
            const m = meeting as MeetingWithAi
            const aiOutput = m.ai_output_json
            const participants = aiOutput?.meeting_metadata?.participants ?? []
            const decisionCount = aiOutput?.decisions?.length ?? 0
            const actionCount = aiOutput?.action_items?.length ?? 0
            const duration = aiOutput?.meeting_metadata?.duration_estimate ?? null
            const config = getStatusConfig(m.status)

            return (
              <button
                key={m.id}
                onClick={() => onMeetingClick(m.id)}
                className={`flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-[var(--bb-page-bg)] ${
                  idx !== 0 ? 'border-t border-[var(--bb-border-light)]' : ''
                }`}
              >
                {/* Accent bar */}
                <div
                  className={`h-8 w-[3px] flex-shrink-0 rounded-full ${config.barColor}`}
                />

                {/* Title + meta */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--bb-text-primary)]">
                    {m.title}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--bb-text-muted)]">
                    {formatDate(m.created_at)}
                    {duration ? ` \u00B7 ${duration}` : ''}
                  </p>
                </div>

                {/* Stats */}
                <div className="hidden items-center gap-3 sm:flex">
                  {decisionCount > 0 && (
                    <span className="flex items-center gap-1 text-xs text-[var(--bb-text-muted)]">
                      <MessageSquare className="size-3" />
                      {decisionCount}
                    </span>
                  )}
                  {actionCount > 0 && (
                    <span className="flex items-center gap-1 text-xs text-[var(--bb-text-muted)]">
                      <Link className="size-3" />
                      {actionCount}
                    </span>
                  )}
                </div>

                {/* Avatar stack */}
                {participants.length > 0 && (
                  <div className="hidden items-center lg:flex">
                    {participants.slice(0, 4).map((name, i) => (
                      <div
                        key={name}
                        title={name}
                        className={`flex size-[26px] items-center justify-center rounded-full text-[10px] font-medium ring-2 ring-[var(--bb-surface)] ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}
                        style={{ marginLeft: i > 0 ? '-7px' : '0' }}
                      >
                        {getInitials(name)}
                      </div>
                    ))}
                    {participants.length > 4 && (
                      <div
                        className="flex size-[26px] items-center justify-center rounded-full bg-[var(--bb-border)] text-[10px] font-medium text-[var(--bb-text-secondary)] ring-2 ring-[var(--bb-surface)]"
                        style={{ marginLeft: '-7px' }}
                      >
                        +{participants.length - 4}
                      </div>
                    )}
                  </div>
                )}

                {/* Status pill */}
                <span
                  className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.pillBg} ${config.pillText}`}
                >
                  {config.label}
                </span>

                {/* Three-dot menu */}
                <MeetingRowMenu
                  meetingId={m.id}
                  onDeleted={() => queryClient.invalidateQueries({ queryKey: ['meetings'] })}
                />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
