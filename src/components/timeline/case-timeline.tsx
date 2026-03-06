import { format } from 'date-fns'
import { Flag, FileText, Activity, Receipt } from 'lucide-react'
import type { TimelineEvent, TimelineEventType } from '@/actions/timeline'
import {
  Timeline,
  TimelineItem,
  TimelineDot,
  TimelineConnector,
  TimelineContent,
} from '@/components/ui/timeline'

const eventConfig: Record<TimelineEventType, { icon: React.ElementType; colorClass: string }> = {
  status_change: { icon: Flag, colorClass: 'text-yellow-600' },
  document_added: { icon: FileText, colorClass: 'text-gray-600' },
  procedure: { icon: Activity, colorClass: 'text-green-600' },
  invoice_created: { icon: Receipt, colorClass: 'text-purple-600' },
}

function formatEventDate(dateStr: string): string {
  const date = new Date(dateStr)
  if (dateStr.includes('T') && !dateStr.endsWith('T00:00:00')) {
    return format(date, "MMM d, yyyy 'at' h:mm a")
  }
  return format(date, 'MMM d, yyyy')
}

export function CaseTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-center py-8 text-muted-foreground">
        No activity recorded for this case.
      </p>
    )
  }

  return (
    <Timeline>
      {events.map((event, index) => {
        const config = eventConfig[event.type]
        const Icon = config.icon

        return (
          <TimelineItem key={event.id}>
            {index < events.length - 1 && <TimelineConnector />}
            <TimelineDot>
              <Icon className={`h-4 w-4 ${config.colorClass}`} />
            </TimelineDot>
            <TimelineContent>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-sm">{event.title}</p>
                  {event.description && (
                    <p className="text-sm text-muted-foreground">{event.description}</p>
                  )}
                </div>
                <time className="text-xs text-muted-foreground whitespace-nowrap pt-0.5">
                  {formatEventDate(event.date)}
                </time>
              </div>
            </TimelineContent>
          </TimelineItem>
        )
      })}
    </Timeline>
  )
}
