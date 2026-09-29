import { beforeEach, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactElement } from 'react'
import { createMockQueryBuilder, createMockSupabase } from '@/test-utils/supabase-mock'

const state = vi.hoisted(() => ({ note: vi.fn(), prerequisite: vi.fn(), correction: vi.fn(), episode: vi.fn(), readiness: vi.fn() }))
let client: ReturnType<typeof createMockSupabase>
vi.mock('@/lib/supabase/server', () => ({ createClient: () => client }))
vi.mock('@/lib/clinical/episode-context', () => ({ getEpisodeById: state.episode, getActiveOrLatestEpisode: state.episode }))
vi.mock('@/lib/clinical/discharge-readiness', () => ({ loadDischargeBlockers: state.readiness }))
vi.mock('@/actions/discharge-notes', () => ({ getDischargeNote: state.note, checkDischargeNotePrerequisites: state.prerequisite, getDischargeCorrectionContext: state.correction }))
vi.mock('@/actions/settings', () => ({
  getClinicSettings: async () => ({ data: null }), getProviderProfileById: async () => ({ data: null }),
  getClinicLogoUrl: async () => ({ url: null }), getProviderSignatureUrl: async () => ({ url: null }),
}))
vi.mock('@/components/discharge/discharge-note-editor', () => ({ DischargeNoteEditor: () => null }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('Not found') } }))
import DischargePage from '../(dashboard)/patients/[caseId]/discharge/page'
import { DischargeNoteEditor } from '@/components/discharge/discharge-note-editor'
import { VisitEditorHeader } from '@/components/visits/visit-editor-header'
const load = () => DischargePage({ params: Promise.resolve({ caseId: 'case' }), searchParams: Promise.resolve({ episode: 'old' }) })
function child(page: ReactElement<{ children?: unknown }>, type: unknown) {
  return Children.toArray(page.props.children as ReactElement[]).find(node => isValidElement(node) && node.type === type) as ReactElement<Record<string, unknown>>
}
beforeEach(() => {
  vi.clearAllMocks()
  state.episode.mockResolvedValue({ id: 'old', episode_number: 1, status: 'active' })
  state.note.mockResolvedValue({ data: { id: 'note', status: 'draft' } })
  state.prerequisite.mockResolvedValue({ data: { canGenerate: true } })
  state.correction.mockResolvedValue({ data: null })
  state.readiness.mockResolvedValue({ blockers: [], error: null })
  client = createMockSupabase()
  client.from.mockImplementation(table => createMockQueryBuilder({ data: table === 'cases' ? { case_status: 'active', patient: {} } : table === 'clinical_encounters' || table === 'initial_visit_notes' ? [] : null, error: null }))
})
it('keeps historical discharge read-only with an exact return link and correction context', async () => {
  state.episode.mockResolvedValue({ id: 'old', episode_number: 1, status: 'discharged' })
  const correction = { canCorrect: true, correction: { id: 'correction', status: 'open' } }
  state.correction.mockResolvedValue({ data: correction })
  const page = await load()
  expect(child(page, DischargeNoteEditor).props).toMatchObject({ episodeId: 'old', episodeWritable: false, correctionContext: correction })
  expect(child(page, VisitEditorHeader).props).toMatchObject({ caseId: 'case', episodeId: 'old', episodeNumber: 1 })
  expect(state.note).toHaveBeenCalledWith('case', 'old')
  expect(state.correction).toHaveBeenCalledWith('case', 'old', 'note')
  expect(state.readiness).not.toHaveBeenCalled()
})
it.each(['note', 'prerequisite', 'correction'])('does not render an editable blank discharge after a %s read failure', async key => {
  state[key as 'note' | 'prerequisite' | 'correction'].mockResolvedValue({ error: 'Unavailable' })
  const page = await load()
  expect(page.props.role).toBe('alert')
  expect(child(page, DischargeNoteEditor)).toBeUndefined()
})
it.each([false, true])('prevents finalization for unresolved work or unreadable readiness (%s)', async failed => {
  state.readiness.mockResolvedValue(failed ? { blockers: [], error: 'Readiness unavailable' } : { blockers: [{ id: 'visit', label: 'Open follow-up', href: '/patients/case/visits/visit' }], error: null })
  const page = await load()
  expect(child(page, DischargeNoteEditor).props).toMatchObject({ episodeWritable: true, finalizationBlockedReason: expect.any(String) })
  expect(state.readiness).toHaveBeenCalledWith(client, 'case', 'old')
})
