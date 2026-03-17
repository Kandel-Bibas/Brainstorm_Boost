import { Home, History, Radio, MessageCircle, Sparkles, Cpu } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface HeaderProps {
  provider?: string
  onProviderChange: (provider: string) => void
}

const tabs: { path: string; label: string; icon: typeof Home }[] = [
  { path: '/', label: 'Home', icon: Home },
  { path: '/live', label: 'Live', icon: Radio },
  { path: '/history', label: 'History', icon: History },
  { path: '/chat', label: 'Chat', icon: MessageCircle },
]

export function Header({ provider, onProviderChange }: HeaderProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const currentPath = location.pathname

  const { data: providersData } = useQuery({
    queryKey: ['providers'],
    queryFn: api.getProviders,
  })

  const providers = providersData?.providers ?? []
  const defaultProvider = providersData?.default ?? undefined

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        {/* Logo */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-3 transition-opacity hover:opacity-80"
        >
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <Sparkles className="size-5 text-primary" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Brainstorm{' '}
            <span className="text-gradient">Boost</span>
          </h1>
        </button>

        {/* Navigation */}
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-1 rounded-2xl bg-secondary/50 p-1.5 ring-1 ring-border/50">
            {tabs.map(({ path, label, icon: Icon }) => {
              const isActive = path === '/' ? currentPath === '/' : currentPath.startsWith(path)
              const isLive = path === '/live'

              return (
                <Button
                  key={path}
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(path)}
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

          {/* Provider selector */}
          {providers.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-xl bg-secondary/50 px-3 py-1.5 ring-1 ring-border/50">
              <Cpu className="size-3.5 text-muted-foreground" />
              <Select value={provider ?? defaultProvider} onValueChange={(v) => v && onProviderChange(v)}>
                <SelectTrigger className="h-7 w-auto min-w-[100px] border-0 bg-transparent p-0 text-sm font-medium text-foreground shadow-none focus:ring-0">
                  <SelectValue placeholder="AI Model" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {providers.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

        </div>
      </div>
    </header>
  )
}
