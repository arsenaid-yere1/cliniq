// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { buildVisitOverview, type VisitOverviewInput } from '@/lib/clinical/visit-summary'
const { load, refresh } = vi.hoisted(() => ({ load: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/visit-summaries', () => ({ getCaseVisitOverview: load }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/components/visits/start-return-episode-dialog', () => ({ StartReturnEpisodeDialog: () => <button>Start Return Visit</button> }))
vi.mock('@/components/visits/schedule-visit-dialog', () => ({ ScheduleVisitDialog: () => <button>Schedule Follow-Up</button> }))
import VisitsPage from '@/app/(dashboard)/patients/[caseId]/visits/page'
import { VisitsOverview } from '@/components/visits/visits-overview'
import { VisitNavigationProvider } from '@/components/visits/visit-navigation-context'
let input: VisitOverviewInput
beforeEach(() => {
  vi.clearAllMocks()
  input = {
    caseId: 'case', caseStatus: 'active', episodes: [{ id: 'ep2', case_id: 'case', episode_number: 2, status: 'active', requires_pain_evaluation: true, opened_at: '2026-09-01', ended_at: null, return_reason: 'Pain returned' }],
    encounters: [{ id: 'eval', case_id: 'case', episode_id: 'ep2', encounter_type: 'pain_evaluation', status: 'scheduled', modality: 'in_person', encounter_date: '2026-09-24', scheduled_start: '2026-09-24T18:00:00Z', provider_id: null }],
    notes: [], corrections: [], orders: [], appointments: [], providers: [], providerError: false, correctionAllowed: true, claimedEncounterIds: [], returnVisitsEnabled: true,
  }
  load.mockImplementation(async () => ({ data: buildVisitOverview(input) }))
})
afterEach(cleanup)
const mount = async (episode?: string) => render(await VisitsPage({ params: Promise.resolve({ caseId: 'case' }), searchParams: Promise.resolve({ episode }) }))
it('shows required evaluation before follow-up and discharge controls', async () => {
  await mount()
  expect(screen.getByRole('link', { name: 'Complete Pain Evaluation' }).getAttribute('href')).toBe('/patients/case/initial-visit?episode=ep2&visitType=pain_evaluation_visit')
  expect(screen.queryByRole('button', { name: 'Schedule Follow-Up' })).toBeNull()
  expect((screen.getByRole('button', { name: 'Prepare discharge' }) as HTMLButtonElement).disabled).toBe(true)
})
it.each([true, false])('enables follow-ups after evaluation or for legacy episodes (%s)', async requires => {
  input.episodes[0].requires_pain_evaluation = requires
  input.encounters[0].status = 'completed'
  input.notes = [{ id: 'note', case_id: 'case', episode_id: 'ep2', encounter_id: 'eval', kind: 'pain_evaluation', status: 'finalized', hasContent: true, visit_date: '2026-09-24', document_id: 'pdf' }]
  await mount()
  expect(screen.getByRole('button', { name: 'Schedule Follow-Up' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Prepare discharge' }).getAttribute('href')).toBe('/patients/case/discharge?episode=ep2')
})
it('links evaluation to its owning episode and type and allows keyboard disclosure', async () => {
  await mount()
  const row = screen.getByRole('link', { name: /Pain Evaluation.*Not started/ })
  expect(row.getAttribute('href')).toContain('episode=ep2&visitType=pain_evaluation_visit')
  const toggle = screen.getByRole('button', { name: /Episode 2/ })
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('link', { name: /Pain Evaluation.*Not started/ })).toBeNull()
})
it('opens an explicitly selected historical episode', async () => {
  input.episodes[0].status = 'discharged'
  await mount('ep2')
  expect(screen.getByRole('button', { name: /Episode 2/ }).getAttribute('aria-expanded')).toBe('true')
})
it('retains base access when returns are disabled', async () => {
  input.returnVisitsEnabled = false
  await mount()
  expect(screen.getByRole('link', { name: 'Complete Pain Evaluation' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Schedule Follow-Up' })).toBeNull()
})
it('retries load failure without showing creation actions', async () => {
  load.mockResolvedValue({ error: 'History unavailable' })
  await mount()
  expect(screen.getByRole('alert').textContent).toContain('History unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(refresh).toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Start Return Visit' })).toBeNull()
})
it('restores episode expansion and scroll after an editor round trip without storing drafts', () => {
  const overview = buildVisitOverview(input)
  const tree = (show: boolean, requestedEpisodeId?: string) => <VisitNavigationProvider><main>{show ? <VisitsOverview overview={overview} requestedEpisodeId={requestedEpisodeId} /> : <p>Editor</p>}</main></VisitNavigationProvider>
  const view = render(tree(true))
  fireEvent.click(screen.getByRole('button', { name: /Episode 2/ }))
  const main = screen.getByRole('main')
  main.scrollTop = 210
  fireEvent.scroll(main)
  view.rerender(tree(false))
  main.scrollTop = 0
  view.rerender(tree(true))
  expect(screen.getByRole('button', { name: /Episode 2/ }).getAttribute('aria-expanded')).toBe('false')
  expect(main.scrollTop).toBe(210)
  view.rerender(tree(false))
  view.rerender(tree(true, 'ep2'))
  expect(screen.getByRole('button', { name: /Episode 2/ }).getAttribute('aria-expanded')).toBe('true')
})
