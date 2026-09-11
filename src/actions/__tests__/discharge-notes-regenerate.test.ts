import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createMockSupabase, createMockQueryBuilder, mockTableResults, type MockSupabaseClient } from '@/test-utils/supabase-mock'
import { TEST_CASE_ID } from '@/test-utils/fixtures'

// ---- Mocks ----

let mockSupabase: MockSupabaseClient

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockSupabase),
}))

// Spy on the trajectory builder so we can assert what dischargeVitals shape
// was threaded into it. Real implementation runs; we just intercept call args.
vi.mock('@/lib/claude/pain-trajectory', async () => {
  const actual = await vi.importActual<typeof import('@/lib/claude/pain-trajectory')>(
    '@/lib/claude/pain-trajectory',
  )
  return {
    ...actual,
    buildDischargePainTrajectory: vi.fn(actual.buildDischargePainTrajectory),
  }
})

// Stub the AI section regenerator so the test does not require an Anthropic
// client. The action's wiring of dischargeVitals into the gatherer happens
// before this call, so the canned response is irrelevant to the assertion.
vi.mock('@/lib/claude/generate-discharge-note', async () => {
  const actual = await vi.importActual<typeof import('@/lib/claude/generate-discharge-note')>(
    '@/lib/claude/generate-discharge-note',
  )
  return {
    ...actual,
    generateDischargeNoteFromData: vi.fn(async () => ({ data: { plan_and_recommendations: 'Changed plan', patient_education: 'New education' }, rawResponse: {} })),
    regenerateDischargeNoteSection: vi.fn(async () => ({ data: 'regen text', rawResponse: {} })),
  }
})

// Skip the case-status guard so we don't have to mock it as a Supabase chain.
vi.mock('@/actions/case-status', () => ({
  assertCaseNotClosed: vi.fn(async () => ({ error: null })),
  autoAdvanceFromIntake: vi.fn(async () => ({ error: null })),
}))

// ---- SUT ----

import { generateDischargeNote, regenerateDischargeNoteSectionAction } from '../discharge-notes'
import { generateDischargeNoteFromData } from '@/lib/claude/generate-discharge-note'
import { buildDischargePainTrajectory } from '@/lib/claude/pain-trajectory'

// ---- Tests ----

describe('regenerateDischargeNoteSectionAction — dischargeVitals wiring', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase()
    vi.clearAllMocks()
  })

  it('threads provider-entered discharge pain into buildDischargePainTrajectory', async () => {
    // Stub draft note row with provider-entered discharge pain (pain_score_max=2).
    // Procedures are configured separately so the -2 fallback would yield 4 if
    // the wiring were broken — making the assertion strict.
    const noteRow = {
      id: 'note-id',
      visit_date: '2026-04-27',
      bp_systolic: 120,
      bp_diastolic: 80,
      heart_rate: 72,
      respiratory_rate: 16,
      temperature_f: 98.6,
      spo2_percent: 99,
      pain_score_min: 1,
      pain_score_max: 2,
      tone_hint: null,
      subjective: 'old subjective',
      objective_vitals: '',
      objective_general: '',
      objective_cervical: '',
      objective_lumbar: '',
      objective_neurological: '',
      diagnoses: '',
      assessment: '',
      plan_and_recommendations: '',
      patient_education: '',
      prognosis: '',
      clinician_disclaimer: '',
    }

    const caseRow = {
      case_number: 'C-1',
      accident_type: null,
      accident_date: null,
      assigned_provider_id: null,
      patient: {
        first_name: 'A',
        last_name: 'B',
        date_of_birth: null,
        gender: null,
      },
    }

    // Single-procedure case with pain_score_max=6. With dischargeVitals=null,
    // trajectory builder would produce dischargeEstimate of 4 (latest minus 2).
    // With the wiring fix, it produces 2 (provider value verbatim).
    const procedureRow = {
      id: 'proc-1',
      procedure_date: '2026-04-20',
      procedure_name: 'PRP',
      procedure_number: 1,
      injection_site: null,
      sites: [],
      diagnoses: [],
    }
    const procedureVitalsRow = {
      procedure_id: 'proc-1',
      bp_systolic: null,
      bp_diastolic: null,
      heart_rate: null,
      respiratory_rate: null,
      temperature_f: null,
      spo2_percent: null,
      pain_score_min: 5,
      pain_score_max: 6,
    }

    mockTableResults(mockSupabase, {
      care_episodes: {
        data: {
          id: '22222222-2222-4222-8222-222222222222',
          case_id: TEST_CASE_ID,
          episode_number: 1,
          status: 'active',
          opened_at: '2026-01-01T00:00:00.000Z',
          discharged_at: null,
          discharge_note_id: null,
          deleted_at: null,
        },
        error: null,
      },
      discharge_notes: { data: noteRow, error: null },
      cases: { data: caseRow, error: null },
      procedures: { data: [procedureRow], error: null },
      vital_signs: { data: [procedureVitalsRow], error: null },
      case_summaries: { data: null, error: null },
      initial_visit_notes: { data: null, error: null },
      pt_extractions: { data: null, error: null },
      pain_management_extractions: { data: null, error: null },
      mri_extractions: { data: [], error: null },
      chiro_extractions: { data: null, error: null },
      clinic_settings: { data: null, error: null },
      provider_profiles: { data: null, error: null },
    })

    const result = await regenerateDischargeNoteSectionAction(TEST_CASE_ID, 'subjective')

    // Action must succeed
    expect(result.error).toBeUndefined()

    // Trajectory builder must have been called with the provider-entered
    // discharge vitals on the dischargeVitals field — proves the regression
    // fix at src/actions/discharge-notes.ts:1061 is in place.
    expect(buildDischargePainTrajectory).toHaveBeenCalled()
    const builderCall = (buildDischargePainTrajectory as unknown as Mock).mock.calls[0][0]
    expect(builderCall.dischargeVitals).not.toBeNull()
    expect(builderCall.dischargeVitals.pain_score_min).toBe(1)
    expect(builderCall.dischargeVitals.pain_score_max).toBe(2)

    // And the resulting trajectory exposes the provider value as the
    // discharge endpoint (verbatim, not estimated).
    const builderResult = (buildDischargePainTrajectory as unknown as Mock).mock.results[0]
      .value as ReturnType<typeof buildDischargePainTrajectory>
    expect(builderResult.dischargeEstimated).toBe(false)
    expect(builderResult.dischargeEntry?.max).toBe(2)
  })
})

// Exercise full generation against a stateful note row: mutations must retain
// metadata by leaving it on the existing row, never copying it into an insert.
vi.mock('@/lib/clinical/episode-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/clinical/episode-context')>('@/lib/clinical/episode-context')
  return { ...actual, ensureEpisodeEncounter: vi.fn(async () => ({ episodeId: 'episode', encounterId: 'encounter' })) }
})
describe('full discharge regeneration preserves the reviewed response', () => {
  beforeEach(() => { mockSupabase = createMockSupabase(); vi.clearAllMocks() })
  it.each(['declined', 'deferred', 'partially_accepted', 'not_documented'])('retains %s and its old reviewed plan on the active row', async (decision) => {
    const metadata = { schema_version: 1, decision, details: 'Exercise only', reviewed_plan: 'Old plan', reviewed_plan_hash: 'old-hash', confirmed_at: 'original confirmation' }
    const row: Record<string, unknown> = { id: 'note-id', status: 'draft', updated_at: 'v1', visit_date: '2026-09-10', pain_score_max: 2, plan_and_recommendations: 'Old plan', visit_treatment_decision: metadata }
    const updates: Record<string, unknown>[] = []
    const inserts = vi.fn()
    const noteQueries: ReturnType<typeof createMockQueryBuilder>[] = []
    const results: Record<string, unknown> = {
      care_episodes: { id: 'episode', case_id: TEST_CASE_ID, status: 'active' },
      clinical_encounters: [{ id: 'completed-visit' }],
      cases: { case_number: 'C-1', patient: { first_name: 'A', last_name: 'B' } },
      procedures: [], mri_extractions: [],
    }
    mockSupabase.from.mockImplementation((table: string) => {
      const builder = createMockQueryBuilder({ data: table === 'discharge_notes' ? { ...row } : results[table] ?? null, error: null })
      if (table === 'discharge_notes') {
        noteQueries.push(builder)
        builder.insert.mockImplementation(inserts)
        builder.update.mockImplementation((patch: Record<string, unknown>) => { updates.push(patch); Object.assign(row, patch); return builder })
      }
      return builder
    })
    const result = await generateDischargeNote(TEST_CASE_ID)
    expect(result.error).toBeUndefined()
    expect(result.data?.id).toBe('note-id')
    expect(generateDischargeNoteFromData).toHaveBeenCalled()
    expect(inserts).not.toHaveBeenCalled()
    expect(updates.every(patch => !('deleted_at' in patch) && !('visit_treatment_decision' in patch))).toBe(true)
    expect(row).toMatchObject({ status: 'draft', plan_and_recommendations: 'Changed plan', visit_treatment_decision: metadata })
    const claim = noteQueries.find(query => query.update.mock.calls.some(([patch]: [Record<string, unknown>]) => patch.status === 'generating'))!
    expect(claim.eq).toHaveBeenCalledWith('updated_at', 'v1')
    expect(claim.eq).toHaveBeenCalledWith('status', 'draft')
  })
})
