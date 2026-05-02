'use server'

import { createClient } from '@/lib/supabase/server'
import { buildTrajectoryForValidator } from '@/lib/claude/pain-trajectory'
import {
  validateDischargeTrajectoryConsistency,
  type TrajectoryValidationResult,
} from '@/lib/claude/pain-trajectory-validator'
import {
  dischargeNoteSections,
  type DischargeNoteSection,
  type DischargeNoteResult,
} from '@/lib/validations/discharge-note'
import type { DischargeNoteInputData } from '@/lib/claude/generate-discharge-note'
import { gatherDischargeNoteSourceData } from '@/actions/discharge-notes'

interface RefreshOptions {
  // When supplied, validator runs against this merged shape (for the regen
  // case where the freshly-regenerated section is not yet persisted on the
  // row). When omitted, validator reads section text straight from the row.
  mergedSections?: Partial<Record<DischargeNoteSection, string>>
  // When supplied, the inner LLM payload is merged into raw_ai_response.raw
  // for the named sections. Used by regen + generate to keep the audit
  // payload aligned with the persisted text.
  rawSectionsToMerge?: Partial<Record<DischargeNoteSection, unknown>>
  // Pre-gathered inputData. When omitted, the helper calls gather itself.
  // Generate + regen pass this to avoid a redundant gather; save paths
  // typically let the helper handle it.
  inputData?: DischargeNoteInputData
  userId?: string
}

interface RefreshResult {
  validation: TrajectoryValidationResult
  painTrajectoryText: string | null
}

// Single source of truth for keeping discharge-note trajectory state in sync
// with the row's section text and discharge-vitals columns. Reloads the note,
// gathers source data (unless a caller already gathered), re-runs the
// validator over either the row text or a caller-supplied merged shape,
// persists all six trajectory fields atomically (3 columns + 3 inside
// raw_ai_response). Used by generate, regen, saveDischargeNote, and
// saveDischargeVitals so the wrapper is assembled identically across paths.
export async function refreshDischargeTrajectory(
  caseId: string,
  noteId: string,
  opts: RefreshOptions = {},
): Promise<{ data?: RefreshResult; error?: string }> {
  const supabase = await createClient()

  // Select all columns the helper needs (vitals + trajectory + every section
  // text). Cast at the boundary because building the column list dynamically
  // confuses the typed Supabase return inference.
  const { data: rawNote, error: fetchErr } = await supabase
    .from('discharge_notes')
    .select('*')
    .eq('id', noteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (fetchErr || !rawNote) return { error: 'Note not found' }
  const note = rawNote as Record<string, unknown>

  let inputData = opts.inputData
  if (!inputData) {
    const visitDate = (note.visit_date as string | null) ?? new Date().toISOString().slice(0, 10)
    const preservedVitals: DischargeNoteInputData['dischargeVitals'] = {
      bp_systolic: note.bp_systolic as number | null,
      bp_diastolic: note.bp_diastolic as number | null,
      heart_rate: note.heart_rate as number | null,
      respiratory_rate: note.respiratory_rate as number | null,
      temperature_f: note.temperature_f as number | null,
      spo2_percent: note.spo2_percent as number | null,
      pain_score_min: note.pain_score_min as number | null,
      pain_score_max: note.pain_score_max as number | null,
    }
    const gathered = await gatherDischargeNoteSourceData(supabase, caseId, visitDate, preservedVitals)
    if (gathered.error || !gathered.data) {
      return { error: gathered.error ?? 'Failed to gather source data' }
    }
    inputData = gathered.data
  }

  const trajectory = buildTrajectoryForValidator(inputData)

  const sectionTextSources = Object.fromEntries(
    dischargeNoteSections.map((s) => [
      s,
      opts.mergedSections?.[s] ?? ((note[s as keyof typeof note] as string | null) ?? ''),
    ]),
  ) as Record<DischargeNoteSection, string>
  const validation = validateDischargeTrajectoryConsistency(
    sectionTextSources as unknown as DischargeNoteResult,
    trajectory,
  )

  const existingRaw = note.raw_ai_response as { raw?: Record<string, unknown> | null } | null
  const mergedInnerRaw: Record<string, unknown> = {
    ...((existingRaw?.raw as Record<string, unknown> | null) ?? {}),
    ...(opts.rawSectionsToMerge ?? {}),
  }
  const wrappedRawResponse = {
    raw: mergedInnerRaw,
    trajectory_warnings: validation.warnings,
    discharge_readings_found: validation.dischargeReadingsFound,
    pain_trajectory_text: inputData.painTrajectoryText,
    discharge_visit_pain_display: inputData.dischargeVisitPainDisplay,
    discharge_visit_pain_estimated: inputData.dischargeVisitPainEstimated,
  }

  const update: Record<string, unknown> = {
    raw_ai_response: wrappedRawResponse,
    pain_trajectory_text: inputData.painTrajectoryText,
    discharge_pain_estimate_min: inputData.dischargePainEstimateMin,
    discharge_pain_estimate_max: inputData.dischargePainEstimateMax,
    discharge_pain_estimated: inputData.dischargeVisitPainEstimated,
  }
  if (opts.userId) update.updated_by_user_id = opts.userId

  const { error: updErr } = await supabase
    .from('discharge_notes')
    .update(update)
    .eq('id', noteId)
  if (updErr) return { error: 'Failed to refresh trajectory' }

  if (validation.warnings.length > 0) {
    console.warn('[discharge-note] trajectory refresh warnings', {
      caseId,
      noteId,
      warnings: validation.warnings,
    })
  }

  return {
    data: {
      validation,
      painTrajectoryText: inputData.painTrajectoryText ?? null,
    },
  }
}
