import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/types/database'
import type { PreGenerationVisitKind } from '@/lib/validations/visit-date'

type Client = Awaited<ReturnType<typeof createClient>>
type Prepared<K extends PreGenerationVisitKind> = {
  note: K extends 'discharge' ? Tables<'discharge_notes'> : Tables<'initial_visit_notes'>
  encounterId: string
  episodeId: string
}

export async function preparePreGenerationVisit<K extends PreGenerationVisitKind>(
  client: Client, caseId: string, episodeId: string, kind: K,
): Promise<Prepared<K>> {
  const args = { p_case_id: caseId, p_episode_id: episodeId, p_kind: kind }
  let result = await client.rpc('prepare_pre_generation_visit_note', args)
  if (result.error && ['40P01', '40001'].includes(result.error.code)) {
    result = await client.rpc('prepare_pre_generation_visit_note', args)
  }
  if (result.error || !result.data) throw new Error('Unable to prepare the visit record. Please try again.')
  return result.data as unknown as Prepared<K>
}
