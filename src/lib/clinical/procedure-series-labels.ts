export const START_SEPARATE_SERIES_LABEL = 'Start a separate treatment series'

export type ProcedureSeriesRelationship = 'current' | 'prior' | 'separate' | 'reopen'
export type ProcedureSeriesUnavailableReason = 'deleted' | 'no_performed_procedures' | 'current_not_active' | 'current_has_open_order' | 'prior_not_completed' | 'episode_not_writable'

export type ProcedureSeriesChoice = {
  id: string
  relationship: 'current' | 'prior' | 'reopen'
  episodeId: string
  episodeNumber: number
  seriesNumber: number
  procedureType: string
  latestProcedureNumber: number
  blockingOrderId?: string | null
  hasOpenOrder: boolean
  eligible: boolean
  unavailableReason: ProcedureSeriesUnavailableReason | null
}
export type ProcedureSeriesOption = ProcedureSeriesChoice

export function buildPriorProcedureSeriesLabel({ episodeNumber, procedureType, seriesNumber }: { episodeNumber: number; procedureType: string; seriesNumber: number }) {
  return `Episode ${episodeNumber} · ${procedureType.toUpperCase()} series ${seriesNumber}`
}

export function buildPriorCourseOptionLabel(seriesLabel: string) {
  return `Continue from prior episode — ${seriesLabel}`
}

export function buildCurrentSeriesOptionLabel(option: ProcedureSeriesChoice) {
  return `Add procedure #${option.latestProcedureNumber + 1} to current active series — ${option.procedureType.toUpperCase()} series ${option.seriesNumber}`
}

export function buildSeriesOptionLabel(option: ProcedureSeriesChoice) {
  if (option.relationship === 'reopen') return `Reopen and continue this series — ${option.procedureType.toUpperCase()} series ${option.seriesNumber} · procedure #${option.latestProcedureNumber + 1}`
  return option.relationship === 'current' ? buildCurrentSeriesOptionLabel(option) : buildPriorCourseOptionLabel(buildPriorProcedureSeriesLabel(option))
}

export function getSeriesRelationshipDescription(option?: ProcedureSeriesChoice) {
  if (option?.relationship === 'reopen') return `Reopens this completed series and adds an order for procedure #${option.latestProcedureNumber + 1}. Existing procedures and notes are preserved.`
  if (option?.relationship === 'current') return `Keeps the existing series history and uses procedure #${option.latestProcedureNumber + 1}.`
  if (option?.relationship === 'prior') return 'Begins a new series in this episode while retaining lineage to the prior course.'
  return 'Begins an independent treatment series.'
}

export function getSeriesUnavailableMessage(reason: ProcedureSeriesUnavailableReason | null) {
  switch (reason) {
    case 'episode_not_writable': return 'Reactivate this episode and finish any open discharge correction before ordering.'
    case 'deleted': return 'This series is no longer available.'
    case 'no_performed_procedures': return 'No performed procedure has been recorded in this series.'
    case 'current_not_active': return 'This current-episode series is not active.'
    case 'current_has_open_order': return 'This series already has an open procedure order.'
    case 'prior_not_completed': return 'This prior-episode series is not completed.'
    default: return null
  }
}

export function buildSavedSeriesRelationshipLabel(relationship: ProcedureSeriesRelationship | 'unknown', selected?: { episodeNumber: number; seriesNumber: number; procedureType: string } | null) {
  if (relationship === 'reopen' && selected) return `Reopened series — ${selected.procedureType.toUpperCase()} series ${selected.seriesNumber}`
  if (relationship === 'current' && selected) return `Current series — ${selected.procedureType.toUpperCase()} series ${selected.seriesNumber}`
  if (relationship === 'prior' && selected) return `Continued from ${buildPriorProcedureSeriesLabel(selected)}`
  if (relationship === 'separate') return START_SEPARATE_SERIES_LABEL
  return 'Series relationship unavailable for legacy order'
}
