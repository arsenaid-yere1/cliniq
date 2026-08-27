export const START_SEPARATE_SERIES_LABEL = 'Start a separate treatment series'

export type ProcedureSeriesOption = {
  id: string
  relationship: 'current' | 'prior'
  episodeId: string
  episodeNumber: number
  seriesNumber: number
  procedureType: string
  latestProcedureNumber: number
  hasOpenOrder: boolean
}

export type ProcedureSeriesCandidate = Omit<ProcedureSeriesOption, 'relationship' | 'latestProcedureNumber' | 'hasOpenOrder'> & {
  status: string
  deletedAt: string | null
  procedureNumbers: Array<number | null>
  orderStatuses: Array<{ status: string; deletedAt: string | null }>
}

export function buildProcedureSeriesOptions(candidates: ProcedureSeriesCandidate[], currentEpisodeId: string) {
  return candidates.flatMap<ProcedureSeriesOption>((candidate) => {
    const performed = candidate.procedureNumbers.filter((value): value is number => value !== null)
    const latestProcedureNumber = performed.length ? Math.max(...performed) : 0
    const hasOpenOrder = candidate.orderStatuses.some((order) =>
      order.deletedAt === null && (order.status === 'ordered' || order.status === 'scheduled'))
    const relationship = candidate.episodeId === currentEpisodeId ? 'current' : 'prior'
    const eligible = candidate.deletedAt === null && latestProcedureNumber > 0 && (
      relationship === 'current'
        ? candidate.status === 'active' && !hasOpenOrder
        : candidate.status === 'completed'
    )
    return eligible ? [{ ...candidate, relationship, latestProcedureNumber, hasOpenOrder }] : []
  })
}

export function buildPriorProcedureSeriesLabel({
  episodeNumber,
  procedureType,
  seriesNumber,
}: {
  episodeNumber: number
  procedureType: string
  seriesNumber: number
}) {
  return `Episode ${episodeNumber} · ${procedureType.toUpperCase()} series ${seriesNumber}`
}

export function buildPriorCourseOptionLabel(seriesLabel: string) {
  return `Continue from prior episode — ${seriesLabel}`
}

export function buildCurrentSeriesOptionLabel(option: ProcedureSeriesOption) {
  return `Add procedure #${option.latestProcedureNumber + 1} to current active series — ${option.procedureType.toUpperCase()} series ${option.seriesNumber}`
}

export function buildSeriesOptionLabel(option: ProcedureSeriesOption) {
  return option.relationship === 'current'
    ? buildCurrentSeriesOptionLabel(option)
    : buildPriorCourseOptionLabel(buildPriorProcedureSeriesLabel({
      episodeNumber: option.episodeNumber,
      procedureType: option.procedureType,
      seriesNumber: option.seriesNumber,
    }))
}

export function getSeriesRelationshipDescription(option?: ProcedureSeriesOption) {
  if (option?.relationship === 'current') return `Keeps the existing series history and uses procedure #${option.latestProcedureNumber + 1}.`
  if (option?.relationship === 'prior') return 'Begins a new series in this episode while retaining lineage to the prior course.'
  return 'Begins an independent treatment series.'
}
