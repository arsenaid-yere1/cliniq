'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidateVisitViews } from '@/lib/clinical/revalidate-visit-views'
import { resolveEvaluationEpisode } from '@/lib/clinical/evaluation-scope'
import { resolveDischargeScope } from '@/lib/clinical/discharge-scope'
import { preGenerationVisitDateSchema, type PreGenerationVisitDateInput, type VisitDateSaveResult, type VisitDateToken } from '@/lib/validations/visit-date'

export async function savePreGenerationVisitDate(input: PreGenerationVisitDateInput): Promise<VisitDateSaveResult> {
  const parsed = preGenerationVisitDateSchema.safeParse(input)
  if (!parsed.success) return { code: 'invalid_date', error: parsed.error.issues[0]?.message ?? 'Invalid visit date' }
  const values = parsed.data
  try {
    const client = await createClient()
    const { data: { user } } = await client.auth.getUser()
    if (!user) return { code: 'locked', error: 'Not authenticated' }
    const scope = values.kind === 'discharge'
      ? await resolveDischargeScope(client, values.caseId, values.episodeId, true)
      : await resolveEvaluationEpisode(client, values.caseId, values.episodeId, values.kind, true)
    if (scope.error) return { code: 'locked', error: scope.error }
    const args = {
      p_case_id: values.caseId, p_episode_id: values.episodeId, p_kind: values.kind,
      p_date: values.visitDate, p_expected_note_id: values.expectedNoteId, p_expected_date: values.expectedDate,
    }
    let result = await client.rpc('save_pre_generation_visit_date', args)
    if (result.error && ['40P01', '40001'].includes(result.error.code)) {
      result = await client.rpc('save_pre_generation_visit_date', args)
    }
    if (result.error) {
      const code = result.error.code
      if (code === '42501') return { code: 'locked', error: result.error.message }
      if (['23514', '22007', '22008', '22023'].includes(code)) return { code: 'invalid_date', error: result.error.message }
      if (code === 'P0002') return { code: 'conflict', error: 'The visit changed. Reload before saving the date.' }
      return { code: 'save_failed', error: 'Unable to save the visit date. Your input is retained; retry saving.' }
    }
    const saved = result.data as { data?: VisitDateToken; conflict?: VisitDateToken } | null
    if (saved?.conflict) return { code: 'conflict', error: 'The visit date changed in another session.', conflict: saved.conflict }
    if (!saved?.data) return { code: 'save_failed', error: 'The date save was not confirmed. Retry saving.' }
    revalidateVisitViews(values.caseId, values.kind === 'discharge' ? 'discharge' : 'evaluation', { dischargeDateChanged: values.kind === 'discharge' })
    return { data: saved.data }
  } catch {
    return { code: 'save_failed', error: 'Unable to save the visit date. Your input is retained; retry saving.' }
  }
}
