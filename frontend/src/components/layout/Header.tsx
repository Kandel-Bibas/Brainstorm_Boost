import { Upload, ClipboardCheck, Search, History, BookOpen, Radio, Sparkles } from 'lucide-react'
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
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <Sparkles className="size-5 text-primary" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Brainstorm{' '}
            <span className="text-gradient">Boost</span>
          </h1>
        </div>

        {/* Navigation */}
        <nav className="flex items-center gap-1 rounded-2xl bg-secondary/50 p-1.5 ring-1 ring-border/50">
          {tabs.map(({ view, label, icon: Icon }) => {
            if (view === 'review' && !hasReview) return null
            const isActive = currentView === view
            const isLive = view === 'live'
            
            return (
              <Button
                key={view}
                variant="ghost"
                size="sm"
                onClick={() => onViewChange(view)}
                className={cn(
                  'relative gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200',
                  'text-muted-foreground hover:text-foreground hover:bg-secondary',
                  isActive && 'bg-card text-foreground shadow-sm ring-1 ring-border/50',
                  isLive && isActive && 'text-chart-5'
                )}
              >
                <Icon className={cn('size-4', isLive && isActive && 'animate-pulse')} />
                <span>{label}</span>
                {isLive && (
                  <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-chart-5 ring-2 ring-background" />
                )}
              </Button>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
