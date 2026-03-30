import { useState, useCallback } from 'react'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { MeetingDetail } from '@/components/meeting/MeetingDetail'
import { LiveView } from '@/components/live/LiveView'
import { JoinView } from '@/components/live/JoinView'
import { UploadModal } from '@/components/upload/UploadModal'
import { ChatPage } from '@/components/chat/ChatPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

function MeetingDetailRoute({ onPrepareFollowUp, provider }: {
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
      onPrepareFollowUp={onPrepareFollowUp}
      provider={provider}
    />
  )
}

function AppInner() {
  const navigate = useNavigate()

  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [prepAgendaPreFill, setPrepAgendaPreFill] = useState('')
  const [prepParticipantsPreFill, setPrepParticipantsPreFill] = useState('')
  const [provider, setProvider] = useState<string | undefined>(undefined)

  const handlePrepareFollowUp = useCallback((agenda: string, participants: string) => {
    setPrepAgendaPreFill(agenda)
    setPrepParticipantsPreFill(participants)
    navigate('/')
  }, [navigate])

  return (
    <div className="flex h-screen bg-[var(--bb-page-bg)]">
      {/* Sidebar */}
      <Sidebar provider={provider} onProviderChange={setProvider} />

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <Header
          provider={provider}
          onProviderChange={setProvider}
          onUploadClick={() => setUploadModalOpen(true)}
        />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
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
                  onPrepareFollowUp={handlePrepareFollowUp}
                  provider={provider}
                />
              } />
              <Route path="/live" element={
                <LiveView onReviewMeeting={(id) => navigate(`/meeting/${id}`)} />
              } />
              <Route path="/join" element={<JoinView />} />
              <Route path="/chat" element={<ChatPage provider={provider} />} />
            </Routes>
          </div>
        </main>
      </div>

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
      />
    </QueryClientProvider>
  )
}
