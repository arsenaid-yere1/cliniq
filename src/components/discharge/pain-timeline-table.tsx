'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatPainValue, type DischargePainTrajectory, type TimelineEntry } from '@/lib/claude/pain-trajectory'
import type { PainObservation } from '@/lib/claude/pain-observations'

interface PainTimelineTableProps {
  trajectory: DischargePainTrajectory | null
  painObservations: PainObservation[]
  dischargeEstimated: boolean
}

function formatDate(date: string | null): string {
  if (!date) return '—'
  // Clinic convention: MM/DD/YYYY everywhere in discharge notes + PDFs.
  // Accept both YYYY-MM-DD strings and full ISO datetimes on input.
  const ymdMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch
    return `${m}/${d}/${y}`
  }
  const d = new Date(date)
  if (!Number.isFinite(d.getTime())) return date
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${mm}/${dd}/${yyyy}`
}

function sourceBadge(source: TimelineEntry['source']): { label: string; className: string } {
  switch (source) {
    case 'intake':
      return { label: 'Intake', className: 'bg-blue-500/10 text-blue-700 border-blue-600 dark:text-blue-300' }
    case 'procedure':
      // Labeled "Pre-injection" to match the semantic captured at
      // Record Procedure time — the vital_signs reading is taken at
      // check-in before the injection, not after.
      return { label: 'Pre-injection', className: 'bg-slate-500/10 text-slate-700 border-slate-600 dark:text-slate-300' }
    case 'discharge_vitals':
      return { label: 'Provider entered', className: 'bg-emerald-500/10 text-emerald-700 border-emerald-600 dark:text-emerald-300' }
    case 'discharge_estimate':
      return { label: '-2 estimate', className: 'bg-amber-500/10 text-amber-700 border-amber-600 dark:text-amber-300' }
  }
}

function observationBadge(source: PainObservation['source']): { label: string; className: string } {
  switch (source) {
    case 'pt':
      return { label: 'PT', className: 'bg-purple-500/10 text-purple-700 border-purple-600 dark:text-purple-300' }
    case 'pm':
      return { label: 'PM', className: 'bg-teal-500/10 text-teal-700 border-teal-600 dark:text-teal-300' }
    case 'chiro':
      return { label: 'Chiro', className: 'bg-rose-500/10 text-rose-700 border-rose-600 dark:text-rose-300' }
    case 'case_summary':
      return { label: 'Case summary', className: 'bg-indigo-500/10 text-indigo-700 border-indigo-600 dark:text-indigo-300' }
  }
}

function observationValue(o: PainObservation): string {
  const raw = formatPainValue(o.min, o.max)
  if (!raw) return '—'
  if (o.scale === 'vas100') return raw.replace('/10', '/100 VAS')
  return raw
}

export function PainTimelineTable({
  trajectory,
  painObservations,
  dischargeEstimated,
}: PainTimelineTableProps) {
  const hasTrajectory = !!trajectory && trajectory.entries.length > 0
  const hasObservations = painObservations.length > 0

  if (!hasTrajectory && !hasObservations) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pain Timeline</CardTitle>
          <CardDescription>Read-only — reflects source data the generator used.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No pain data recorded for this case.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pain Timeline</CardTitle>
        <CardDescription>
          Read-only — reflects the deterministic trajectory the discharge generator uses. Procedure rows are <strong>pre-injection</strong> readings captured at check-in; the discharge-visit row is the provider-entered reading at today&apos;s follow-up (or the <em>-2</em> estimate when absent).
          {dischargeEstimated ? ' The discharge-visit reading is an estimate via the -2 rule; enter discharge vitals to replace.' : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {hasTrajectory && trajectory && (
          <div>
            <h4 className="text-sm font-semibold mb-2">Deterministic trajectory</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[130px]">Date</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead className="w-[90px]">Pain</TableHead>
                  <TableHead className="w-[140px]">Source</TableHead>
                  <TableHead className="w-[70px] text-right">Day</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trajectory.entries.map((e, i) => {
                  const badge = sourceBadge(e.source)
                  const pain = formatPainValue(e.min, e.max) ?? '—'
                  const day = e.dayOffset == null ? '—' : String(e.dayOffset)
                  return (
                    <TableRow key={`${e.source}-${i}`}>
                      <TableCell className="text-muted-foreground">{formatDate(e.date)}</TableCell>
                      <TableCell>{e.label}</TableCell>
                      <TableCell className="font-mono">{pain}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={badge.className}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{day}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {hasObservations && (
          <div>
            <h4 className="text-sm font-semibold mb-2">Supplementary observations (PT / PM / chiro)</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[130px]">Date</TableHead>
                  <TableHead className="w-[100px]">Source</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead className="w-[100px]">Pain</TableHead>
                  <TableHead>Context</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {painObservations.map((o, i) => {
                  const badge = observationBadge(o.source)
                  return (
                    <TableRow key={`${o.source}-${i}`}>
                      <TableCell className="text-muted-foreground">{formatDate(o.date)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={badge.className}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell>{o.label}</TableCell>
                      <TableCell className="font-mono">{observationValue(o)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{o.context ?? '—'}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
