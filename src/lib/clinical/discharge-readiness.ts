import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import { readCompleteVisitRows } from './complete-visit-rows'
import { visitHref } from './visit-routes'
import { visitKindLabels, type DischargeBlocker } from './visit-summary'
import { CLINICAL_ENCOUNTER_TYPES, type ClinicalEncounterType } from '@/lib/constants/clinical-encounter'
import { RETURN_TELE_VISITS_ENABLED } from '@/lib/features/return-tele-visits'

export async function loadDischargeBlockers(client: Awaited<ReturnType<typeof createClient>>, caseId: string, episodeId: string) {
  try {
    const [encounters, orders, appointments] = await Promise.all([
      readCompleteVisitRows((from, to) => client.from('clinical_encounters').select('id,encounter_type,status', { count: 'exact' }).eq('case_id', caseId).eq('episode_id', episodeId).neq('encounter_type', 'discharge').in('status', ['scheduled', 'in_progress']).is('deleted_at', null).order('id').range(from, to)),
      readCompleteVisitRows((from, to) => client.from('procedure_orders').select('id', { count: 'exact' }).eq('case_id', caseId).eq('episode_id', episodeId).in('status', ['ordered', 'scheduled']).is('deleted_at', null).order('id').range(from, to)),
      readCompleteVisitRows((from, to) => client.from('procedure_appointments').select('id', { count: 'exact' }).eq('case_id', caseId).eq('episode_id', episodeId).eq('status', 'scheduled').is('deleted_at', null).order('id').range(from, to)),
    ])
    const blockers: DischargeBlocker[] = encounters.map(e => ({
      id: e.id, label: visitKindLabels[e.encounter_type as ClinicalEncounterType] ?? 'Unresolved visit',
      href: (CLINICAL_ENCOUNTER_TYPES as readonly string[]).includes(e.encounter_type) && (e.encounter_type !== 'pain_follow_up' || RETURN_TELE_VISITS_ENABLED) ? visitHref(caseId, episodeId, e.encounter_type as ClinicalEncounterType, e.id) : null,
    }))
    for (const order of orders) blockers.push({ id: order.id, label: 'Open procedure order', href: `/patients/${caseId}/procedures` })
    for (const appointment of appointments) blockers.push({ id: appointment.id, label: 'Scheduled procedure', href: `/patients/${caseId}/procedures` })
    return { blockers, error: null }
  } catch { return { blockers: [], error: 'Discharge readiness could not be checked. Reload before finalizing.' } }
}
