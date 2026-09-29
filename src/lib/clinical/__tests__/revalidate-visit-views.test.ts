import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { revalidatePath } from 'next/cache'
import { revalidateVisitViews } from '../revalidate-visit-views'
beforeEach(() => vi.clearAllMocks())
it('refreshes hub and exact editor without layout invalidation on draft save', () => {
  revalidateVisitViews('case', 'evaluation')
  expect(vi.mocked(revalidatePath).mock.calls).toEqual([['/patients/case/visits'], ['/patients/case/initial-visit']])
})
it('refreshes case context and deadline when discharge ends an episode', () => {
  revalidateVisitViews('case', 'discharge', { episodeTransition: true, dischargeDateChanged: true })
  expect(vi.mocked(revalidatePath).mock.calls).toEqual([['/patients/case/visits'], ['/patients/case/discharge'], ['/patients/case', 'layout'], ['/patients']])
})
it('refreshes a follow-up detail with its hub', () => {
  revalidateVisitViews('case', 'follow_up', { encounterId: 'visit' })
  expect(vi.mocked(revalidatePath).mock.calls).toEqual([['/patients/case/visits'], ['/patients/case/visits/visit']])
})
