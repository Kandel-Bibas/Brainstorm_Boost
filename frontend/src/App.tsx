import { useState, useCallback, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { Header, type View } from '@/components/layout/Header'
import { UploadView } from '@/components/upload/UploadView'
import { ReviewView } from '@/components/review/ReviewView'
import { QueryView } from '@/components/query/QueryView'
import { MeetingsView } from '@/components/meetings/MeetingsView'
import { PrepView } from '@/components/prep/PrepView'
import { LiveView } from '@/components/live/LiveView'
import { JoinView } from '@/components/live/JoinView'
import type { AiOutput } from '@/lib/api'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

export default function App() {
  const [view, setView] = useState<View>('upload')
  const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null)
  const [currentAiOutput, setCurrentAiOutput] = useState<AiOutput | null>(null)
  const [isJoinPage, setIsJoinPage] = useState(false)

  useEffect(() => {
    if (window.location.pathname.startsWith('/join')) {
      setIsJoinPage(true)
    }
  }, [])

  const handleAnalysisComplete = useCallback((meetingId: string, aiOutput: AiOutput) => {
    setCurrentMeetingId(meetingId)
    setCurrentAiOutput(aiOutput)
    setView('review')
  }, [])

  const handleSelectMeeting = useCallback((meetingId: string, aiOutput: AiOutput) => {
    setCurrentMeetingId(meetingId)
    setCurrentAiOutput(aiOutput)
    setView('review')
  }, [])

  const hasReview = currentMeetingId !== null && currentAiOutput !== null

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
          <Header currentView={view} onViewChange={setView} hasReview={hasReview} />
          <main className="mx-auto max-w-7xl px-6 py-10">
            <div className="fade-in">
              {view === 'upload' && (
                <UploadView onAnalysisComplete={handleAnalysisComplete} />
              )}
              {view === 'review' && currentMeetingId && currentAiOutput && (
                <ReviewView meetingId={currentMeetingId} aiOutput={currentAiOutput} />
              )}
              {view === 'prepare' && <PrepView />}
              {view === 'query' && <QueryView />}
              {view === 'live' && <LiveView />}
              {view === 'meetings' && (
                <MeetingsView onSelectMeeting={handleSelectMeeting} />
              )}
            </div>
          </main>
        </div>
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
