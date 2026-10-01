// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from '@/test-utils/visit-render'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { initialVisitSections } from '@/lib/validations/initial-visit-note'
import { dischargeNoteSections } from '@/lib/validations/discharge-note'
import { visitDecisionClosing } from '@/lib/validations/visit-treatment-decision'
const { regenerate, save, tone, finalize, error, correctionSave, correctionFinalize } = vi.hoisted(() => ({ regenerate: vi.fn(), save: vi.fn(), tone: vi.fn(), finalize: vi.fn(), error: vi.fn(), correctionSave: vi.fn(), correctionFinalize: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error } }))
vi.mock('@/components/patients/case-status-context', () => ({ useCaseStatus: () => 'active' }))
vi.mock('@/components/clinical/clinical-reset-dialog', () => ({ ClinicalResetDialog: () => null }))
vi.mock('@/components/clinical/generating-progress', () => ({ GeneratingProgress: () => null }))
vi.mock('@/components/discharge/pain-timeline-table', () => ({ PainTimelineTable: () => null }))
vi.mock('@/actions/documents', () => ({ getDocumentDownloadUrl: vi.fn() }))
vi.mock('@/actions/initial-visit-notes', () => ({ regenerateNoteSection: regenerate, saveInitialVisitNote: save, saveInitialVisitNoteToneHint: tone, finalizeInitialVisitNote: finalize }))
vi.mock('@/actions/discharge-notes', () => ({ regenerateDischargeNoteSectionAction: regenerate, saveDischargeNote: save, getDischargePainTimeline: async () => ({ data: null }), saveDischargeNoteToneHint: tone, finalizeDischargeNote: finalize, saveDischargeCorrection: correctionSave, finalizeDischargeCorrection: correctionFinalize }))
import { InitialVisitEditor } from '../initial-visit-editor'
import { DischargeNoteEditor } from '@/components/discharge/discharge-note-editor'
const decision = { schema_version: 1, decision: 'declined', details: null, reviewed_plan: 'Old plan', reviewed_plan_hash: 'hash', visit_date: '2026-09-10', confirmed_by: '11111111-1111-4111-8111-111111111111', confirmed_at: '2026-09-10' }
const closing = visitDecisionClosing({ decision: 'declined', details: null })
function mount(family: string, correction = false, savedDecision: unknown = decision) {
  const note = { ...Object.fromEntries([...initialVisitSections, ...dischargeNoteSections].map(key => [key, 'Saved narrative'])), id: 'note', status: 'draft', updated_at: 'v1', tone_hint: null, pain_score_max: 5, visit_date: '2026-09-10', treatment_plan: 'Old plan', plan_and_recommendations: 'Old plan', patient_education: `Saved education. ${closing}`, visit_treatment_decision: savedDecision }
  const common = { caseId: 'case', episodeId: 'episode', note, canGenerate: true, clinicSettings: null, providerProfile: null, clinicLogoUrl: null, providerSignatureUrl: null, caseData: null, documentFilePath: null, defaultVitals: null, correctionContext: correction ? { canCorrect: true, history: [], openCorrection: { id: 'correction', revision_number: 2 } } : null, isStale: false, earliestDate: null }
  if (family === 'discharge') render(<DischargeNoteEditor {...common as unknown as ComponentProps<typeof DischargeNoteEditor>} />)
  else render(<InitialVisitEditor {...{ ...common, notesByVisitType: { [family]: note }, intakesByVisitType: {}, documentFilePathByVisitType: {}, defaultVisitType: family, initialVitals: null, siblingDatesByVisitType: {}, painEvalMissingPriorVitals: false } as unknown as ComponentProps<typeof InitialVisitEditor>} />)
  save.mockImplementation(async (...args: unknown[]) => ({ data: { savedNote: { ...note, ...(family === 'discharge' ? args[1] : args[2]) as object, updated_at: 'v3' } } }))
  return note
}

function toneInput() { return screen.getByRole('textbox', { name: 'Tone & Direction (optional)' }) }
beforeEach(() => {
  vi.clearAllMocks()
  tone.mockResolvedValue({ data: { updated_at: 'v2', tone_hint: 'Concise' } })
  finalize.mockResolvedValue({ data: { success: true } })
})
afterEach(cleanup)


it.each(['initial_visit', 'pain_evaluation_visit', 'discharge'])('reports %s unsaved prose after a tone-only save and retains save failure', async family => {
  mount(family)
  expect(screen.getAllByText('No unsaved changes').length).toBeGreaterThan(0)
  fireEvent.change(screen.getByRole('textbox', { name: 'Patient Education' }), { target: { value: 'Unsaved prose' } })
  fireEvent.change(toneInput(), { target: { value: 'Concise' } }); fireEvent.blur(toneInput())
  await waitFor(() => expect(tone).toHaveBeenCalledOnce())
  await screen.findByText('Unsaved changes')
  save.mockRejectedValueOnce(new Error('Network unavailable'))
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
  await screen.findByText('Save failed · Unsaved changes')
  expect(screen.getByText('Network unavailable')).toBeTruthy()
  expect((screen.getByRole('textbox', { name: 'Patient Education' }) as HTMLTextAreaElement).value).toBe('Unsaved prose')
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
  await screen.findByText('Saved')
})
it.each(['initial_visit', 'pain_evaluation_visit', 'discharge'])('distinguishes %s finalization failure after a successful save', async family => {
  mount(family); finalize.mockResolvedValue({ error: 'Signing failed' })
  const name = family === 'discharge' ? 'Finalize discharge & end episode' : 'Finalize'
  fireEvent.click(screen.getByRole('button', { name }))
  expect(save).not.toHaveBeenCalled()
  expect(within(screen.getByRole('alertdialog')).getByText('2026-09-10')).toBeTruthy()
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name }))
  await screen.findByText('Saved; finalization failed')
  expect(screen.getByText('Signing failed')).toBeTruthy()
})
it.each(['initial_visit', 'pain_evaluation_visit', 'discharge'])('jumps to the correct %s field and preserves draft values', family => {
  mount(family)
  const scroll = vi.fn()
  HTMLElement.prototype.scrollIntoView = scroll
  fireEvent.change(screen.getByRole('textbox', { name: 'Patient Education' }), { target: { value: 'Local prose' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Jump to section' }), { target: { value: 'patient_education' } })
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Patient Education' }))
  expect(scroll).toHaveBeenCalledOnce()
  expect(save).not.toHaveBeenCalled()
  expect((document.activeElement as HTMLTextAreaElement).value).toBe('Local prose')
})
it('hides section navigation while intake is selected', async () => {
  mount('initial_visit')
  await userEvent.click(screen.getByRole('tab', { name: 'Vital Signs' }))
  expect(screen.queryByRole('combobox', { name: 'Jump to section' })).toBeNull()
})

it.each(['reported', 'rejected'])('preserves a discharge correction after %s save failure', async kind => {
  mount('discharge', true)
  if (kind === 'reported') correctionSave.mockResolvedValueOnce({ error: 'Correction save failed' })
  else correctionSave.mockRejectedValueOnce(new Error('Offline'))
  fireEvent.change(screen.getByRole('textbox', { name: 'Patient Education' }), { target: { value: 'Corrected prose' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Correction' }))
  await screen.findByText('Save failed · Unsaved changes')
  expect((screen.getByRole('textbox', { name: 'Patient Education' }) as HTMLTextAreaElement).value).toBe('Corrected prose')
  correctionSave.mockResolvedValueOnce({ data: {} })
  fireEvent.click(screen.getByRole('button', { name: 'Save Correction' }))
  await screen.findByText('Saved')
  expect(correctionFinalize).not.toHaveBeenCalled()
})
it('reviews correction consequences and distinguishes replacement signing failure', async () => {
  mount('discharge', true)
  correctionSave.mockResolvedValue({ data: {} }); correctionFinalize.mockResolvedValue({ error: 'Replacement failed' })
  fireEvent.click(screen.getByRole('button', { name: 'Finalize Corrected Discharge' }))
  const dialog = within(screen.getByRole('alertdialog'))
  expect(dialog.getByText(/Care and episode status will not change/)).toBeTruthy()
  expect(correctionSave).not.toHaveBeenCalled()
  fireEvent.click(dialog.getByRole('button', { name: 'Finalize Corrected Discharge' }))
  await screen.findByText('Saved; finalization failed')
  expect(correctionSave).toHaveBeenCalledOnce(); expect(correctionFinalize).toHaveBeenCalledOnce()
})

it.each([null, { decision: 'accepted' }])('does not suggest acceptance for a correction with absent or invalid historical evidence: %j', savedDecision => {
  mount('discharge', true, savedDecision)
  fireEvent.click(screen.getByRole('button', { name: 'Finalize Corrected Discharge' }))
  const dialog = within(screen.getByRole('alertdialog'))
  expect(dialog.getByText('Not documented')).toBeTruthy()
  expect(dialog.queryByText('Accepted')).toBeNull()
  expect(correctionSave).not.toHaveBeenCalled()
  fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
  expect(correctionFinalize).not.toHaveBeenCalled()
})
