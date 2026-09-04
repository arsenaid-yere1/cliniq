export const START_SEPARATE_SERIES_LABEL = 'Start a separate treatment series'

export type ProcedureSeriesRelationship = 'current' | 'prior' | 'separate'
export type ProcedureSeriesUnavailableReason = 'deleted' | 'no_performed_procedures' | 'current_not_active' | 'current_has_open_order' | 'prior_not_completed'

export type ProcedureSeriesChoice = {
  id: string
  relationship: 'current' | 'prior'
  episodeId: string
  episodeNumber: number
  seriesNumber: number
  procedureType: string
  latestProcedureNumber: number
  hasOpenOrder: boolean
  eligible: boolean
  unavailableReason: ProcedureSeriesUnavailableReason | null
}
export type ProcedureSeriesOption = ProcedureSeriesChoice

export type ProcedureSeriesCandidate = Omit<ProcedureSeriesChoice, 'relationship' | 'latestProcedureNumber' | 'hasOpenOrder' | 'eligible' | 'unavailableReason'> & {
  status: string
  deletedAt: string | null
  procedureNumbers: Array<number | null>
  orderStatuses: Array<{ status: string; deletedAt: string | null }>
}

export function buildProcedureSeriesChoices(candidates: ProcedureSeriesCandidate[], currentEpisodeId: string) {
  return candidates.map<ProcedureSeriesChoice>((candidate) => {
    const performed = candidate.procedureNumbers.filter((value): value is number => value !== null)
    const latestProcedureNumber = performed.length ? Math.max(...performed) : 0
    const hasOpenOrder = candidate.orderStatuses.some((order) => order.deletedAt === null && ['ordered', 'scheduled'].includes(order.status))
    const relationship = candidate.episodeId === currentEpisodeId ? 'current' : 'prior'
    let unavailableReason: ProcedureSeriesUnavailableReason | null = null
    if (candidate.deletedAt !== null) unavailableReason = 'deleted'
    else if (latestProcedureNumber === 0) unavailableReason = 'no_performed_procedures'
    else if (relationship === 'current' && candidate.status !== 'active') unavailableReason = 'current_not_active'
    else if (relationship === 'current' && hasOpenOrder) unavailableReason = 'current_has_open_order'
    else if (relationship === 'prior' && candidate.status !== 'completed') unavailableReason = 'prior_not_completed'
    return { ...candidate, relationship, latestProcedureNumber, hasOpenOrder, eligible: unavailableReason === null, unavailableReason }
  }).sort((left, right) => {
    if (left.relationship !== right.relationship) return left.relationship === 'current' ? -1 : 1
    if (left.eligible !== right.eligible) return left.eligible ? -1 : 1
    const reasonRank: Record<ProcedureSeriesUnavailableReason, number> = {
      current_has_open_order: 0, no_performed_procedures: 1, current_not_active: 2,
      prior_not_completed: 2, deleted: 3,
    }
    if (left.unavailableReason && right.unavailableReason && reasonRank[left.unavailableReason] !== reasonRank[right.unavailableReason]) {
      return reasonRank[left.unavailableReason] - reasonRank[right.unavailableReason]
    }
    return right.episodeNumber - left.episodeNumber || right.seriesNumber - left.seriesNumber
  })
}

export const buildProcedureSeriesOptions = buildProcedureSeriesChoices

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
  return option.relationship === 'current' ? buildCurrentSeriesOptionLabel(option) : buildPriorCourseOptionLabel(buildPriorProcedureSeriesLabel(option))
}

export function getSeriesRelationshipDescription(option?: ProcedureSeriesChoice) {
  if (option?.relationship === 'current') return `Keeps the existing series history and uses procedure #${option.latestProcedureNumber + 1}.`
  if (option?.relationship === 'prior') return 'Begins a new series in this episode while retaining lineage to the prior course.'
  return 'Begins an independent treatment series.'
}

export function getSeriesUnavailableMessage(reason: ProcedureSeriesUnavailableReason | null) {
  switch (reason) {
    case 'deleted': return 'This series is no longer available.'
    case 'no_performed_procedures': return 'No performed procedure has been recorded in this series.'
    case 'current_not_active': return 'This current-episode series is not active.'
    case 'current_has_open_order': return 'This series already has an open procedure order.'
    case 'prior_not_completed': return 'This prior-episode series is not completed.'
    default: return null
  }
}

export function buildSavedSeriesRelationshipLabel(relationship: ProcedureSeriesRelationship | 'unknown', selected?: { episodeNumber: number; seriesNumber: number; procedureType: string } | null) {
  if (relationship === 'current' && selected) return `Current series — ${selected.procedureType.toUpperCase()} series ${selected.seriesNumber}`
  if (relationship === 'prior' && selected) return `Continued from ${buildPriorProcedureSeriesLabel(selected)}`
  if (relationship === 'separate') return START_SEPARATE_SERIES_LABEL
  return 'Series relationship unavailable for legacy order'
}
