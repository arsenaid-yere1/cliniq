const historyState = vi.hoisted(() => ({ number: 1, load: vi.fn() }))
vi.mock('@/lib/clinical/load-prior-episode-history', () => ({ loadPriorEpisodeHistory: historyState.load }))
vi.mock('@/lib/clinical/evaluation-scope', () => ({ resolveEvaluationEpisode: async () => ({ episode: { id: 'episode', episode_number: historyState.number } }) }))
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
import { createInitialVisitFailureCapture } from '@/lib/clinical/initial-visit-generation-diagnostics'
import type { createClient } from '@/lib/supabase/server'
import type { ValidationFailure } from '@/lib/claude/validation-diagnostics'

const state = vi.hoisted(() => ({ full: vi.fn(), section: vi.fn() }))
let db: ReturnType<typeof createMockSupabase>
vi.mock('@/lib/supabase/server', () => ({ createClient: () => db }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/actions/case-status', () => ({ assertCaseNotClosed: async () => ({}), autoAdvanceFromIntake: vi.fn() }))
vi.mock('@/actions/fee-estimate', () => ({ getFeeEstimateTotals: async () => ({ professional_max: 0, practice_center_max: 0 }) }))
vi.mock('@/lib/supabase/generation-lock', () => ({ acquireGenerationLock: async () => ({ acquired: true }) }))
vi.mock('@/lib/claude/generate-initial-visit', () => ({
  generateInitialVisitFromData: state.full, regenerateSection: state.section, INITIAL_VISIT_SECTIONS_TOTAL: 16,
}))
import { generateInitialVisitNote, regenerateNoteSection } from '../initial-visit-notes'

const event: ValidationFailure = {
  failureOrdinal: 1, validationAttempt: 1, model: 'claude-test',
  issues: [{ code: 'custom', path: ['imaging_findings'], rule: 'current_decision', excerpt: 'patient accepted',
    excerptStart: 0, matchStart: 0, matchEnd: 16, truncated: false }],
}
const context = { caseId: 'case', noteId: 'note', sourceHash: 'a'.repeat(64) }
const asClient = () => db as unknown as Awaited<ReturnType<typeof createClient>>

beforeEach(() => {
  vi.clearAllMocks()
  historyState.number = 1
  db = createMockSupabase()
  db.rpc.mockImplementation(() => ({ abortSignal: vi.fn().mockResolvedValue({ data: 'failure-id', error: null }) }))
  db.from.mockImplementation((table: string) => createMockQueryBuilder({ data:
    table === 'initial_visit_notes' ? { id: 'note', provider_intake: null, visit_date: null, updated_at: 'version', status: 'draft' }
      : table === 'cases' ? { case_number: 'synthetic', patient: { first_name: 'Test', last_name: 'Only', date_of_birth: null, gender: null } }
        : table.endsWith('_extractions') ? [] : null, error: null }))
})
afterEach(() => vi.useRealTimers())

describe('private diagnostic capture', () => {
  it('uses one run for both failures and a fresh run for another invocation', async () => {
    const capture = createInitialVisitFailureCapture(asClient(), context)
    await capture(event)
    await capture({ ...event, failureOrdinal: 2, validationAttempt: 2 })
    await createInitialVisitFailureCapture(asClient(), context)(event)
    const calls = db.rpc.mock.calls.map(([, args]) => args)
    expect(calls[0].p_run_id).toBe(calls[1].p_run_id)
    expect(calls[2].p_run_id).not.toBe(calls[0].p_run_id)
    expect(calls.map((args) => JSON.parse(args.p_payload).failureOrdinal)).toEqual([1, 2, 1])
    expect(calls[0]).not.toHaveProperty('p_actor_id')
  })
  it('returns only a sanitized persistence error', async () => {
    db.rpc.mockImplementation(() => ({ abortSignal: vi.fn().mockResolvedValue({ error: { message: 'SENSITIVE' } }) }))
    await expect(createInitialVisitFailureCapture(asClient(), context)(event)).rejects.toThrow('Diagnostic storage unavailable')
  })
  it('bounds a stalled write to three seconds', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    db.rpc.mockImplementation(() => ({ abortSignal: (value: AbortSignal) => { signal = value; return new Promise(() => {}) } }))
    const pending = createInitialVisitFailureCapture(asClient(), context)(event)
    const assertion = expect(pending).rejects.toThrow('Diagnostic storage timeout')
    await vi.advanceTimersByTimeAsync(3000)
    await assertion
    expect(signal?.aborted).toBe(true)
  })
})

describe('generation action integration', () => {
  it.each(['initial_visit', 'pain_evaluation_visit'] as const)('wires full %s generation before returning its failure', async (visitType) => {
    state.full.mockImplementation(async (_input, _type, _tone, _progress, options) => {
      await options.onValidationFailure(event)
      await options.onValidationFailure({ ...event, failureOrdinal: 2, validationAttempt: 2 })
      return { error: 'Rejected', rawResponse: {} }
    })
    expect(await generateInitialVisitNote('case', visitType)).toEqual({ error: 'Rejected' })
    expect(db.rpc).toHaveBeenCalledTimes(2)
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_note_id: 'note', p_operation: 'full', p_section: null })
  })
  it.each(['past_medical_history', 'imaging_findings'] as const)('captures ordinary %s regeneration without returning excerpts', async (section) => {
    state.section.mockImplementation(async (...args) => {
      await args[7].onValidationFailure(event)
      return { error: 'Rejected' }
    })
    const result = await regenerateNoteSection('case', 'initial_visit', section)
    expect(result).toEqual({ error: 'Rejected' })
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_operation: 'section', p_section: section })
    expect(JSON.stringify(result)).not.toContain(event.issues[0].excerpt)
  })
  it('captures the pain-evaluation treatment-plan special branch as a section operation', async () => {
    state.full.mockImplementation(async (_input, _type, _tone, _progress, options) => {
      await options.onValidationFailure(event)
      return { error: 'Rejected' }
    })
    await regenerateNoteSection('case', 'pain_evaluation_visit', 'treatment_plan')
    expect(state.section).not.toHaveBeenCalled()
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_operation: 'section', p_section: 'treatment_plan' })
    expect(JSON.parse(db.rpc.mock.calls[0][1].p_payload).issues[0].path).toEqual(['imaging_findings'])
  })
})


describe('historical generation source hash', () => {
  it('tracks prior corrections deterministically without changing current PRP evidence', async () => {
    historyState.number = 2
    const { historicalEpisode } = await import('@/test-utils/prior-episode-history')
    const { projectPriorEpisodeHistory } = await import('@/lib/clinical/prior-episode-history')
    const prior = historicalEpisode()
    historyState.load.mockImplementation(async () => ({ history: projectPriorEpisodeHistory('case', 2, '2026-01-05', [prior]).history }))
    state.full.mockImplementation(async (_input, _type, _tone, _progress, options) => {
      await options.onValidationFailure(event)
      return { error: 'Rejected' }
    })
    await generateInitialVisitNote('case', 'pain_evaluation_visit', null, '2026-01-05')
    await generateInitialVisitNote('case', 'pain_evaluation_visit', null, '2026-01-05')
    const first = db.rpc.mock.calls[0][1].p_source_hash
    expect(db.rpc.mock.calls[1][1].p_source_hash).toBe(first)
    prior.discharge_notes[0].assessment = 'Corrected prior discharge'
    await generateInitialVisitNote('case', 'pain_evaluation_visit', null, '2026-01-05')
    expect(db.rpc.mock.calls[2][1].p_source_hash).not.toBe(first)
    expect(state.full.mock.calls[2][0].prpTargetEvidence).toEqual(state.full.mock.calls[0][0].prpTargetEvidence)
  })
})
