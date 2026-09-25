import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
import type { ReviewFixTarget } from '@/lib/qc/review-fix-target'

const history = vi.hoisted(() => vi.fn())
vi.mock('@/lib/clinical/load-prior-episode-history', () => ({ loadPriorEpisodeHistory: history }))
const ai = vi.hoisted(() => ({ full: vi.fn(), section: vi.fn() }))
let db: ReturnType<typeof createMockSupabase>
let note: Record<string, unknown>
let noteQueries: ReturnType<typeof createMockQueryBuilder>[]
let vitalsQueries: ReturnType<typeof createMockQueryBuilder>[]
vi.mock('@/lib/supabase/server', () => ({ createClient: () => db }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/actions/case-status', () => ({ assertCaseNotClosed: async () => ({}), autoAdvanceFromIntake: vi.fn() }))
vi.mock('@/actions/fee-estimate', () => ({ getFeeEstimateTotals: async () => ({ professional_max: 0, practice_center_max: 0 }) }))
vi.mock('@/lib/claude/generate-initial-visit', () => ({ generateInitialVisitFromData: ai.full, regenerateSection: ai.section, INITIAL_VISIT_SECTIONS_TOTAL: 16 }))
vi.mock('@/lib/pdf/render-initial-visit-pdf', () => ({ renderInitialVisitPdf: async () => new Uint8Array([1, 2]) }))
import { createHash } from 'node:crypto'
import { buildPrpTargetEvidence } from '@/lib/clinical/prp-target-evidence'
import { initialVisitNoteEditSchema, initialVisitSections } from '@/lib/validations/initial-visit-note'
import { regenerateNoteSection, saveInitialVisitNote, finalizeInitialVisitNote } from '../initial-visit-notes'
const target = (): ReviewFixTarget => ({ runId: 'review-run', noteId: 'return-note', episodeId: 'episode-2', encounterId: 'return-encounter', updatedAt: 'v1', checkLease: vi.fn(async () => {}) })

beforeEach(() => {
  vi.clearAllMocks()
  history.mockResolvedValue({ history: { cutoff_date: '2026-09-24', episodes: [], coverage: { complete: false, limitations: ['Prior correction pending'] } }, fingerprint: 'history' })
  vi.stubEnv('QUALITY_REVIEW_V3_ENABLED', 'true')
  db = createMockSupabase()
  note = { id: 'return-note', case_id: 'case', episode_id: 'episode-2', encounter_id: 'return-encounter', visit_type: 'pain_evaluation_visit', status: 'draft', updated_at: 'v1', visit_date: '2026-09-24', prognosis: 'Original prognosis', provider_intake: null }
  noteQueries = []; vitalsQueries = []
  db.from.mockImplementation((table: string) => {
    const data = table === 'care_episodes' ? { id: 'episode-2', case_id: 'case', episode_number: 2, status: 'active' }
      : table === 'cases' ? { case_status: 'in_treatment', case_number: 'C1', patient: { first_name: 'Test', last_name: 'Patient', date_of_birth: null, gender: null } }
      : table === 'initial_visit_notes' ? note
      : table === 'vital_signs' ? { pain_score_max: 7 }
      : table === 'documents' ? { id: 'document' }
      : table.endsWith('_extractions') ? [] : null
    const builder = createMockQueryBuilder({ data, error: null })
    if (table === 'initial_visit_notes') {
      noteQueries.push(builder)
      // No Initial Visit in this return episode.
      builder.maybeSingle.mockImplementation(async () => ({ data: builder.eq.mock.calls.some(([key,value]: [string, unknown]) => key === 'visit_type' && value === 'initial_visit') ? null : note, error: null }))
    }
    if (table === 'vital_signs') vitalsQueries.push(builder)
    return builder
  })
  ai.section.mockResolvedValue({ data: 'Regenerated prognosis' })
  ai.full.mockResolvedValue({ data: { treatment_plan: 'Reviewed conservative plan.', prp_target_recommendations: [] } })
  db.rpc.mockResolvedValue({ data: { ...note, prognosis: 'Regenerated prognosis', updated_at: 'v2' }, error: null })
})
afterEach(() => vi.unstubAllEnvs())

describe('V3 evaluation fix episode compatibility', () => {
  it.each(['prognosis','treatment_plan'] as const)('keeps %s regeneration on its fenced return target', async section => {
    const fix = target()
    const result = await regenerateNoteSection('case','pain_evaluation_visit',section,{ message: 'Review this section', rationale: null },'v1',fix,'episode-1')
    expect(result.error).toBeUndefined()
    expect(fix.checkLease).toHaveBeenCalledOnce()
    expect(db.rpc).toHaveBeenCalledWith('quality_review_save_fix',expect.objectContaining({ p_run_id: 'review-run', p_table: 'initial_visit_notes', p_note_id: 'return-note', p_expected_updated_at: 'v1' }))
    expect(noteQueries[0].eq.mock.calls).toEqual(expect.arrayContaining([['id','return-note'],['episode_id','episode-2']]))
    expect(noteQueries.every(query => !query.update.mock.calls.length)).toBe(true)
    expect(vitalsQueries[0].eq.mock.calls).toEqual(expect.arrayContaining([['clinical_encounters.episode_id','episode-2'],['encounter_id','return-encounter']]))
    const input = section === 'treatment_plan' ? ai.full.mock.calls[0][0] : ai.section.mock.calls[0][0]
    expect(input.priorVisitData).toBeNull()
    expect(input.priorEpisodeHistory.coverage.limitations).toContain('Prior correction pending')
    expect(history).toHaveBeenCalledWith(db, 'case', 'episode-2', '2026-09-24')
  })
  it.each(['updated_at','encounter_id'] as const)('rejects changed %s before generation or RPC save', async field => {
    note[field] = 'changed'
    expect((await regenerateNoteSection('case','pain_evaluation_visit','prognosis',undefined,'v1',target())).error).toContain('target changed')
    expect(ai.section).not.toHaveBeenCalled()
    expect(db.rpc).not.toHaveBeenCalled()
  })
  it('keeps PRP save and sign independent of historical retrieval', async () => {
    history.mockRejectedValue(new Error('History unavailable'))
    const evidence = buildPrpTargetEvidence({ imagingRows: [], providerIntake: null, pmPhysicalExam: undefined })
    note.prp_target_evidence_hash = createHash('sha256').update(JSON.stringify(evidence)).digest('hex')
    note.prp_target_recommendations = []
    const values = initialVisitNoteEditSchema.parse({ visit_date: '2026-09-24', ...Object.fromEntries(initialVisitSections.map(key => [key, 'Reviewed text'])) })
    expect((await saveInitialVisitNote('case', 'pain_evaluation_visit', values, 'episode-2')).error).toBeUndefined()
    Object.assign(db, { storage: { from: () => ({ upload: async () => ({ error: null }) }) } })
    expect((await finalizeInitialVisitNote('case', 'pain_evaluation_visit', 'v1', 'episode-2')).error).toBeUndefined()
    expect(db.rpc).toHaveBeenCalledWith('finish_clinical_note', expect.objectContaining({ p_note_id: 'return-note' }))
    expect(history).not.toHaveBeenCalled()
  })
  it('fails history retrieval before AI or fenced save', async () => {
    history.mockRejectedValue(new Error('History unavailable'))
    expect((await regenerateNoteSection('case','pain_evaluation_visit','prognosis',undefined,'v1',target())).error).toBe('History unavailable')
    expect(ai.section).not.toHaveBeenCalled()
    expect(db.rpc).not.toHaveBeenCalled()
  })
  it('preserves the fenced save rejection instead of writing directly', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: 'Lease no longer current' } })
    expect((await regenerateNoteSection('case','pain_evaluation_visit','prognosis',undefined,'v1',target())).error).toContain('could not be saved')
    expect(noteQueries.every(query => !query.update.mock.calls.length)).toBe(true)
  })
})
