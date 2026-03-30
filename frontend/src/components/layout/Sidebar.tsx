import { useState, useEffect, useRef } from 'react'
import {
  LayoutGrid,
  MessageSquare,
  FileText,
  Cpu,
  ChevronDown,
  Check,
} from 'lucide-react'
import { useLocation, Link } from 'react-router-dom'
import { api } from '@/lib/api'

interface SidebarProps {
  provider?: string
  onProviderChange?: (provider: string) => void
}

const navItems = [
  { path: '/', label: 'Meetings', icon: LayoutGrid },
  { path: '/chat', label: 'Chat', icon: MessageSquare },
  { path: '/documents', label: 'Documents', icon: FileText },
] as const

export function Sidebar({ provider, onProviderChange }: SidebarProps) {
  const location = useLocation()
  const currentPath = location.pathname
  const [providers, setProviders] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.getProviders().then((data) => {
      setProviders(data.providers ?? [])
      if (!provider && data.default) {
        onProviderChange?.(data.default)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function isActive(path: string) {
    if (path === '/') return currentPath === '/'
    return currentPath.startsWith(path)
  }

  const currentProvider = provider || providers[0] || 'gemini'

  return (
    <aside className="sticky top-0 flex h-screen w-60 flex-col border-r border-[var(--bb-border)] bg-[var(--bb-surface)]">
      {/* App name */}
      <div className="px-5 py-6">
        <span className="text-lg font-semibold text-[var(--bb-navy)]">
          Brainstorm Boost
        </span>
      </div>

      {/* Nav items */}
      <nav className="flex flex-col gap-0.5 px-3">
        {navItems.map(({ path, label, icon: Icon }) => {
          const active = isActive(path)
          return (
            <Link
              key={path}
              to={path}
              className={[
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-[var(--sidebar-accent)] font-medium text-[var(--sidebar-accent-foreground)]'
                  : 'text-[var(--sidebar-foreground)] hover:bg-[var(--secondary)]',
              ].join(' ')}
            >
              <Icon className="size-4 shrink-0" />
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Bottom: Model selector */}
      <div ref={ref} className="relative mt-auto border-t border-[var(--bb-border)] px-3 py-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--sidebar-foreground)] transition-colors hover:bg-[var(--secondary)]"
        >
          <Cpu className="size-4 shrink-0" />
          <span className="flex-1 truncate text-left capitalize">{currentProvider}</span>
          <ChevronDown className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && providers.length > 0 && (
          <div
            className="absolute bottom-full left-3 right-3 mb-1 rounded-lg border bg-[var(--bb-surface)] py-1 shadow-lg"
            style={{ borderColor: 'var(--bb-border)' }}
          >
            <div className="px-3 py-1.5 text-xs font-medium text-[var(--bb-text-muted)]">
              AI Model
            </div>
            {providers.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => { onProviderChange?.(p); setOpen(false) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--bb-text-primary)] capitalize transition-colors hover:bg-[var(--bb-border-light)]"
              >
                {p === currentProvider ? (
                  <Check className="size-3.5 text-[var(--bb-accent)]" />
                ) : (
                  <span className="size-3.5" />
                )}
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
