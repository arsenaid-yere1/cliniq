import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Flag, FileText, Activity, Receipt } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { TimelineEvent, TimelineEventType } from '@/actions/timeline'

const eventIcons: Record<TimelineEventType, React.ElementType> = {
  status_change: Flag,
  document_added: FileText,
  procedure: Activity,
  invoice_created: Receipt,
}

const eventColors: Record<TimelineEventType, string> = {
  status_change: 'text-yellow-600',
  document_added: 'text-gray-600',
  procedure: 'text-green-600',
  invoice_created: 'text-purple-600',
}

export function CaseRecentActivity({ events }: { events: TimelineEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent activity.</p>
        ) : (
          <div className="space-y-3">
            {events.map((event) => {
              const Icon = eventIcons[event.type]
              return (
                <div key={event.id} className="flex items-start gap-3">
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${eventColors[event.type]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{event.title}</p>
                  </div>
                  <time className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(event.date), { addSuffix: true })}
                  </time>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
      {events.length > 0 && (
        <CardFooter>
          <Link href="./timeline" className="text-sm text-primary hover:underline">
            View All
          </Link>
        </CardFooter>
      )}
    </Card>
  )
}
