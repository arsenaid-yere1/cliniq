import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { encounterStatusLabels, visitKindLabels, type VisitSummary } from '@/lib/clinical/visit-summary'

function dateLabel(value: string | null, scheduled: boolean) {
  if (!value) return scheduled ? 'Schedule not recorded' : 'Service date not recorded'
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  return `${scheduled ? 'Scheduled' : 'Service date'} · ${format(date, scheduled ? 'MMM d, yyyy · h:mm a' : 'MMM d, yyyy')}`
}
export function VisitList({ rows }: { rows: VisitSummary[] }) {
  return <div className="space-y-6">
    {(['work', 'upcoming', 'history'] as const).map(group => {
      const visits = rows.filter(row => row.group === group)
      if (!visits.length) return null
      return <section key={group} aria-label={{ work: 'Work in progress', upcoming: 'Upcoming', history: 'History' }[group]}>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{{ work: 'Work in progress', upcoming: 'Upcoming', history: 'History' }[group]}</h3>
        <div className="divide-y rounded-lg border bg-background">
          {visits.map(row => {
            const content = <>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{visitKindLabels[row.kind]}</span><Badge variant={row.noteState === 'Generation failed' ? 'destructive' : 'outline'}>{row.noteState}</Badge>{row.revision && <span className="text-xs text-muted-foreground">Corrected v{row.revision}</span>}</div>
                <p className="text-sm text-muted-foreground">{dateLabel(group === 'upcoming' ? row.scheduledStart : row.serviceDate, group === 'upcoming')}</p>
                <p className="text-xs text-muted-foreground">{row.modality} · {row.provider} · {row.encounterStatus ? encounterStatusLabels[row.encounterStatus] ?? 'Visit status unavailable' : 'Visit status unavailable'}</p>
                {row.unavailableReason && <p className="text-xs text-amber-800 dark:text-amber-300">{row.unavailableReason}</p>}
              </div>
              {row.href && <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">{row.actionLabel}<ArrowUpRight aria-hidden="true" className="size-4" /></span>}
            </>
            const className = 'flex flex-wrap items-center justify-between gap-3 px-4 py-4 first:rounded-t-lg last:rounded-b-lg'
            return row.href ? <Link key={row.id} href={row.href} className={`${className} transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-primary`}>{content}</Link> : <div key={row.id} className={className}>{content}</div>
          })}
        </div>
      </section>
    })}
    {!rows.length && <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No visits recorded yet. Start an evaluation to begin this episode.</p>}
  </div>
}
