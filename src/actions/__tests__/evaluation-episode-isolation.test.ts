import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
import { defaultProviderIntake } from '@/lib/validations/initial-visit-note'

const generation = vi.hoisted(() => vi.fn())
let db: ReturnType<typeof createMockSupabase>
type Row = Record<string, unknown>
let tables: Record<string, Row[]>
vi.mock('@/lib/supabase/server', () => ({ createClient: () => db }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/actions/case-status', () => ({ assertCaseNotClosed: async () => ({}), autoAdvanceFromIntake: vi.fn() }))
vi.mock('@/actions/fee-estimate', () => ({ getFeeEstimateTotals: async () => ({ professional_max: 0, practice_center_max: 0 }) }))
vi.mock('@/lib/supabase/generation-lock', () => ({ acquireGenerationLock: async () => ({ acquired: true }) }))
vi.mock('@/lib/claude/generate-initial-visit', () => ({ generateInitialVisitFromData: generation, regenerateSection: vi.fn(), INITIAL_VISIT_SECTIONS_TOTAL: 16 }))
import { generateInitialVisitNote, getInitialVisitNotes, saveProviderIntake, saveInitialVisitVitals } from '../initial-visit-notes'
import { getClinicalOrders } from '../clinical-orders'

// A small row store executes filters and writes, so accidental case-wide mutations
// are observable as changes to the earlier episode rather than only mock-call differences.
function tableQuery(table: string) {
  const builder = createMockQueryBuilder()
  const filters: Array<(row: Row) => boolean> = []
  let patch: Row | undefined
  let limit: number | undefined
  let order: string | undefined
  const field = (row: Row, key: string) => key === 'clinical_encounters.episode_id'
    ? tables.clinical_encounters.find(e => e.id === row.encounter_id)?.episode_id
    : key === 'clinical_encounters.encounter_type' ? tables.clinical_encounters.find(e => e.id === row.encounter_id)?.encounter_type : row[key]
  builder.eq.mockImplementation((key: string, value: unknown) => { filters.push(row => field(row, key) === value); return builder })
  builder.is.mockImplementation((key: string, value: unknown) => { filters.push(row => (field(row, key) ?? null) === value); return builder })
  builder.in.mockImplementation((key: string, values: unknown[]) => { filters.push(row => values.includes(field(row, key))); return builder })
  builder.lte.mockImplementation((key: string, value: string) => { filters.push(row => String(row[key]) <= value); return builder })
  builder.order.mockImplementation((key: string) => { order = key; return builder })
  builder.limit.mockImplementation((value: number) => { limit = value; return builder })
  builder.update.mockImplementation((value: Row) => { patch = value; return builder })
  const execute = (single: boolean) => {
    let rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
    if (order) rows = [...rows].sort((a,b) => String(b[order!]).localeCompare(String(a[order!])))
    if (limit) rows = rows.slice(0,limit)
    if (patch) rows.forEach(row => Object.assign(row,patch))
    return { data: single ? rows[0] ?? null : rows, error: single && rows.length > 1 ? { message: 'multiple rows' } : null }
  }
  builder.maybeSingle.mockImplementation(async () => execute(true))
  builder.single.mockImplementation(async () => execute(true))
  builder.then = (resolve: (value: unknown) => void) => resolve(execute(false))
  return builder
}
beforeEach(() => {
  vi.clearAllMocks()
  db = createMockSupabase()
  const note = (episode: number) => ({ id: `note-${episode}`, case_id: 'case', episode_id: `episode-${episode}`, encounter_id: `encounter-${episode}`, visit_type: 'pain_evaluation_visit', status: 'draft', updated_at: 'v1', visit_date: '2026-09-24', chief_complaint: `Episode ${episode}`, provider_intake: { ...defaultProviderIntake, social_history: { ...defaultProviderIntake.social_history, occupation: `Episode ${episode}` } } })
  tables = {
    care_episodes: [1,2].map(n => ({ id: `episode-${n}`, case_id: 'case', episode_number: n, status: n === 1 ? 'discharged' : 'active' })),
    cases: [{ id: 'case', case_status: 'in_treatment', case_number: 'test', patient: { first_name: 'Test', last_name: 'Patient', date_of_birth: null, gender: null } }],
    clinical_encounters: [1,2].map(n => ({ id: `encounter-${n}`, case_id: 'case', episode_id: `episode-${n}`, encounter_type: 'pain_evaluation' })),
    initial_visit_notes: [note(1),note(2),{ ...note(1), id: 'old-initial', visit_type: 'initial_visit', status: 'finalized', finalized_at: '2026-08-01T00:00:00Z' }],
    vital_signs: [1,2].map(n => ({ id: `vitals-${n}`, case_id: 'case', encounter_id: `encounter-${n}`, pain_score_max: n === 1 ? 3 : 7, recorded_at: `2026-0${n}-01` })),
    clinical_orders: [1,2].map(n => ({ id: `order-${n}`, case_id: 'case', episode_id: `episode-${n}`, initial_visit_note_id: `note-${n}` })),
  }
  db.from.mockImplementation(tableQuery)
  generation.mockResolvedValue({ error: 'Synthetic generation stopped' })
})
describe('return evaluation isolation', () => {
  it('reads selected notes and preserves the legacy default', async () => {
    expect((await getInitialVisitNotes('case','episode-2')).data?.map(n => n.id)).toEqual(['note-2'])
    expect((await getInitialVisitNotes('case')).data?.map(n => n.id).sort()).toEqual(['note-1','old-initial'])
  })
  it('merges intake only into the selected return note', async () => {
    const older = structuredClone(tables.initial_visit_notes[0])
    const intake = { ...defaultProviderIntake, social_history: { ...defaultProviderIntake.social_history, occupation: 'New job' } }
    expect((await saveProviderIntake('case','pain_evaluation_visit',intake,'social_history','episode-2')).error).toBeUndefined()
    expect(tables.initial_visit_notes[0]).toEqual(older)
    expect(tables.initial_visit_notes[1].provider_intake).toMatchObject({ social_history: { occupation: 'New job' } })
  })
  it('generates from this episode intake/vitals without a prior episode Initial Visit', async () => {
    const older = structuredClone(tables.initial_visit_notes[0])
    tables.clinical_encounters.push({ id: 'later-follow-up', case_id: 'case', episode_id: 'episode-2', encounter_type: 'pain_follow_up' })
    tables.vital_signs.push({ id: 'later-vitals', case_id: 'case', encounter_id: 'later-follow-up', pain_score_max: 1, recorded_at: '2026-12-01' })
    await generateInitialVisitNote('case','pain_evaluation_visit',null,null,'episode-2')
    expect(generation).toHaveBeenCalled()
    expect(generation.mock.calls[0][0]).toMatchObject({ priorVisitData: null, providerIntake: { social_history: { occupation: 'Episode 2' } }, vitalSigns: { pain_score_max: 7 } })
    expect(tables.initial_visit_notes[0]).toEqual(older)
    expect(tables.initial_visit_notes[1].status).toBe('failed')
  })
  it('updates return vitals without changing earlier episode vitals', async () => {
    const older = structuredClone(tables.vital_signs[0])
    const vitals = { bp_systolic: 120, bp_diastolic: 80, heart_rate: 70, respiratory_rate: 16, temperature_f: 98.6, spo2_percent: 99, pain_score_min: 4, pain_score_max: 8 }
    expect((await saveInitialVisitVitals('case','pain_evaluation_visit',vitals,'episode-2')).error).toBeUndefined()
    expect(tables.vital_signs[0]).toEqual(older)
    expect(tables.vital_signs[1].pain_score_max).toBe(8)
  })
  it('loads historical companion orders from the explicitly selected episode', async () => {
    expect((await getClinicalOrders('case','pain_evaluation_visit','episode-1')).data?.map(n => n.id)).toEqual(['order-1'])
  })
  it('rejects cross-case and discharged writes before changing notes', async () => {
    const before = structuredClone(tables.initial_visit_notes)
    expect((await saveProviderIntake('other','pain_evaluation_visit',defaultProviderIntake,undefined,'episode-2')).error).toContain('does not belong')
    expect((await saveProviderIntake('case','pain_evaluation_visit',defaultProviderIntake,undefined,'episode-1')).error).toContain('not active')
    expect(tables.initial_visit_notes).toEqual(before)
  })
})
