import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import { defaultProviderIntake, providerIntakeSchema } from '@/lib/validations/initial-visit-note'
import type { CareEpisode } from './episode-context'
import { historyEncounterDate, historyServiceDate } from './prior-episode-history'

const sections = ['accident_details', 'past_medical_history', 'social_history'] as const
export type ReturnIntakeSource = { section: typeof sections[number]; episodeNumber: number; visitDate: string }
type CurrentIntakeNote = {
  provider_intake?: unknown; status?: string; introduction?: unknown; chief_complaint?: unknown
  visit_date?: unknown; clinical_encounters?: unknown
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Prefill unsaved history only. The caller must validate episode ownership first. */
export async function loadReturnIntake(
  client: Awaited<ReturnType<typeof createClient>>, caseId: string, episode: CareEpisode,
  current: CurrentIntakeNote | null, visitType: string,
) {
  const stored = object(current?.provider_intake)
  const unchanged = { data: current?.provider_intake ?? null, carriedSections: [] as ReturnIntakeSource[] }
  if (episode.case_id !== caseId) throw new Error('Care episode does not belong to this case')
  if (episode.episode_number <= 1 || episode.status !== 'active' || visitType !== 'pain_evaluation_visit'
    || (current && current.status !== 'draft') || current?.introduction || current?.chief_complaint) return unchanged
  // Explicitly saved blanks/defaults belong to the current visit too.
  const missing = sections.filter(section => !Object.hasOwn(stored, section))
  if (!missing.length) return unchanged
  const cutoff = historyServiceDate(current?.visit_date, historyEncounterDate(current?.clinical_encounters), episode.opened_at?.slice(0, 10))
  if (!cutoff) return unchanged
  const inherited: Record<string, unknown> = {}
  const carriedSections: ReturnIntakeSource[] = []
  const failure = 'Previous episode intake could not be loaded. Reload this page to try again.'
  for (let start = 0; start < Number.MAX_SAFE_INTEGER; start += 500) {
    const prior = await client.from('care_episodes').select('id,case_id,episode_number,status,deleted_at')
      .eq('case_id', caseId).lt('episode_number', episode.episode_number).eq('status', 'discharged')
      .is('deleted_at', null).order('episode_number', { ascending: false }).range(start, start + 499)
    if (prior.error || !Array.isArray(prior.data)) throw new Error(failure)
    for (const previous of prior.data) {
      if (previous.case_id !== caseId || previous.deleted_at || previous.status !== 'discharged'
        || previous.episode_number >= episode.episode_number) continue
      const result = await client.from('initial_visit_notes')
        .select('id,case_id,episode_id,visit_type,visit_date,provider_intake,status,deleted_at,clinical_encounters:clinical_encounters!initial_visit_notes_encounter_id_fkey(case_id,episode_id,encounter_type,encounter_date,status,deleted_at)')
        .eq('case_id', caseId).eq('episode_id', previous.id).eq('status', 'finalized')
        .in('visit_type', ['initial_visit', 'pain_evaluation_visit']).is('deleted_at', null)
      if (result.error || !Array.isArray(result.data)) throw new Error(failure)
      const eligible = result.data.flatMap(note => {
        const encounter = object(note.clinical_encounters)
        const date = historyServiceDate(note.visit_date, encounter.encounter_date)
        const expected = note.visit_type === 'pain_evaluation_visit' ? 'pain_evaluation' : 'initial_evaluation'
        if (note.case_id !== caseId || note.episode_id !== previous.id || note.deleted_at || note.status !== 'finalized'
          || !['initial_visit', 'pain_evaluation_visit'].includes(note.visit_type)
          || encounter.case_id !== caseId || encounter.episode_id !== previous.id || encounter.deleted_at
          || encounter.status !== 'completed' || encounter.encounter_type !== expected || !date || date > cutoff) return []
        return [{ note, date }]
      }).sort((a, b) => b.date.localeCompare(a.date)
        || Number(b.note.visit_type === 'pain_evaluation_visit') - Number(a.note.visit_type === 'pain_evaluation_visit')
        || a.note.id.localeCompare(b.note.id))
      for (const { note, date } of eligible) {
        const intake = object(note.provider_intake)
        for (const section of missing) {
          if (Object.hasOwn(inherited, section)) continue
          const parsed = providerIntakeSchema.shape[section].safeParse(intake[section])
          if (!parsed.success) continue
          inherited[section] = parsed.data
          carriedSections.push({ section, episodeNumber: previous.episode_number, visitDate: date })
        }
      }
      if (carriedSections.length === missing.length) break
    }
    if (carriedSections.length === missing.length || prior.data.length < 500) break
  }
  if (!carriedSections.length) return unchanged
  return { data: { ...defaultProviderIntake, ...stored, ...inherited }, carriedSections }
}
