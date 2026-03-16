import { useState, useCallback, useEffect } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Header } from '@/components/layout/Header'
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

function MeetingDetailRoute({ onOpenChat, onPrepareFollowUp, provider }: {
  onOpenChat: (id: string) => void
  onPrepareFollowUp: (agenda: string, participants: string) => void
  provider?: string
}) {
  const { meetingId } = useParams<{ meetingId: string }>()
  const navigate = useNavigate()
  if (!meetingId) return null
  return (
    <MeetingDetail
      meetingId={meetingId}
      onBack={() => navigate('/')}
      onOpenChat={onOpenChat}
      onPrepareFollowUp={onPrepareFollowUp}
      provider={provider}
    />
  )
}

function AppInner() {
  const navigate = useNavigate()
  const location = useLocation()

  const [chatOpen, setChatOpen] = useState(false)
  const [chatContextMeetingId, setChatContextMeetingId] = useState<string | null>(null)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [prepAgendaPreFill, setPrepAgendaPreFill] = useState('')
  const [prepParticipantsPreFill, setPrepParticipantsPreFill] = useState('')
  const [provider, setProvider] = useState<string | undefined>(undefined)

  // Update chat context based on current route
  useEffect(() => {
    const match = location.pathname.match(/^\/meeting\/(.+)$/)
    if (match) {
      setChatContextMeetingId(match[1])
    } else {
      setChatContextMeetingId(null)
    }
  }, [location.pathname])

  const handlePrepareFollowUp = useCallback((agenda: string, participants: string) => {
    setPrepAgendaPreFill(agenda)
    setPrepParticipantsPreFill(participants)
    navigate('/')
  }, [navigate])

  return (
    <div className="relative min-h-screen bg-background">
      {/* Ambient background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute -bottom-40 left-1/4 h-[400px] w-[600px] rounded-full bg-chart-2/10 blur-[100px]" />
      </div>

      {/* Content */}
      <div className="relative z-10">
        <Header
          onChatToggle={() => setChatOpen(!chatOpen)}
          chatOpen={chatOpen}
          provider={provider}
          onProviderChange={setProvider}
        />
        <main className="mx-auto max-w-7xl px-6 py-10">
          <div className="fade-in">
            <Routes>
              <Route path="/" element={
                <Dashboard
                  onUploadClick={() => setUploadModalOpen(true)}
                  onGoLive={() => navigate('/live')}
                  onMeetingClick={(id) => navigate(`/meeting/${id}`)}
                  prepAgendaPreFill={prepAgendaPreFill}
                  prepParticipantsPreFill={prepParticipantsPreFill}
                  onClearPreFill={() => { setPrepAgendaPreFill(''); setPrepParticipantsPreFill('') }}
                  provider={provider}
                />
              } />
              <Route path="/meeting/:meetingId" element={
                <MeetingDetailRoute
                  onOpenChat={(id) => { setChatContextMeetingId(id); setChatOpen(true) }}
                  onPrepareFollowUp={handlePrepareFollowUp}
                  provider={provider}
                />
              } />
              <Route path="/live" element={
                <LiveView onReviewMeeting={(id) => navigate(`/meeting/${id}`)} />
              } />
              <Route path="/history" element={
                <MeetingsView onSelectMeeting={(id) => navigate(`/meeting/${id}`)} />
              } />
              <Route path="/join" element={<JoinView />} />
            </Routes>
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
          navigate(`/meeting/${id}`)
        }}
        provider={provider}
      />

      {/* Upload Modal */}
      <UploadModal
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
        onAnalysisComplete={(meetingId) => {
          setUploadModalOpen(false)
          navigate(`/meeting/${meetingId}`)
        }}
        provider={provider}
      />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
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
