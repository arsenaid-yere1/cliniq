type BillableEncounter = {
  encounter_type: string
  encounter_date: string | null
  completed_at: string | null
}

export function resolveEncounterServiceDate(
  encounter: BillableEncounter,
  options: {
    dischargeVisitDate?: string | null
    fallbackDate: string
  },
): string {
  if (encounter.encounter_type === 'discharge' && options.dischargeVisitDate) {
    return options.dischargeVisitDate
  }

  return encounter.encounter_date
    ?? encounter.completed_at?.slice(0, 10)
    ?? options.fallbackDate
}
