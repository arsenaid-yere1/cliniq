// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '@/test-utils/visit-render'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
const { save, generate, saveVitals } = vi.hoisted(() => ({ save: vi.fn(), generate: vi.fn(), saveVitals: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/patients/case-status-context', () => ({ useCaseStatus: () => 'active' }))
vi.mock('@/components/clinical/clinical-reset-dialog', () => ({ ClinicalResetDialog: () => null }))
vi.mock('@/components/discharge/pain-timeline-table', () => ({ PainTimelineTable: () => null }))
vi.mock('@/actions/documents', () => ({ getDocumentDownloadUrl: vi.fn() }))
vi.mock('@/actions/visit-date', () => ({ savePreGenerationVisitDate: save }))
vi.mock('@/actions/initial-visit-notes', () => ({ generateInitialVisitNote: generate, saveProviderIntake: async () => ({ data: { success: true } }), saveInitialVisitVitals: saveVitals }))
vi.mock('@/actions/discharge-notes', () => ({ generateDischargeNote: generate, saveDischargeVitals: saveVitals, getDischargePainTimeline: async () => ({ data: null }) }))
import { InitialVisitEditor } from '../initial-visit-editor'
import { DischargeNoteEditor } from '@/components/discharge/discharge-note-editor'
const confirm = vi.spyOn(window, 'confirm')
beforeEach(() => {
  save.mockReset(); generate.mockReset(); saveVitals.mockReset(); confirm.mockReturnValue(false)
  save.mockImplementation(async args => ({ data: { noteId: 'saved-note', visitDate: args.visitDate, updatedAt: '2026-09-30T00:00:00Z' } }))
  generate.mockResolvedValue({ data: { id: 'saved-note' } }); saveVitals.mockResolvedValue({ data: { success: true } })
})
afterEach(() => { cleanup(); confirm.mockReset() })
function editor(family: string, date: string | null = null) {
  const note = date ? { id: 'saved-note', status: 'draft', updated_at: '2026-09-30T00:00:00Z', visit_date: date } : null
  const common = { caseId: 'case', episodeId: 'episode', note, canGenerate: true, clinicSettings: null, providerProfile: null, clinicLogoUrl: null, providerSignatureUrl: null, caseData: null, documentFilePath: null, defaultVitals: null, correctionContext: null, isStale: false, earliestDate: null }
  const child = family === 'discharge' ? <DischargeNoteEditor {...common as unknown as ComponentProps<typeof DischargeNoteEditor>} /> : <InitialVisitEditor {...{ ...common, notesByVisitType: { [family]: note }, intakesByVisitType: {}, documentFilePathByVisitType: {}, defaultVisitType: family, initialVitals: null, siblingDatesByVisitType: {}, painEvalMissingPriorVitals: false } as unknown as ComponentProps<typeof InitialVisitEditor>} />
  return <>{child}<a href="/all-visits" onClick={e => e.preventDefault()}>All visits</a></>
}
function input(family: string) { return document.getElementById(family === 'discharge' ? 'visit-date-pre-gen' : `visit-date-pre-gen-${family}`) as HTMLInputElement }
it.each(['initial_visit', 'pain_evaluation_visit', 'discharge'])('%s persists before generation and restores on remount', async family => {
  const view = render(editor(family))
  fireEvent.change(input(family), { target: { value: '2026-09-05' } })
  fireEvent.blur(input(family))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getAllByText('Date saved').length).toBeGreaterThan(0))
  expect(save.mock.calls[0][0]).toMatchObject({ kind: family, visitDate: '2026-09-05', caseId: 'case', episodeId: 'episode' })
  expect(generate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('All visits'))
  expect(confirm).not.toHaveBeenCalled()
  const originalInput = input(family)
  view.rerender(editor(family, '2026-09-05'))
  expect(input(family)).toBe(originalInput)
  view.unmount()
  render(editor(family, '2026-09-05'))
  expect(input(family).value).toBe('2026-09-05')
})
it('a date acknowledgment does not acknowledge unsaved tone', async () => {
  render(editor('discharge'))
  const tone = screen.getByRole('textbox', { name: 'Tone & Direction (optional)' })
  fireEvent.change(tone, { target: { value: 'Keep concise' } })
  fireEvent.change(input('discharge'), { target: { value: '2026-09-05' } })
  fireEvent.blur(input('discharge'))
  await waitFor(() => expect(screen.getByText('Date saved')).toBeTruthy())
  fireEvent.click(screen.getByText('All visits'))
  expect(confirm).toHaveBeenCalledOnce()
})
it('a failed blur blocks generation and leaves a visible retry', async () => {
  save.mockResolvedValue({ code: 'save_failed', error: 'Offline' })
  render(editor('discharge'))
  fireEvent.change(input('discharge'), { target: { value: '2026-09-05' } })
  fireEvent.blur(input('discharge'))
  await screen.findByText('Offline')
  fireEvent.click(screen.getByRole('button', { name: /Generate Discharge/ }))
  await waitFor(() => expect((screen.getByRole('button', { name: /Generate Discharge/ }) as HTMLButtonElement).disabled).toBe(false))
  expect(save).toHaveBeenCalledOnce()
  expect(generate).not.toHaveBeenCalled()
  expect(input('discharge').value).toBe('2026-09-05')
  expect(screen.getByRole('button', { name: 'Retry save' })).toBeTruthy()
})
it('Generate waits for a pending explicit discharge vitals save', async () => {
  let resolve!: (r: unknown) => void
  saveVitals.mockReturnValue(new Promise(r => { resolve = r }))
  render(editor('discharge'))
  fireEvent.click(screen.getByRole('button', { name: /Save Vitals/i }))
  await waitFor(() => expect(saveVitals).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: /Generate Discharge/ }))
  expect(generate).not.toHaveBeenCalled()
  resolve({ error: 'Vitals failed' })
  await waitFor(() => expect((screen.getByRole('button', { name: /Generate Discharge/ }) as HTMLButtonElement).disabled).toBe(false))
  expect(generate).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})
it.each(['initial_visit', 'pain_evaluation_visit', 'discharge'])('%s refuses Generate after the date is cleared', async family => {
  render(editor(family))
  fireEvent.change(input(family), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: /Generate/ }))
  await screen.findByText('Date not saved')
  expect(generate).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})
it.each(['initial_visit', 'pain_evaluation_visit', 'discharge'])('%s Generate awaits its pending blur and uses the acknowledged date', async family => {
  let resolve!: (r: unknown) => void
  save.mockReturnValue(new Promise(r => { resolve = r }))
  render(editor(family))
  fireEvent.change(input(family), { target: { value: '2026-09-05' } })
  fireEvent.blur(input(family))
  await waitFor(() => expect(save).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: /Generate/ }))
  expect(generate).not.toHaveBeenCalled()
  resolve({ data: { noteId: 'saved-note', visitDate: '2026-09-05', updatedAt: '2026-09-30T00:00:00Z' } })
  await waitFor(() => expect(generate).toHaveBeenCalledOnce())
  expect(save).toHaveBeenCalledOnce()
  expect(generate.mock.calls[0]).toContain('2026-09-05')
  expect(generate.mock.calls[0].at(-1)).toMatchObject({ noteId: 'saved-note', visitDate: '2026-09-05' })
})
