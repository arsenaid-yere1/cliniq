import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/types/database'
import { buildIntakeHistory, intakeRecord, intakeText, type HistoricalVisit, type HistoricalDischarge, type IntakeHistoryResult } from './follow-up-intake-prefill'

type Client = Awaited<ReturnType<typeof createClient>>

/** Read only: source suggestions are not persisted until the clinician saves intake. */
export async function loadFollowUpIntakeHistory(
  client: Client,
  encounter: Tables<'clinical_encounters'>,
): Promise<IntakeHistoryResult> {
  const date = encounter.encounter_date
  if (!date) return { data: null }
  try {
    const [encounters, evaluations, followUps, procedures, episode] = await Promise.all([
      client.from('clinical_encounters')
        .select('id,encounter_date,encounter_type,provider_intake,patient_reported_pain_min,patient_reported_pain_max')
        .eq('case_id', encounter.case_id).eq('episode_id', encounter.episode_id)
        .eq('status', 'completed').neq('id', encounter.id).is('deleted_at', null).lt('encounter_date', date),
      client.from('initial_visit_notes').select('id,encounter_id,visit_date,visit_type,chief_complaint,treatment_plan')
        .eq('case_id', encounter.case_id).eq('episode_id', encounter.episode_id)
        .eq('status', 'finalized').is('deleted_at', null).lt('visit_date', date),
      client.from('pain_follow_up_notes').select('id,encounter_id,treatment_plan')
        .eq('case_id', encounter.case_id).eq('episode_id', encounter.episode_id)
        .eq('status', 'finalized').is('deleted_at', null),
      client.from('procedures').select('id,procedure_date,procedure_type,sites')
        .eq('case_id', encounter.case_id).eq('episode_id', encounter.episode_id)
        .is('deleted_at', null).lt('procedure_date', date).order('procedure_date').order('id'),
      client.from('care_episodes').select('episode_number')
        .eq('case_id', encounter.case_id).eq('id', encounter.episode_id).is('deleted_at', null).single(),
    ])
    if ([encounters, evaluations, followUps, procedures, episode].some((result) => result.error)) throw new Error('History query failed')
    const visits: HistoricalVisit[] = []
    for (const row of encounters.data ?? []) {
      if (!row.encounter_date) continue
      const evaluation = evaluations.data?.find((note) => note.encounter_id === row.id)
      const followUp = followUps.data?.find((note) => note.encounter_id === row.id)
      if (!evaluation && !followUp) continue
      const visitDate = evaluation?.visit_date ?? row.encounter_date
      if (visitDate >= date) continue
      visits.push({
        id: evaluation?.id ?? followUp!.id, date: visitDate,
        label: evaluation ? (evaluation.visit_type === 'pain_evaluation_visit' ? 'Pain evaluation' : 'Initial evaluation') : 'Follow-up visit',
        complaint: evaluation?.chief_complaint ?? intakeText(intakeRecord(row.provider_intake).chief_complaint),
        plan: evaluation?.treatment_plan ?? followUp?.treatment_plan ?? null,
        painMin: row.patient_reported_pain_min, painMax: row.patient_reported_pain_max,
      })
    }
    visits.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    let discharge: HistoricalDischarge | null = null
    if ((episode.data?.episode_number ?? 1) > 1) {
      const previous = await client.from('care_episodes').select('id')
        .eq('case_id', encounter.case_id).eq('episode_number', episode.data!.episode_number - 1)
        .is('deleted_at', null).maybeSingle()
      if (previous.error) throw new Error('Previous episode query failed')
      if (previous.data) {
        const result = await client.from('discharge_notes').select('id,visit_date,assessment,plan_and_recommendations')
          .eq('case_id', encounter.case_id).eq('episode_id', previous.data.id)
          .eq('status', 'finalized').is('deleted_at', null).lt('visit_date', date)
          .order('visit_date', { ascending: false }).order('id').limit(1).maybeSingle()
        if (result.error) throw new Error('Discharge query failed')
        discharge = result.data
      }
    }
    return { data: buildIntakeHistory(visits[0] ?? null, procedures.data ?? [], discharge) }
  } catch {
    return { data: null, error: 'Previous visit information could not be loaded. You can still enter intake manually.' }
  }
}
