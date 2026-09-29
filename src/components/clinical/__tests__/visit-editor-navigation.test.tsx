// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '@/test-utils/visit-render'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { dischargeNoteSections } from '@/lib/validations/discharge-note'
import { initialVisitSections } from '@/lib/validations/initial-visit-note'
const { save } = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/patients/case-status-context', () => ({ useCaseStatus: () => 'active' }))
vi.mock('@/components/clinical/clinical-reset-dialog', () => ({ ClinicalResetDialog: () => null }))
vi.mock('@/components/discharge/pain-timeline-table', () => ({ PainTimelineTable: () => null }))
vi.mock('@/actions/documents', () => ({ getDocumentDownloadUrl: vi.fn() }))
vi.mock('@/actions/initial-visit-notes', () => ({ saveInitialVisitNote: save }))
vi.mock('@/actions/discharge-notes', () => ({ saveDischargeNote: save, getDischargePainTimeline: async () => ({ data: null }) }))
import { InitialVisitEditor } from '../initial-visit-editor'
import { DischargeNoteEditor } from '@/components/discharge/discharge-note-editor'
const confirm = vi.spyOn(window, 'confirm')
afterEach(() => { cleanup(); confirm.mockReset() })
beforeEach(() => { save.mockReset(); confirm.mockReturnValue(false) })
function mount(family: string) {
  const note = { ...Object.fromEntries([...initialVisitSections, ...dischargeNoteSections].map(key => [key, 'Saved narrative'])), id: 'note', status: 'draft', updated_at: 'v1', tone_hint: null, pain_score_max: 5, visit_date: '2026-09-10' }
  const common = { caseId: 'case', episodeId: 'episode', note, canGenerate: true, clinicSettings: null, providerProfile: null, clinicLogoUrl: null, providerSignatureUrl: null, caseData: null, documentFilePath: null, defaultVitals: null, correctionContext: null, isStale: false, earliestDate: null }
  const editor = family === 'discharge' ? <DischargeNoteEditor {...common as unknown as ComponentProps<typeof DischargeNoteEditor>} /> : <InitialVisitEditor {...{ ...common, notesByVisitType: { [family]: note }, intakesByVisitType: {}, documentFilePathByVisitType: {}, defaultVisitType: family, initialVitals: null, siblingDatesByVisitType: {}, painEvalMissingPriorVitals: false } as unknown as ComponentProps<typeof InitialVisitEditor>} />
  render(<>{editor}<a href="/all-visits" onClick={e => e.preventDefault()}>All visits</a></>)
  save.mockImplementation(async (...args: unknown[]) => ({ data: { savedNote: { ...note, ...(family === 'discharge' ? args[1] : args[2]) as object, updated_at: 'v2' } } }))
}
it.each(['initial_visit', 'pain_evaluation_visit', 'discharge'])('protects %s prose and preserves it after cancelling All visits', family => {
  mount(family)
  fireEvent.change(screen.getByRole('textbox', { name: 'Patient Education' }), { target: { value: 'Unsaved counseling' } })
  fireEvent.click(screen.getByText('All visits'))
  expect(confirm).toHaveBeenCalledOnce()
  expect((screen.getByRole('textbox', { name: 'Patient Education' }) as HTMLTextAreaElement).value).toBe('Unsaved counseling')
})
it.each(['initial_visit', 'discharge'])('keeps %s dirty after failed save', async family => {
  mount(family); save.mockResolvedValue({ error: 'conflict' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Patient Education' }), { target: { value: 'Unsaved' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
  await waitFor(() => expect(save).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByText('All visits'))
  expect(confirm).toHaveBeenCalledOnce()
})

it.each(['initial_visit', 'pain_evaluation_visit', 'discharge'])('clears %s prose baseline only after successful save', async family => {
  mount(family)
  fireEvent.change(screen.getByRole('textbox', { name: 'Patient Education' }), { target: { value: 'Saved counseling' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
  await waitFor(() => expect(save).toHaveBeenCalledOnce())
  await waitFor(() => expect((screen.getByRole('button', { name: 'Save Draft' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByText('All visits'))
  expect(confirm).not.toHaveBeenCalled()
})
