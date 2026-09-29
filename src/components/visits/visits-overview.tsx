'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, RefreshCw, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { VisitList } from './visit-list'
import { ScheduleVisitDialog } from './schedule-visit-dialog'
import { StartReturnEpisodeDialog } from './start-return-episode-dialog'
import { useVisitNavigationMemory } from './visit-navigation-context'
import type { VisitOverview } from '@/lib/clinical/visit-summary'

export function VisitLoadError({ message }: { message: string }) {
  const router = useRouter()
  return <div role="alert" className="space-y-3 rounded-xl border p-6"><h1 className="text-2xl font-bold">Visits</h1><p className="text-sm text-muted-foreground">{message}</p><Button variant="outline" onClick={() => router.refresh()}><RefreshCw className="mr-2 size-4" />Retry</Button></div>
}

export function VisitsOverview({ overview, requestedEpisodeId }: { overview: VisitOverview; requestedEpisodeId?: string }) {
  const router = useRouter()
  const memory = useVisitNavigationMemory()
  const container = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => Object.fromEntries(overview.episodes.map(e => [e.id,
    e.id === requestedEpisodeId ? true : memory?.read().expanded[e.id] ?? (e.status === 'active' || e.rows.some(r => r.noteState === 'Correction in progress')),
  ])))
  useEffect(() => {
    const scroll = container.current?.closest('main')
    if (scroll && memory?.read().visited) scroll.scrollTop = memory.read().scroll
    const remember = () => memory?.setScroll(scroll?.scrollTop ?? 0)
    scroll?.addEventListener('scroll', remember)
    return () => { remember(); scroll?.removeEventListener('scroll', remember) }
  }, [memory])
  useEffect(() => {
    if (!overview.hasGenerating) return
    const interval = window.setInterval(() => router.refresh(), 4000)
    return () => window.clearInterval(interval)
  }, [overview.hasGenerating, router])
  function toggle(id: string, wasExpanded: boolean) {
    const next = { ...expanded, [id]: !wasExpanded }
    setExpanded(next)
    memory?.setExpanded(next)
  }
  const active = overview.episodes.find(e => e.status === 'active')
  const requestedMissing = requestedEpisodeId && !overview.episodes.some(e => e.id === requestedEpisodeId)
  return <div ref={container} className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-bold tracking-tight">Visits</h1><p className="mt-1 text-sm text-muted-foreground">Evaluations, follow-ups, and discharge — together by care episode.</p></div>
      <div className="flex flex-wrap gap-2">
        {active?.primary && <Button asChild><Link href={active.primary.href}>{active.primary.label}</Link></Button>}
        {overview.canStartReturn && <StartReturnEpisodeDialog caseId={overview.caseId} providers={overview.providers} />}
      </div>
    </header>
    {(overview.warnings.length > 0 || requestedMissing || overview.providerError) && <div role="alert" className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" />Some visit information needs attention</p>
      {overview.warnings.map(w => <p key={w}>{w}</p>)}
      {requestedMissing && <p>The selected episode is unavailable. The available episodes are shown below.</p>}
      {overview.providerError && <p>Provider information is unavailable. Scheduling will be available after it reloads.</p>}
      <Button size="sm" variant="outline" onClick={() => router.refresh()}>Retry loading</Button>
    </div>}
    {overview.returnReason && <p className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">{overview.returnReason}</p>}
    {overview.episodes.map(episode => {
      const open = expanded[episode.id] ?? (episode.status === 'active' || episode.rows.some(r => r.noteState === 'Correction in progress'))
      const hasDischarge = episode.rows.some(r => r.kind === 'discharge')
      const secondary = [episode.initialAction, episode.painAction].filter(a => a && a.href !== active?.primary?.href)
      return <article key={episode.id} className={`overflow-hidden rounded-xl border ${episode.status === 'active' ? 'border-primary/25' : ''}`}>
        <button type="button" className="flex w-full items-center gap-3 bg-muted/25 px-4 py-4 text-left hover:bg-muted/40 sm:px-5" aria-expanded={open} aria-controls={`episode-${episode.id}`} onClick={() => toggle(episode.id, open)}>
          {open ? <ChevronDown aria-hidden="true" className="size-4 shrink-0" /> : <ChevronRight aria-hidden="true" className="size-4 shrink-0" />}
          <span className="min-w-0 flex-1"><span className="font-semibold">Episode {episode.episode_number}</span><span className="ml-3 text-xs text-muted-foreground">{episode.rows.length} {episode.rows.length === 1 ? 'visit' : 'visits'}</span>{episode.return_reason && <span className="mt-1 block truncate text-xs text-muted-foreground">{episode.return_reason}</span>}</span>
          <Badge variant={episode.status === 'active' ? 'default' : 'secondary'}>{({ active: 'Active care', discharged: 'Discharged', cancelled: 'Cancelled' } as Record<string, string>)[episode.status] ?? 'Status unavailable'}</Badge>
          {episode.rows.some(r => r.noteState === 'Correction in progress') && <span className="text-xs font-medium text-amber-800 dark:text-amber-300">Correction open</span>}
        </button>
        <div id={`episode-${episode.id}`} hidden={!open} className="space-y-5 p-4 sm:p-5">
          {episode.multipleUnfinished && <p className="text-sm font-medium">Choose a visit to continue</p>}
          {!episode.writable && episode.status !== 'active' && <p className="text-xs text-muted-foreground">Historical episode. Signed records remain available; authorized discharge corrections do not restart care.</p>}
          <VisitList rows={episode.rows} />
          {episode.writable && <div className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap gap-2">
              {secondary.map(action => action && <Button asChild key={action.href} variant="outline"><Link href={action.href}>{action.label}</Link></Button>)}
              {episode.canSchedule && <ScheduleVisitDialog caseId={overview.caseId} episodeId={episode.id} providers={overview.providers} />}
              {hasDischarge || !episode.dischargeReason ? <Button asChild variant="outline"><Link href={episode.dischargeAction.href}>{episode.dischargeAction.label}</Link></Button> : <Button variant="outline" disabled>Prepare discharge</Button>}
            </div>
            {episode.dischargeReason && <p className="text-xs text-muted-foreground">{episode.dischargeReason}</p>}
            {episode.blockers.length > 0 && <div className="text-xs text-muted-foreground"><p className="mb-1 font-medium">Before finalizing discharge, resolve:</p><ul className="list-inside list-disc space-y-1">{episode.blockers.map(blocker => <li key={blocker.id}>{blocker.href ? <Link href={blocker.href} className="underline underline-offset-2">{blocker.label}</Link> : blocker.label}</li>)}</ul></div>}
          </div>}
        </div>
      </article>
    })}
  </div>
}
