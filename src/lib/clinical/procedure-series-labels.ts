export const START_SEPARATE_SERIES_LABEL = 'Start a separate treatment series'

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
