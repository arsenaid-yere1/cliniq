import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
const state = vi.hoisted(() => ({ vitals: vi.fn(), intake: vi.fn() }))
vi.mock('@/actions/initial-visit-notes', () => ({
  getInitialVisitNotes: async () => ({ data: [] }),
  checkNotePrerequisites: async () => ({ data: { canGenerate: true } }),
  getInitialVisitVitals: state.vitals,
  getProviderIntake: state.intake,
}))
vi.mock('@/actions/settings', () => ({
  getClinicSettings: async () => ({ data: null }), getProviderProfileById: async () => ({ data: null }),
  getClinicLogoUrl: async () => ({ url: null }), getProviderSignatureUrl: async () => ({ url: null }),
}))
vi.mock('@/components/clinical/initial-visit-editor', () => ({ InitialVisitEditor: () => null }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('Not found') } }))
let client: ReturnType<typeof createMockSupabase>
vi.mock('@/lib/supabase/server', () => ({ createClient: () => client }))
import InitialVisitPage from '../(dashboard)/patients/[caseId]/initial-visit/page'

beforeEach(() => {
  state.intake.mockResolvedValue({ data: null })
  client = createMockSupabase()
  client.from.mockImplementation(table => createMockQueryBuilder({ data: table === 'care_episodes'
    ? { id: 'episode-2', episode_number: 2, status: 'active' }
    : table === 'discharge_note_corrections' ? [] : { case_number: 'C', patient: {} }, error: null }))
})
const renderPage = async () => await InitialVisitPage({ params: Promise.resolve({ caseId: 'case' }), searchParams: Promise.resolve({ episode: 'episode-2' }) }) as ReactElement<{ role?: string; initialVitals?: unknown; canGenerate?: boolean; intakeCarryover?: unknown }>
describe('evaluation page vitals loading', () => {
  it('passes loaded measurements to the form', async () => {
    const measurements = { heart_rate: 72, pain_score_max: 6 }
    state.vitals.mockResolvedValue({ data: measurements })
    const page = await renderPage()
    expect(page.props.initialVitals).toEqual(measurements)
    expect(state.vitals).toHaveBeenLastCalledWith('case', 'episode-2')
  })
  it('preserves a legitimately empty visit', async () => {
    state.vitals.mockResolvedValue({ data: null })
    const page = await renderPage()
    expect(page.props.initialVitals).toBeNull()
    expect(page.props.canGenerate).toBe(true)
  })
  it('shows a load error instead of an editable blank form', async () => {
    state.vitals.mockResolvedValue({ error: 'Failed to fetch vitals' })
    const page = await renderPage()
    expect(page.props.role).toBe('alert')
    expect(page.props).not.toHaveProperty('initialVitals')
  })
  it('passes carryover provenance to the editable form', async () => {
    const carriedSections = [{ section: 'accident_details', episodeNumber: 1, visitDate: '2026-08-01' }]
    state.vitals.mockResolvedValue({ data: null })
    state.intake.mockResolvedValue({ data: null, carriedSections })
    expect((await renderPage()).props.intakeCarryover).toEqual(carriedSections)
  })
  it('shows intake read failures instead of editable defaults', async () => {
    state.vitals.mockResolvedValue({ data: null })
    state.intake.mockResolvedValue({ error: 'History unavailable' })
    const page = await renderPage()
    expect(page.props.role).toBe('alert')
    expect(page.props).not.toHaveProperty('initialVitals')
  })

})
