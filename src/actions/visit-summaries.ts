'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import { RETURN_TELE_VISITS_ENABLED } from '@/lib/features/return-tele-visits'
import { buildVisitOverview, type NoteInput, type VisitOverview } from '@/lib/clinical/visit-summary'
import { readCompleteVisitRows } from '@/lib/clinical/complete-visit-rows'
import { getPainFollowUpEditorState } from '@/lib/clinical/pain-follow-up-editor-state'
import { LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'

export async function getCaseVisitOverview(caseId: string): Promise<{ data: VisitOverview; error?: never } | { data?: never; error: string }> {
  const client: SupabaseClient<Database> = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  try {
    const { data: clinicalCase, error: caseError } = await client.from('cases')
      .select('case_status,assigned_provider_id').eq('id', caseId).is('deleted_at', null).maybeSingle()
    if (caseError || !clinicalCase) return { error: 'Unable to load case information' }
    const [episodes, encounters, evaluations, followUps, discharges, corrections, orders, appointments, providerResult, actorResult] = await Promise.all([
      readCompleteVisitRows((from, to) => client.from('care_episodes').select('id,case_id,episode_number,status,requires_pain_evaluation,opened_at,ended_at,return_reason', { count: 'exact' }).eq('case_id', caseId).is('deleted_at', null).order('id').range(from, to)),
      readCompleteVisitRows((from, to) => client.from('clinical_encounters').select('id,case_id,episode_id,encounter_type,status,encounter_date,scheduled_start,provider_id,modality', { count: 'exact' }).eq('case_id', caseId).is('deleted_at', null).order('id').range(from, to)),
      readCompleteVisitRows((from, to) => client.from('initial_visit_notes').select('id,case_id,episode_id,encounter_id,visit_type,status,visit_date,document_id,introduction,chief_complaint', { count: 'exact' }).eq('case_id', caseId).is('deleted_at', null).order('id').range(from, to)),
      readCompleteVisitRows((from, to) => client.from('pain_follow_up_notes').select('id,case_id,episode_id,encounter_id,status,document_id,subjective,interval_history,review_of_systems,telehealth_observations,imaging_review,assessment,diagnoses,treatment_plan,patient_education,follow_up,clinician_disclaimer,procedure_recommendations', { count: 'exact' }).eq('case_id', caseId).is('deleted_at', null).order('id').range(from, to)),
      readCompleteVisitRows((from, to) => client.from('discharge_notes').select('id,case_id,episode_id,encounter_id,status,visit_date,document_id,subjective,assessment', { count: 'exact' }).eq('case_id', caseId).is('deleted_at', null).order('id').range(from, to)),
      readCompleteVisitRows((from, to) => client.from('discharge_note_corrections').select('id,case_id,episode_id,discharge_note_id,status,revision_number', { count: 'exact' }).eq('case_id', caseId).order('id').range(from, to)),
      readCompleteVisitRows((from, to) => client.from('procedure_orders').select('id,episode_id,status', { count: 'exact' }).eq('case_id', caseId).is('deleted_at', null).in('status', ['ordered', 'scheduled']).order('id').range(from, to)),
      readCompleteVisitRows((from, to) => client.from('procedure_appointments').select('id,episode_id,status', { count: 'exact' }).eq('case_id', caseId).is('deleted_at', null).eq('status', 'scheduled').order('id').range(from, to)),
      readCompleteVisitRows((from, to) => client.from('provider_profiles').select('id,display_name', { count: 'exact' }).is('deleted_at', null).order('id').range(from, to)).then(data => ({ data, error: false }), () => ({ data: [], error: true })),
      client.from('users').select('role,is_active').eq('id', user.id).maybeSingle(),
    ])
    let claimedEncounterIds: string[] | null = []
    try {
      const ids = discharges.flatMap(n => n.encounter_id ? [n.encounter_id] : [])
      for (let i = 0; i < ids.length; i += 200) {
        const claims = await readCompleteVisitRows((from, to) => client.from('billing_source_claims').select('id,encounter_id', { count: 'exact' }).in('encounter_id', ids.slice(i, i + 200)).eq('claim_kind', 'visit').is('released_at', null).order('id').range(from, to))
        claimedEncounterIds.push(...claims.flatMap(c => c.encounter_id ? [c.encounter_id] : []))
      }
    } catch { claimedEncounterIds = null }
    const actor = actorResult.data
    const correctionAllowed = actorResult.error || !actor ? null : actor.is_active && (actor.role === 'admin' || (actor.role === 'provider' && clinicalCase.assigned_provider_id === user.id && !LOCKED_STATUSES.includes(clinicalCase.case_status as CaseStatus)))
    // Explicit projection strips every narrative sentinel and recommendation from the client payload.
    const project = (n: typeof discharges[number], kind: string, hasContent: boolean): NoteInput => ({ id: n.id, case_id: n.case_id, episode_id: n.episode_id, encounter_id: n.encounter_id, status: n.status, visit_date: n.visit_date, document_id: n.document_id, kind, hasContent })
    const notes: NoteInput[] = [
      ...evaluations.map(n => project({ ...n, subjective: null, assessment: null }, n.visit_type === 'initial_visit' ? 'initial_evaluation' : n.visit_type === 'pain_evaluation_visit' ? 'pain_evaluation' : n.visit_type, Boolean(n.introduction || n.chief_complaint))),
      // Follow-up service dates belong to the encounter; the projection falls back to it.
      ...followUps.map(n => project({ ...n, visit_date: null }, 'pain_follow_up', getPainFollowUpEditorState({ ...n, status: 'draft' }) !== 'empty')),
      ...discharges.map(n => project(n, 'discharge', Boolean(n.subjective || n.assessment))),
    ]
    return { data: buildVisitOverview({ caseId, caseStatus: clinicalCase.case_status, episodes, encounters, notes, corrections, orders, appointments, providers: providerResult.data.sort((a, b) => a.display_name.localeCompare(b.display_name)), providerError: providerResult.error, returnVisitsEnabled: RETURN_TELE_VISITS_ENABLED, correctionAllowed, claimedEncounterIds }) }
  } catch {
    return { error: 'Unable to load complete visit history. Reload to try again. No new care should be started from this incomplete view.' }
  }
}
