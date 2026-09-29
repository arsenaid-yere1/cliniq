import { beforeEach, expect, it, vi } from 'vitest'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'
const state = vi.hoisted(() => ({ gate: vi.fn(), note: vi.fn(), orders: vi.fn() }))
let client: ReturnType<typeof createMockSupabase>
let encounter: ReturnType<typeof createMockQueryBuilder>
vi.mock('@/lib/supabase/server', () => ({ createClient: () => client }))
vi.mock('next/navigation', () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) }, notFound: () => { throw new Error('not found') } }))
vi.mock('@/lib/features/return-tele-visits', () => ({ requireReturnTeleVisitsPage: state.gate }))
vi.mock('@/actions/pain-follow-up-notes', () => ({ getPainFollowUpNote: state.note }))
vi.mock('@/actions/procedure-orders', () => ({ listProcedureOrders: state.orders, previewProcedureSeriesChoices: vi.fn() }))
vi.mock('@/components/visits/pain-follow-up-editor', () => ({ PainFollowUpEditor: () => null }))
vi.mock('@/components/visits/telehealth-intake-card', () => ({ TelehealthIntakeCard: () => null }))
import VisitPage from '../(dashboard)/patients/[caseId]/visits/[encounterId]/page'
beforeEach(() => { vi.clearAllMocks(); client = createMockSupabase(); encounter = createMockQueryBuilder(); client.from.mockReturnValue(encounter) })
it.each([
  ['initial_evaluation', '/initial-visit?episode=old&visitType=initial_visit'],
  ['pain_evaluation', '/initial-visit?episode=old&visitType=pain_evaluation_visit'],
  ['discharge', '/discharge?episode=old'],
])('dispatches %s before optional follow-up gates or loads', async (kind, destination) => {
  encounter.maybeSingle.mockResolvedValue({ data: { id: 'visit', episode_id: 'old', encounter_type: kind }, error: null })
  state.gate.mockImplementation(() => { throw new Error('disabled') })
  await expect(VisitPage({ params: Promise.resolve({ caseId: 'case', encounterId: 'visit' }) })).rejects.toThrow(`redirect:/patients/case${destination}`)
  expect(encounter.eq).toHaveBeenCalledWith('case_id', 'case')
  expect(state.gate).not.toHaveBeenCalled(); expect(state.note).not.toHaveBeenCalled(); expect(state.orders).not.toHaveBeenCalled()
})
it('keeps the follow-up feature gate', async () => {
  encounter.maybeSingle.mockResolvedValue({ data: { id: 'visit', episode_id: 'ep', encounter_type: 'pain_follow_up' }, error: null })
  state.gate.mockImplementation(() => { throw new Error('disabled') })
  await expect(VisitPage({ params: Promise.resolve({ caseId: 'case', encounterId: 'visit' }) })).rejects.toThrow('disabled')
  expect(state.note).not.toHaveBeenCalled()
})
