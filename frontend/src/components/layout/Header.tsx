import { Upload, ClipboardCheck, Search, History, BookOpen, Radio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type View = 'upload' | 'review' | 'prepare' | 'query' | 'meetings' | 'live'

interface HeaderProps {
  currentView: View
  onViewChange: (view: View) => void
  hasReview: boolean
}

const tabs: { view: View; label: string; icon: typeof Upload }[] = [
  { view: 'upload', label: 'Upload', icon: Upload },
  { view: 'prepare', label: 'Prepare', icon: BookOpen },
  { view: 'review', label: 'Review', icon: ClipboardCheck },
  { view: 'query', label: 'Ask', icon: Search },
  { view: 'live', label: 'Live', icon: Radio },
  { view: 'meetings', label: 'History', icon: History },
]

export function Header({ currentView, onViewChange, hasReview }: HeaderProps) {
  return (
    <header className="border-b border-slate-700/50 bg-slate-900">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <h1 className="text-xl font-semibold tracking-tight text-white">
          Brainstorm{' '}
          <span className="text-blue-400">Boost</span>
        </h1>
        <nav className="flex items-center gap-1">
          {tabs.map(({ view, label, icon: Icon }) => {
            if (view === 'review' && !hasReview) return null
            const isActive = currentView === view
            return (
              <Button
                key={view}
                variant="ghost"
                size="sm"
                onClick={() => onViewChange(view)}
                className={cn(
                  'gap-1.5 text-slate-300 hover:bg-slate-800 hover:text-white',
                  isActive && 'bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 hover:text-blue-200'
                )}
              >
                <Icon className="size-4" />
                {label}
              </Button>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
