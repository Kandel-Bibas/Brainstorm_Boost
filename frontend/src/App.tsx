import { useState, useCallback, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { Header, type View } from '@/components/layout/Header'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { MeetingDetail } from '@/components/meeting/MeetingDetail'
import { MeetingsView } from '@/components/meetings/MeetingsView'
import { LiveView } from '@/components/live/LiveView'
import { JoinView } from '@/components/live/JoinView'
import { UploadModal } from '@/components/upload/UploadModal'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { ChatButton } from '@/components/chat/ChatButton'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

export default function App() {
  const [view, setView] = useState<View>('dashboard')
  const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatContextMeetingId, setChatContextMeetingId] = useState<string | null>(null)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [prepAgendaPreFill, setPrepAgendaPreFill] = useState('')
  const [prepParticipantsPreFill, setPrepParticipantsPreFill] = useState('')
  const [isJoinPage, setIsJoinPage] = useState(false)

  useEffect(() => {
    if (window.location.pathname.startsWith('/join')) {
      setIsJoinPage(true)
    }
  }, [])

  const navigateToMeeting = useCallback((meetingId: string) => {
    setCurrentMeetingId(meetingId)
    setChatContextMeetingId(meetingId)
    setView('meeting-detail')
  }, [])

  const navigateToDashboard = useCallback((prepAgenda?: string, prepParticipants?: string) => {
    setView('dashboard')
    setChatContextMeetingId(null)
    setCurrentMeetingId(null)
    if (prepAgenda) setPrepAgendaPreFill(prepAgenda)
    if (prepParticipants) setPrepParticipantsPreFill(prepParticipants)
  }, [])

  if (isJoinPage) {
    return (
      <QueryClientProvider client={queryClient}>
        <JoinView />
        <Toaster
          position="bottom-right"
          richColors
          toastOptions={{
            className: 'bg-card border-border text-foreground',
          }}
        />
      </QueryClientProvider>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="relative min-h-screen bg-background">
        {/* Ambient background glow */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
          <div className="absolute -bottom-40 left-1/4 h-[400px] w-[600px] rounded-full bg-chart-2/10 blur-[100px]" />
        </div>

        {/* Content */}
        <div className="relative z-10">
          <Header
            currentView={view}
            onViewChange={setView}
            onChatToggle={() => setChatOpen(!chatOpen)}
            chatOpen={chatOpen}
          />
          <main className="mx-auto max-w-7xl px-6 py-10">
            <div className="fade-in">
              {view === 'dashboard' && (
                <Dashboard
                  onUploadClick={() => setUploadModalOpen(true)}
                  onGoLive={() => setView('live')}
                  onMeetingClick={navigateToMeeting}
                  prepAgendaPreFill={prepAgendaPreFill}
                  prepParticipantsPreFill={prepParticipantsPreFill}
                  onClearPreFill={() => {
                    setPrepAgendaPreFill('')
                    setPrepParticipantsPreFill('')
                  }}
                />
              )}
              {view === 'meeting-detail' && currentMeetingId && (
                <MeetingDetail
                  meetingId={currentMeetingId}
                  onBack={() => navigateToDashboard()}
                  onOpenChat={(id) => {
                    setChatContextMeetingId(id)
                    setChatOpen(true)
                  }}
                  onPrepareFollowUp={(agenda, participants) =>
                    navigateToDashboard(agenda, participants)
                  }
                />
              )}
              {view === 'live' && (
                <LiveView onReviewMeeting={navigateToMeeting} />
              )}
              {view === 'history' && (
                <MeetingsView onSelectMeeting={(id) => navigateToMeeting(id)} />
              )}
            </div>
          </main>
        </div>

        {/* Chat */}
        <ChatButton onClick={() => setChatOpen(!chatOpen)} isOpen={chatOpen} />
        <ChatPanel
          isOpen={chatOpen}
          onClose={() => setChatOpen(false)}
          contextMeetingId={chatContextMeetingId}
          onNavigateToMeeting={(id) => {
            setChatOpen(false)
            navigateToMeeting(id)
          }}
        />

        {/* Upload Modal */}
        <UploadModal
          open={uploadModalOpen}
          onOpenChange={setUploadModalOpen}
          onAnalysisComplete={(meetingId) => {
            setUploadModalOpen(false)
            navigateToMeeting(meetingId)
          }}
        />
      </div>
      <Toaster
        position="bottom-right"
        richColors
        toastOptions={{
          className: 'bg-card border-border text-foreground',
        }}
      />
    </QueryClientProvider>
  )
}
