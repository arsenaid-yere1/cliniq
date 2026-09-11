import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import type { VisitTreatmentDecision } from '@/lib/validations/visit-treatment-decision'

export async function saveVisitDecision(
  client: SupabaseClient<Database>,
  kind: 'initial_visit_notes' | 'discharge_notes' | 'pain_follow_up_notes',
  caseId: string,
  selector: { column: 'visit_type' | 'episode_id' | 'encounter_id'; value: string },
  values: Record<string, unknown> & { treatment_decision?: VisitTreatmentDecision; expected_updated_at?: string | null },
) {
  const { treatment_decision, expected_updated_at, ...patch } = values
  if (!treatment_decision || !expected_updated_at) return { error: 'Reload the note before confirming the treatment decision.' }
  const { data: note, error: loadError } = await client.from(kind).select('id')
    .eq('case_id', caseId).eq(selector.column, selector.value).is('deleted_at', null).eq('status', 'draft').single()
  if (loadError || !note) return { error: 'No draft visit note found.' }
  const { data, error } = await client.rpc('save_visit_note_decision', {
    p_kind: kind, p_note_id: note.id, p_case_id: caseId,
    p_expected_updated_at: expected_updated_at,
    p_patch: patch as Json, p_decision: treatment_decision,
  })
  return error ? { error: error.message } : { savedNote: data as Record<string, unknown> }
}
