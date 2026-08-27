export function encounterDateFromLocalDateTime(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(value)
  return match?.[1] ?? null
}

export function alignTelehealthConsentToEncounterDate(
  consentAt: string | null | undefined,
  encounterDate: string | null | undefined,
  capturedAt = new Date().toISOString(),
): string {
  const timestamp = consentAt ?? capturedAt
  if (!encounterDate) return timestamp

  const timeSeparator = timestamp.indexOf('T')
  const timeAndOffset = timeSeparator >= 0
    ? timestamp.slice(timeSeparator)
    : 'T12:00:00.000Z'

  return `${encounterDate}${timeAndOffset}`
}
