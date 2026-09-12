import { labelWithLaterality, parseSitesJsonb } from '@/lib/procedures/sites-helpers'
import type { Tables } from '@/types/database'

export type HistorySource = { id: string; kind: 'visit' | 'procedure' | 'discharge'; date: string; label: string }
export type IntakeHistory = {
  chiefComplaint: string
  intervalHistory: string
  sources: HistorySource[]
  previousPain: { min: number | null; max: number | null; date: string } | null
}
export type IntakeHistoryResult = { data: IntakeHistory | null; error?: string }
export type HistoricalVisit = {
  id: string; date: string; label: string; complaint: string | null; plan: string | null
  painMin: number | null; painMax: number | null
}
export type HistoricalProcedure = Pick<Tables<'procedures'>, 'id' | 'procedure_date' | 'procedure_type' | 'sites'>
export type HistoricalDischarge = Pick<Tables<'discharge_notes'>, 'id' | 'visit_date' | 'assessment' | 'plan_and_recommendations'>
export type FollowUpIntake = Record<string, unknown> & {
  chief_complaint: string; interval_history: string; review_of_systems: string; video_observations: string
}

export function intakeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function intakeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildIntakeHistory(
  visit: HistoricalVisit | null,
  procedures: HistoricalProcedure[],
  discharge: HistoricalDischarge | null,
): IntakeHistory {
  const sources: HistorySource[] = []
  const history: string[] = []
  let chiefComplaint = ''
  if (visit) {
    const label = `${visit.label} on ${visit.date}`
    sources.push({ id: visit.id, kind: 'visit', date: visit.date, label })
    if (intakeText(visit.complaint)) chiefComplaint = `Previously documented — ${label}:\n${intakeText(visit.complaint)}`
    if (intakeText(visit.plan)) history.push(`Previous plan — ${label}:\n${intakeText(visit.plan)}`)
  }
  for (const procedure of procedures) {
    const sites = parseSitesJsonb(procedure.sites).map(labelWithLaterality).join(', ')
    const label = `${procedure.procedure_type.toUpperCase()} on ${procedure.procedure_date}`
    sources.push({ id: procedure.id, kind: 'procedure', date: procedure.procedure_date, label })
    history.push(`Recorded procedure — ${label}${sites ? `: ${sites}` : ''}.`)
  }
  if (discharge?.visit_date && (intakeText(discharge.assessment) || intakeText(discharge.plan_and_recommendations))) {
    const label = `Previous episode discharge on ${discharge.visit_date}`
    sources.push({ id: discharge.id, kind: 'discharge', date: discharge.visit_date, label })
    history.push(`${label} (background):\n${[intakeText(discharge.assessment), intakeText(discharge.plan_and_recommendations)].filter(Boolean).join('\n')}`)
  }
  return {
    chiefComplaint, intervalHistory: history.join('\n\n'), sources,
    previousPain: visit && (visit.painMin != null || visit.painMax != null)
      ? { min: visit.painMin, max: visit.painMax, date: visit.date } : null,
  }
}

export function initializeFollowUpIntake(encounter: Tables<'clinical_encounters'>, history: IntakeHistory | null) {
  const saved = intakeRecord(encounter.provider_intake)
  const keys = ['chief_complaint', 'interval_history', 'review_of_systems', 'video_observations'] as const
  const hasSavedData = Object.keys(saved).some((key) => !['status_reason', 'status_changed_at'].includes(key))
    || encounter.patient_reported_pain_min != null || encounter.patient_reported_pain_max != null
    || Object.keys(intakeRecord(encounter.patient_reported_measurements)).length > 0
    || encounter.telehealth_consent_obtained != null || !!encounter.telehealth_consent_at
    || !!encounter.patient_location_state || !!encounter.provider_location || !!encounter.connection_method
  const applied = !hasSavedData && ['scheduled', 'in_progress'].includes(encounter.status)
    && !!history && !!(history.chiefComplaint || history.intervalHistory)
  const intake = {
    ...saved,
    ...Object.fromEntries(keys.map((key) => [key, typeof saved[key] === 'string' ? saved[key] : ''])),
    ...(applied ? { chief_complaint: history.chiefComplaint, interval_history: history.intervalHistory } : {}),
  } as FollowUpIntake
  return { intake, applied }
}
