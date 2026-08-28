export type EncounterOrder = {
  id: string
  completed_at: string | null
  encounter_date: string | null
  scheduled_start: string | null
  created_at: string
  provider_id: string | null
}

export function encounterTimestamp(encounter: EncounterOrder) {
  return encounter.completed_at
    ?? (encounter.encounter_date ? `${encounter.encounter_date}T00:00:00.000Z` : null)
    ?? encounter.scheduled_start
    ?? encounter.created_at
}

export function isEarlierEncounter(candidate: EncounterOrder, current: EncounterOrder) {
  const candidateTime = encounterTimestamp(candidate)
  const currentTime = encounterTimestamp(current)
  return candidateTime < currentTime || (candidateTime === currentTime && candidate.id < current.id)
}
