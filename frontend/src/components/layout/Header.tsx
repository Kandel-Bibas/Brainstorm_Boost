import { useState, useEffect, useCallback } from 'react'
import { Search, ChevronDown, Sun, Moon, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface TopbarProps {
  provider?: string
  onProviderChange?: (provider: string) => void
  onUploadClick?: () => void
}

export function Header({ onUploadClick }: TopbarProps) {
  const navigate = useNavigate()
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('bb-dark-mode')
    if (saved !== null) return saved === 'true'
    return false
  })
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('bb-dark-mode', String(darkMode))
  }, [darkMode])

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => !prev)
  }, [])

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      navigate(`/?q=${encodeURIComponent(searchQuery.trim())}`)
    }
  }

  return (
    <header className="flex items-center border-b border-[var(--bb-border)] bg-[var(--bb-surface)] px-5" style={{ height: 52 }}>
      {/* Search */}
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2.5 size-4 text-[var(--bb-text-muted)]" strokeWidth={1.8} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search meetings..."
          className="h-8 w-64 rounded-md border border-[var(--bb-border)] bg-[var(--bb-page-bg)] py-1.5 pl-8 pr-3 text-sm text-[var(--bb-text-primary)] placeholder:text-[var(--bb-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--bb-accent)]"
        />
      </div>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-2">
        {/* Dark mode toggle */}
        <button
          type="button"
          onClick={toggleDarkMode}
          className="flex size-8 items-center justify-center rounded-md text-[var(--bb-text-secondary)] transition-colors hover:bg-[var(--bb-border-light)]"
          aria-label="Toggle dark mode"
        >
          {darkMode ? <Sun size={18} strokeWidth={1.8} /> : <Moon size={18} strokeWidth={1.8} />}
        </button>

        {/* Upload Meeting split button */}
        <div className="inline-flex rounded-md" style={{ overflow: 'hidden' }}>
          <button
            type="button"
            onClick={onUploadClick}
            className="flex items-center gap-1 bg-[var(--bb-accent)] px-3 py-1.5 text-sm text-white transition-colors hover:bg-[var(--bb-accent-hover)]"
            style={{ borderRight: '1px solid rgba(255,255,255,0.25)' }}
          >
            <Plus size={14} strokeWidth={2.5} />
            Upload Meeting
          </button>
          <button
            type="button"
            className="flex items-center bg-[var(--bb-accent)] px-2 py-1.5 text-white transition-colors hover:bg-[var(--bb-accent-hover)]"
          >
            <ChevronDown size={12} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </header>
  )
}
