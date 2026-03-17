import { cn } from '@/lib/utils'
import { useState } from 'react'

export interface TimelineItem {
  type: 'decision' | 'action_item' | 'risk'
  id: string
  position: number // 0-1 relative position in transcript
  label: string
}

interface MeetingTimelineProps {
  items: TimelineItem[]
  onItemClick: (id: string, position: number) => void
}

const dotColors: Record<string, { bg: string; ring: string }> = {
  decision: { bg: 'bg-chart-3', ring: 'ring-chart-3/30' },
  action_item: { bg: 'bg-primary', ring: 'ring-primary/30' },
  risk: { bg: 'bg-chart-5', ring: 'ring-chart-5/30' },
}

export function MeetingTimeline({ items, onItemClick }: MeetingTimelineProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  if (items.length === 0) return null

  return (
    <div className="relative mx-4 my-2">
      {/* Track */}
      <div className="h-1.5 w-full rounded-full bg-border/50" />

      {/* Dots */}
      {items.map((item, idx) => {
        const colors = dotColors[item.type] || dotColors.decision
        const left = Math.max(1, Math.min(99, item.position * 100))

        return (
          <div
            key={item.id + '-' + idx}
            className="absolute top-0 -translate-x-1/2 -translate-y-[3px]"
            style={{ left: `${left}%` }}
          >
            <button
              onClick={() => onItemClick(item.id, item.position)}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={cn(
                'size-3 rounded-full ring-2 transition-all hover:scale-150',
                colors.bg,
                colors.ring
              )}
              aria-label={item.label}
            />

            {/* Tooltip */}
            {hoveredIdx === idx && (
              <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border/50 bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg">
                <span
                  className={cn(
                    'mr-1.5 inline-block size-2 rounded-full',
                    colors.bg
                  )}
                />
                {item.label.length > 60 ? item.label.substring(0, 60) + '...' : item.label}
                <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-popover" />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
