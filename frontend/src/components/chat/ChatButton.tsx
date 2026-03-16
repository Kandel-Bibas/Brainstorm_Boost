import { MessageCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatButtonProps {
  onClick: () => void
  isOpen: boolean
}

export function ChatButton({ onClick, isOpen }: ChatButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'fixed bottom-6 right-6 z-50 flex size-14 items-center justify-center rounded-full',
        'bg-primary text-primary-foreground shadow-lg transition-all duration-300',
        'hover:scale-105 active:scale-95',
        !isOpen && 'glow-sm'
      )}
    >
      {isOpen ? (
        <X className="size-6" />
      ) : (
        <MessageCircle className="size-6" />
      )}
    </button>
  )
}
