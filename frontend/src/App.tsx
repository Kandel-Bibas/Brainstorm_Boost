import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Header } from '@/components/layout/Header'

const queryClient = new QueryClient()

type View = 'upload' | 'review' | 'query' | 'meetings'

export default function App() {
  const [view, _setView] = useState<View>('upload')

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-slate-50">
        <Header />
        <main className="mx-auto max-w-6xl px-6 py-8">
          <p className="text-slate-500">Current view: {view}</p>
        </main>
      </div>
    </QueryClientProvider>
  )
}
