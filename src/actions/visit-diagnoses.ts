'use server'

import { createClient } from '@/lib/supabase/server'
import { normalizeVisitDiagnoses } from '@/lib/clinical/visit-diagnoses'
import { encounterTimestamp, isEarlierEncounter } from '@/lib/clinical/visit-diagnosis-history'
import { parseIvnDiagnoses } from '@/lib/icd10/parse-ivn-diagnoses'
import { buildCurrentEncounterDiagnosisSource } from '@/lib/clinical/current-visit-diagnosis-source'
import { suggestVisitDiagnoses } from '@/lib/claude/suggest-visit-diagnoses'
import type { VisitDiagnosis } from '@/lib/validations/clinical-encounter'

export type EncounterDiagnosisSuggestion = {
  icd10_code: string
  description: string
  source_label: string
  source_type: 'initial_visit' | 'pain_follow_up' | 'procedure'
  source_id: string
  source_date: string | null
  provider_label: string | null
}

export type CurrentVisitDiagnosisSuggestionResult = {
  data: VisitDiagnosis[]
  error: string | null
  status: 'ready' | 'insufficient_source' | 'error'
}

export async function suggestCurrentEncounterDiagnoses(
  caseId: string,
  encounterId: string,
): Promise<CurrentVisitDiagnosisSuggestionResult> {
  const failed = (error: string): CurrentVisitDiagnosisSuggestionResult => ({ data: [], error, status: 'error' })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return failed('Not authenticated')

  const [{ data: encounter, error: encounterError }, { data: actor, error: actorError }] = await Promise.all([
    supabase.from('clinical_encounters')
      .select('id,case_id,encounter_type,provider_id,status,reason_for_visit,provider_intake,patient_reported_pain_min,patient_reported_pain_max')
      .eq('id', encounterId)
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase.from('users')
      .select('role,is_active')
      .eq('id', user.id)
      .maybeSingle(),
  ])

  if (encounterError || !encounter) return failed('Visit not found')
  if (actorError || !actor?.is_active) return failed('Active user account required')
  if (['completed', 'cancelled', 'no_show'].includes(encounter.status)) {
    return failed('Diagnosis suggestions are unavailable for a locked encounter')
  }

  let authorized = actor.role === 'admin'
  if (!authorized && actor.role === 'provider') {
    const { data: providerProfile } = await supabase.from('provider_profiles')
      .select('id')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle()
    authorized = providerProfile?.id === encounter.provider_id
  }
  if (!authorized) return failed('Only the encounter provider or an administrator may request diagnosis suggestions')

  let evaluationProviderIntake: unknown
  if (encounter.encounter_type === 'initial_evaluation' || encounter.encounter_type === 'pain_evaluation') {
    const { data: note, error: noteError } = await supabase.from('initial_visit_notes')
      .select('provider_intake')
      .eq('case_id', caseId)
      .eq('encounter_id', encounterId)
      .is('deleted_at', null)
      .maybeSingle()
    if (noteError || !note) return failed('Unable to load current visit intake')
    evaluationProviderIntake = note.provider_intake
  }

  const source = buildCurrentEncounterDiagnosisSource(encounter, evaluationProviderIntake)
  if (!source) return { data: [], error: null, status: 'insufficient_source' }

  const result = await suggestVisitDiagnoses(source)
  if (result.error || !result.data) return failed(result.error ?? 'Unable to suggest diagnoses from this visit')
  return { data: result.data, error: null, status: 'ready' }
}

export async function getEncounterDiagnosisSuggestions(caseId: string, encounterId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated', data: [] as EncounterDiagnosisSuggestion[] }

  const { data: current, error: currentError } = await supabase.from('clinical_encounters')
    .select('id,case_id,episode_id,completed_at,encounter_date,scheduled_start,created_at,provider_id')
    .eq('id', encounterId)
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle()
  if (currentError || !current) {
    return { error: 'Visit not found', data: [] as EncounterDiagnosisSuggestion[] }
  }

  const [{ data: episodeEncounters, error: encountersError }, { data: procedures, error: proceduresError }] = await Promise.all([
    supabase.from('clinical_encounters')
      .select('id,completed_at,encounter_date,scheduled_start,created_at,provider_id')
      .eq('case_id', caseId)
      .eq('episode_id', current.episode_id)
      .neq('id', encounterId)
      .is('deleted_at', null),
    supabase.from('procedures')
      .select('id,procedure_type,procedure_date,diagnoses,provider_profile_id')
      .eq('case_id', caseId)
      .eq('episode_id', current.episode_id)
      .eq('status', 'performed')
      .is('deleted_at', null),
  ])
  if (encountersError || proceduresError) {
    return { error: 'Unable to load diagnosis history', data: [] as EncounterDiagnosisSuggestion[] }
  }

  const earlierEncounters = (episodeEncounters ?? [])
    .filter((encounter) => isEarlierEncounter(encounter, current))
    .sort((left, right) => {
      const timeOrder = encounterTimestamp(right).localeCompare(encounterTimestamp(left))
      return timeOrder || right.id.localeCompare(left.id)
    })
  const earlierEncounterIds = earlierEncounters.map((encounter) => encounter.id)

  const [initialNotesRes, followUpNotesRes] = earlierEncounterIds.length > 0
    ? await Promise.all([
        supabase.from('initial_visit_notes')
          .select('id,encounter_id,visit_type,visit_date,diagnoses,diagnoses_snapshot')
          .in('encounter_id', earlierEncounterIds)
          .eq('status', 'finalized')
          .is('deleted_at', null),
        supabase.from('pain_follow_up_notes')
          .select('id,encounter_id,finalized_at,diagnoses,diagnoses_snapshot')
          .in('encounter_id', earlierEncounterIds)
          .eq('status', 'finalized')
          .is('deleted_at', null),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]
  if (initialNotesRes.error || followUpNotesRes.error) {
    return { error: 'Unable to load diagnosis history', data: [] as EncounterDiagnosisSuggestion[] }
  }

  const providerIds = new Set<string>()
  for (const encounter of earlierEncounters) if (encounter.provider_id) providerIds.add(encounter.provider_id)
  for (const procedure of procedures ?? []) {
    if (procedure.provider_profile_id) providerIds.add(procedure.provider_profile_id)
  }
  const { data: providers } = providerIds.size > 0
    ? await supabase.from('provider_profiles').select('id,display_name,credentials')
        .in('id', [...providerIds]).is('deleted_at', null)
    : { data: [] }
  const providerLabels = new Map((providers ?? []).map((provider) => [
    provider.id,
    [provider.display_name, provider.credentials].filter(Boolean).join(', '),
  ]))
  const encounterById = new Map(earlierEncounters.map((encounter) => [encounter.id, encounter]))
  const suggestions: EncounterDiagnosisSuggestion[] = []

  const add = (args: Omit<EncounterDiagnosisSuggestion, 'icd10_code' | 'description'>, raw: unknown, text?: string | null) => {
    let diagnoses: VisitDiagnosis[] = []
    try {
      diagnoses = normalizeVisitDiagnoses(raw)
    } catch {
      diagnoses = []
    }
    if (diagnoses.length === 0 && text) diagnoses = normalizeVisitDiagnoses(parseIvnDiagnoses(text))
    for (const diagnosis of diagnoses) suggestions.push({ ...args, ...diagnosis })
  }

  for (const note of initialNotesRes.data ?? []) {
    const encounter = encounterById.get(note.encounter_id)
    const providerLabel = encounter?.provider_id ? providerLabels.get(encounter.provider_id) ?? null : null
    const visitLabel = note.visit_type === 'pain_evaluation_visit' ? 'Pain evaluation' : 'Initial visit'
    add({
      source_label: `${visitLabel}${note.visit_date ? ` · ${note.visit_date}` : ''}${providerLabel ? ` · ${providerLabel}` : ''}`,
      source_type: 'initial_visit',
      source_id: note.id,
      source_date: note.visit_date,
      provider_label: providerLabel,
    }, note.diagnoses_snapshot, note.diagnoses)
  }

  for (const note of followUpNotesRes.data ?? []) {
    const encounter = encounterById.get(note.encounter_id)
    const providerLabel = encounter?.provider_id ? providerLabels.get(encounter.provider_id) ?? null : null
    const sourceDate = encounter?.encounter_date ?? note.finalized_at?.slice(0, 10) ?? null
    add({
      source_label: `Pain follow-up${sourceDate ? ` · ${sourceDate}` : ''}${providerLabel ? ` · ${providerLabel}` : ''}`,
      source_type: 'pain_follow_up',
      source_id: note.id,
      source_date: sourceDate,
      provider_label: providerLabel,
    }, note.diagnoses_snapshot, note.diagnoses)
  }

  const currentTimestamp = encounterTimestamp(current)
  for (const procedure of (procedures ?? []).filter((item) => `${item.procedure_date}T00:00:00.000Z` <= currentTimestamp)) {
    const providerLabel = procedure.provider_profile_id
      ? providerLabels.get(procedure.provider_profile_id) ?? null
      : null
    add({
      source_label: `${procedure.procedure_type} procedure · ${procedure.procedure_date}${providerLabel ? ` · ${providerLabel}` : ''}`,
      source_type: 'procedure',
      source_id: procedure.id,
      source_date: procedure.procedure_date,
      provider_label: providerLabel,
    }, procedure.diagnoses)
  }

  const seen = new Set<string>()
  return {
    data: suggestions.filter((suggestion) => {
      const key = suggestion.icd10_code.toUpperCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
    error: null,
  }
}
