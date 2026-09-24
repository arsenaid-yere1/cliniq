// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Tables } from '@/types/database'
const { episodes, encounters } = vi.hoisted(() => ({ episodes: vi.fn(), encounters: vi.fn() }))
vi.mock('@/actions/care-episodes', () => ({ listCareEpisodes: episodes }))
vi.mock('@/actions/clinical-encounters', () => ({ listClinicalEncounters: encounters }))
vi.mock('@/actions/settings', () => ({ listProviderProfiles: async () => ({ data: [] }) }))
vi.mock('@/lib/features/return-tele-visits', () => ({ requireReturnTeleVisitsPage: vi.fn() }))
vi.mock('@/components/visits/start-return-episode-dialog', () => ({ StartReturnEpisodeDialog: () => <button>Start Return Visit</button> }))
vi.mock('@/components/visits/schedule-visit-dialog', () => ({ ScheduleVisitDialog: () => <button>Schedule Follow-Up</button> }))
import VisitsPage from '@/app/(dashboard)/patients/[caseId]/visits/page'
import { VisitList } from '../visit-list'
const episode = { id: 'episode-2', case_id: 'case', episode_number: 2, status: 'active', requires_pain_evaluation: true } as unknown as Tables<'care_episodes'>
const evaluation = { id: 'evaluation', episode_id: episode.id, encounter_type: 'pain_evaluation', status: 'scheduled', modality: 'in_person', encounter_date: '2026-09-24' } as Tables<'clinical_encounters'>
beforeEach(() => { episodes.mockResolvedValue({ data: [episode] }); encounters.mockResolvedValue({ data: [evaluation] }) })
afterEach(cleanup)
it('shows evaluation before follow-up and discharge controls', async () => {
  render(await VisitsPage({ params: Promise.resolve({ caseId: 'case' }) }))
  expect(screen.getByRole('link', { name: 'Complete Pain Evaluation' }).getAttribute('href')).toBe('/patients/case/initial-visit?episode=episode-2&visitType=pain_evaluation_visit')
  expect(screen.queryByRole('button', { name: 'Schedule Follow-Up' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Discharge Episode' })).toBeNull()
})
it.each([true, false])('enables subsequent visits after evaluation or for legacy episodes (%s)', async requiresEvaluation => {
  episodes.mockResolvedValue({ data: [{ ...episode, requires_pain_evaluation: requiresEvaluation }] })
  encounters.mockResolvedValue({ data: requiresEvaluation ? [{ ...evaluation, status: 'completed' }] : [] })
  render(await VisitsPage({ params: Promise.resolve({ caseId: 'case' }) }))
  expect(screen.getByRole('button', { name: 'Schedule Follow-Up' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Discharge Episode' }).getAttribute('href')).toBe('/patients/case/discharge?episode=episode-2')
})
it('links every evaluation to its owning episode and visit type', () => {
  const first = { ...episode, id: 'episode-1', episode_number: 1, status: 'discharged' } as Tables<'care_episodes'>
  render(<VisitList caseId="case" episodes={[first, episode]} encounters={[{ ...evaluation, id: 'initial', episode_id: first.id, encounter_type: 'initial_evaluation' }, evaluation]} />)
  expect(screen.getByRole('link', { name: /initial evaluation/ }).getAttribute('href')).toBe('/patients/case/initial-visit?episode=episode-1&visitType=initial_visit')
  expect(screen.getByRole('link', { name: /pain evaluation/ }).getAttribute('href')).toBe('/patients/case/initial-visit?episode=episode-2&visitType=pain_evaluation_visit')
})
