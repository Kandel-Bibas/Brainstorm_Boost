import { useState, useCallback } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { Header, type View } from '@/components/layout/Header'
import { UploadView } from '@/components/upload/UploadView'
import { ReviewView } from '@/components/review/ReviewView'
import { QueryView } from '@/components/query/QueryView'
import { MeetingsView } from '@/components/meetings/MeetingsView'
import { PrepView } from '@/components/prep/PrepView'
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

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-slate-50">
        <Header currentView={view} onViewChange={setView} hasReview={hasReview} />
        <main className="mx-auto max-w-6xl px-6 py-8">
          {view === 'upload' && (
            <UploadView onAnalysisComplete={handleAnalysisComplete} />
          )}
          {view === 'review' && currentMeetingId && currentAiOutput && (
            <ReviewView meetingId={currentMeetingId} aiOutput={currentAiOutput} />
          )}
          {view === 'prepare' && <PrepView />}
          {view === 'query' && <QueryView />}
          {view === 'meetings' && (
            <MeetingsView onSelectMeeting={handleSelectMeeting} />
          )}
        </main>
      </div>
      <Toaster position="bottom-right" richColors />
    </QueryClientProvider>
  )
}
