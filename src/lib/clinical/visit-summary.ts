import { CASE_STATUSES, LOCKED_STATUSES, type CaseStatus } from '@/lib/constants/case-status'
import { CLINICAL_ENCOUNTER_TYPES, CLINICAL_ENCOUNTER_STATUSES, type ClinicalEncounterType } from '@/lib/constants/clinical-encounter'
import type { Tables } from '@/types/database'
import { visitHref } from './visit-routes'

export const visitKindLabels: Record<ClinicalEncounterType, string> = {
  initial_evaluation: 'Initial Visit', pain_evaluation: 'Pain Evaluation',
  pain_follow_up: 'Pain Follow-Up', discharge: 'Discharge Summary',
}
export const encounterStatusLabels: Record<string, string> = {
  scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show',
}
export const modalityLabels: Record<string, string> = { in_person: 'In person', telehealth: 'Telehealth', phone: 'Phone', unknown: 'Modality not recorded' }
export type NoteState = 'Not started' | 'Intake in progress' | 'Not generated' | 'Generating' | 'Generation failed' | 'Draft' | 'Finalized' | 'Correction in progress' | 'Note status unavailable'
export type EpisodeInput = Pick<Tables<'care_episodes'>, 'id' | 'case_id' | 'episode_number' | 'status' | 'requires_pain_evaluation' | 'opened_at' | 'ended_at' | 'return_reason'>
export type EncounterInput = Pick<Tables<'clinical_encounters'>, 'id' | 'case_id' | 'episode_id' | 'encounter_type' | 'status' | 'encounter_date' | 'scheduled_start' | 'provider_id' | 'modality'>
export type NoteInput = {
  id: string; case_id: string; episode_id: string | null; encounter_id: string | null
  kind: string; status: string; visit_date: string | null; document_id: string | null; hasContent: boolean
}
export type CorrectionInput = Pick<Tables<'discharge_note_corrections'>, 'id' | 'case_id' | 'episode_id' | 'discharge_note_id' | 'status' | 'revision_number'>
export type WorkInput = { id: string; episode_id: string; status: string }
export type VisitAction = { label: string; href: string }
export type VisitSummary = {
  id: string; episodeId: string; encounterId: string | null; noteId: string | null; kind: ClinicalEncounterType
  encounterStatus: string | null; noteState: NoteState; serviceDate: string | null; scheduledStart: string | null
  provider: string; modality: string; revision: number | null; href: string | null; actionLabel: string
  unavailableReason: string | null; editable: boolean; group: 'work' | 'upcoming' | 'history'
}
export type DischargeBlocker = { id: string; label: string; href: string | null }
export type EpisodeSummary = EpisodeInput & {
  rows: VisitSummary[]; writable: boolean; evaluationPending: boolean; primary: VisitAction | null
  initialAction: VisitAction | null; painAction: VisitAction | null; multipleUnfinished: boolean
  canSchedule: boolean; dischargeAction: VisitAction; dischargeReason: string | null; blockers: DischargeBlocker[]
}
export type VisitOverview = {
  caseId: string; episodes: EpisodeSummary[]; warnings: string[]; providers: Array<{ id: string; display_name: string }>
  providerError: boolean; canStartReturn: boolean; returnReason: string | null; returnVisitsEnabled: boolean; hasGenerating: boolean
}
export type VisitOverviewInput = {
  caseId: string; caseStatus: string; episodes: EpisodeInput[]; encounters: EncounterInput[]; notes: NoteInput[]
  corrections: CorrectionInput[]; orders: WorkInput[]; appointments: WorkInput[]
  providers: Array<{ id: string; display_name: string }>; providerError: boolean; returnVisitsEnabled: boolean
  correctionAllowed: boolean | null; claimedEncounterIds: string[] | null
}
const knownKind = (kind: string): kind is ClinicalEncounterType => (CLINICAL_ENCOUNTER_TYPES as readonly string[]).includes(kind)
const knownStatus = (status: string) => (CLINICAL_ENCOUNTER_STATUSES as readonly string[]).includes(status)
function noteState(note: NoteInput | undefined, correction: boolean): NoteState {
  if (correction) return 'Correction in progress'
  if (!note) return 'Not started'
  if (note.status === 'generating') return 'Generating'
  if (note.status === 'failed') return 'Generation failed'
  if (note.status === 'finalized') return 'Finalized'
  if (note.status !== 'draft') return 'Note status unavailable'
  if (note.hasContent) return 'Draft'
  return note.kind === 'initial_evaluation' || note.kind === 'pain_evaluation' ? 'Intake in progress' : 'Not generated'
}

/** Pure projection; never creates or repairs a clinical record while browsing. */
export function buildVisitOverview(input: VisitOverviewInput): VisitOverview {
  const warnings: string[] = []
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message) }
  const episodes = input.episodes.filter(e => e.case_id === input.caseId)
  if (episodes.length !== input.episodes.length) warn('Some episodes have conflicting case ownership.')
  if (episodes.filter(e => e.status === 'active').length > 1) warn('More than one active episode was found. Review episode ownership before starting new care.')
  const episodeMap = new Map(episodes.map(e => [e.id, e]))
  const encounters = input.encounters.filter(e => {
    const valid = e.case_id === input.caseId && episodeMap.has(e.episode_id) && knownKind(e.encounter_type)
    if (!valid) warn('Some visits have an unknown type or episode association. Their status must be reviewed.')
    if (!knownStatus(e.status)) warn('Some visits have an unknown status.')
    return valid
  })
  const noteByEncounter = new Map<string, NoteInput[]>()
  const unlinked: NoteInput[] = []
  for (const note of input.notes) {
    if (note.case_id !== input.caseId || !note.episode_id || !episodeMap.has(note.episode_id) || !knownKind(note.kind)) {
      warn('Some notes have missing or conflicting episode ownership. No records were changed.')
      continue
    }
    if (episodeMap.get(note.episode_id)!.episode_number > 1 && note.kind === 'initial_evaluation') warn('A return episode contains an unexpected Initial Visit.')
    const candidates = note.encounter_id
      ? encounters.filter(e => e.id === note.encounter_id && e.episode_id === note.episode_id && e.encounter_type === note.kind)
      : encounters.filter(e => e.episode_id === note.episode_id && e.encounter_type === note.kind)
    if (candidates.length === 1) {
      const id = candidates[0].id
      noteByEncounter.set(id, [...(noteByEncounter.get(id) ?? []), note])
    } else if (!note.encounter_id && candidates.length === 0 && note.kind !== 'pain_follow_up') unlinked.push(note)
    else warn('Some notes cannot be matched unambiguously to their visits.')
  }
  const providers = new Map(input.providers.map(p => [p.id, p.display_name]))
  const rows: VisitSummary[] = []
  const appendRow = (episodeId: string, kind: ClinicalEncounterType, encounter?: EncounterInput, notes: NoteInput[] = []) => {
    const note = notes.length === 1 ? notes[0] : undefined
    const ambiguous = notes.length > 1
    if (ambiguous) warn('Multiple notes match the same visit. Review the records before making changes.')
    const corrections = note ? input.corrections.filter(c => c.discharge_note_id === note.id && c.episode_id === episodeId && c.case_id === input.caseId) : []
    const open = corrections.filter(c => c.status === 'open')
    if (open.length > 1 || (open.length && (kind !== 'discharge' || note?.status !== 'draft'))) warn('Discharge correction state is inconsistent. Review the record before making changes.')
    const state = ambiguous ? 'Note status unavailable' : noteState(note, open.length > 0)
    if (state === 'Note status unavailable') warn('Some note statuses are unavailable. Reload or review the affected records.')
    const episode = episodeMap.get(episodeId)!
    const caseWritable = (CASE_STATUSES as readonly string[]).includes(input.caseStatus) && !LOCKED_STATUSES.includes(input.caseStatus as CaseStatus)
    const ordinaryEditable = caseWritable && episode.status === 'active' && !['completed', 'cancelled', 'no_show'].includes(encounter?.status ?? '') && state !== 'Finalized' && state !== 'Generating'
    const correctionEditable = input.correctionAllowed === true && episode.status === 'discharged' && input.claimedEncounterIds !== null
    const editable = !ambiguous && state !== 'Note status unavailable' && (open.length > 0 ? correctionEditable : ordinaryEditable)
    const flagDisabled = kind === 'pain_follow_up' && !input.returnVisitsEnabled
    const href = ambiguous || state === 'Note status unavailable' || flagDisabled ? null : visitHref(input.caseId, episodeId, kind, encounter?.id)
    const group = open.length > 0 ? 'work' : encounter?.status === 'scheduled' ? 'upcoming' : episode.status !== 'active' || ['completed', 'cancelled', 'no_show'].includes(encounter?.status ?? '') || state === 'Finalized' ? 'history' : 'work'
    rows.push({
      id: encounter?.id ?? `note:${note?.id ?? `${episodeId}:${kind}`}`, episodeId, encounterId: encounter?.id ?? null, noteId: note?.id ?? null, kind,
      encounterStatus: encounter?.status ?? null, noteState: state,
      serviceDate: note?.visit_date ?? encounter?.encounter_date ?? null, scheduledStart: encounter?.scheduled_start ?? null,
      provider: encounter?.provider_id ? providers.get(encounter.provider_id) ?? 'Provider unavailable' : 'Provider not recorded',
      modality: modalityLabels[encounter?.modality ?? 'unknown'] ?? 'Modality unavailable',
      revision: corrections.length ? Math.max(...corrections.filter(c => c.status === 'finalized').map(c => c.revision_number), 0) || null : null,
      href, actionLabel: open.length ? editable ? 'Continue correction' : 'View correction' : editable ? note ? 'Continue' : 'Open' : 'View',
      unavailableReason: flagDisabled ? 'Follow-up access unavailable while return visits are disabled.' : open.length && (input.correctionAllowed === null || input.claimedEncounterIds === null) ? 'Correction availability could not be checked. Open the record to check access.' : open.length && input.claimedEncounterIds?.includes(encounter?.id ?? '') ? 'Invoice restrictions apply to correction finalization.' : ambiguous ? 'Visit association needs review.' : null,
      editable: editable && !flagDisabled, group,
    })
  }
  for (const encounter of encounters) appendRow(encounter.episode_id, encounter.encounter_type as ClinicalEncounterType, encounter, noteByEncounter.get(encounter.id))
  const noteOnlyGroups = new Map<string, NoteInput[]>()
  for (const note of unlinked) {
    const key = `${note.episode_id}:${note.kind}`
    noteOnlyGroups.set(key, [...(noteOnlyGroups.get(key) ?? []), note])
  }
  for (const notes of noteOnlyGroups.values()) appendRow(notes[0].episode_id!, notes[0].kind as ClinicalEncounterType, undefined, notes)
  for (const correction of input.corrections) {
    if (correction.case_id !== input.caseId || !input.notes.some(n => n.id === correction.discharge_note_id && n.episode_id === correction.episode_id)) warn('Some discharge corrections have conflicting note ownership.')
  }
  if (!(CASE_STATUSES as readonly string[]).includes(input.caseStatus) || episodes.some(e => !['active', 'discharged', 'cancelled'].includes(e.status))) warn('Case or episode status is unavailable.')
  const safe = warnings.length === 0
  if (!safe) for (const row of rows) { row.editable = false; row.actionLabel = row.noteState === 'Correction in progress' ? 'View correction' : 'View' }
  const sortedEpisodes = [...episodes].sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.episode_number - a.episode_number)
  const summaries: EpisodeSummary[] = sortedEpisodes.map(episode => {
    const episodeRows = rows.filter(r => r.episodeId === episode.id).sort((a, b) => {
      const aDate = a.group === 'upcoming' ? a.scheduledStart : a.serviceDate
      const bDate = b.group === 'upcoming' ? b.scheduledStart : b.serviceDate
      if (!aDate || !bDate) return Number(!aDate) - Number(!bDate) || a.id.localeCompare(b.id)
      return (a.group === 'upcoming' && b.group === 'upcoming' ? aDate.localeCompare(bDate) : bDate.localeCompare(aDate)) || a.id.localeCompare(b.id)
    })
    const writable = safe && episode.status === 'active' && !LOCKED_STATUSES.includes(input.caseStatus as CaseStatus)
    const evaluationPending = episode.requires_pain_evaluation && !episodeRows.some(r => r.kind === 'pain_evaluation' && r.encounterStatus === 'completed' && r.noteState === 'Finalized')
    const hasKind = (kind: ClinicalEncounterType) => episodeRows.some(r => r.kind === kind)
    const action = (label: string, kind: ClinicalEncounterType): VisitAction => ({ label, href: visitHref(input.caseId, episode.id, kind)! })
    const initialAction = writable && episode.episode_number === 1 && !hasKind('initial_evaluation') ? action('Start Initial Visit', 'initial_evaluation') : null
    const painAction = writable && !hasKind('pain_evaluation') ? action('Start Pain Evaluation', 'pain_evaluation') : null
    const unfinished = episodeRows.filter(r => r.editable && r.group === 'work' && r.href)
    const primary = writable && evaluationPending ? action('Complete Pain Evaluation', 'pain_evaluation') : unfinished.length === 1 ? { label: unfinished[0].kind === 'discharge' ? unfinished[0].noteState === 'Correction in progress' ? 'Continue correction' : 'Continue discharge' : `Continue ${visitKindLabels[unfinished[0].kind]}`, href: unfinished[0].href! } : unfinished.length === 0 ? initialAction ?? painAction : null
    const completedVisit = encounters.some(e => e.episode_id === episode.id && e.status === 'completed' && e.encounter_type !== 'discharge')
    const dischargeReason = !safe ? 'Resolve the record warnings before starting new work.' : !writable ? 'This episode is read-only.' : evaluationPending ? 'Finalize this episode’s pain evaluation first.' : !completedVisit ? 'Complete a clinical visit before preparing discharge.' : null
    const blockers: DischargeBlocker[] = encounters.filter(e => e.episode_id === episode.id && e.encounter_type !== 'discharge' && ['scheduled', 'in_progress'].includes(e.status)).map(e => ({ id: e.id, label: `${visitKindLabels[e.encounter_type as ClinicalEncounterType]} · ${encounterStatusLabels[e.status]}`, href: e.encounter_type === 'pain_follow_up' && !input.returnVisitsEnabled ? null : visitHref(input.caseId, episode.id, e.encounter_type as ClinicalEncounterType, e.id) }))
    for (const order of input.orders.filter(o => o.episode_id === episode.id && ['ordered', 'scheduled'].includes(o.status))) blockers.push({ id: order.id, label: 'Open procedure order', href: `/patients/${input.caseId}/procedures` })
    for (const appointment of input.appointments.filter(a => a.episode_id === episode.id && a.status === 'scheduled')) blockers.push({ id: appointment.id, label: 'Scheduled procedure', href: `/patients/${input.caseId}/procedures` })
    return { ...episode, rows: episodeRows, writable, evaluationPending, primary, initialAction, painAction, multipleUnfinished: unfinished.length > 1, canSchedule: writable && !evaluationPending && input.returnVisitsEnabled && !input.providerError, dischargeAction: action(hasKind('discharge') ? 'Open discharge' : 'Prepare discharge', 'discharge'), dischargeReason, blockers }
  })
  const latest = [...summaries].sort((a, b) => b.episode_number - a.episode_number)[0]
  const validDischarge = latest?.rows.some(r => r.kind === 'discharge' && r.noteState === 'Finalized' && r.encounterStatus === 'completed' && (r.serviceDate || r.scheduledStart))
  const canStartReturn = safe && input.returnVisitsEnabled && !input.providerError && !episodes.some(e => e.status === 'active') && ['active', 'closed', 'pending_settlement'].includes(input.caseStatus) && latest?.status === 'discharged' && Boolean(validDischarge)
  return { caseId: input.caseId, episodes: summaries, warnings, providers: input.providers, providerError: input.providerError, canStartReturn, returnReason: canStartReturn || episodes.some(e => e.status === 'active') ? null : !latest ? 'No care episode is available. Review case setup before starting a visit.' : !input.returnVisitsEnabled ? 'Return visits are currently disabled.' : 'A return visit requires a finalized discharge with a service date in the latest episode and an eligible case status.', returnVisitsEnabled: input.returnVisitsEnabled, hasGenerating: rows.some(r => r.noteState === 'Generating') }
}
