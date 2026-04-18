import { differenceInYears } from 'date-fns'

export function computeAgeAtDate(
  dob: string | null | undefined,
  anchor: string | null | undefined,
): number | null {
  if (!dob || !anchor) return null
  const dobDate = new Date(`${dob.slice(0, 10)}T00:00:00`)
  const anchorDate = new Date(`${anchor.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(dobDate.getTime()) || Number.isNaN(anchorDate.getTime())) return null
  const years = differenceInYears(anchorDate, dobDate)
  return years < 0 ? null : years
}

export function pickVisitAnchor(
  visitDate: string | null | undefined,
  finalizedAt: string | null | undefined,
): string | null {
  if (visitDate) return visitDate.slice(0, 10)
  if (finalizedAt) return finalizedAt.slice(0, 10)
  return new Date().toISOString().slice(0, 10)
}
