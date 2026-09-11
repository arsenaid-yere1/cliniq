// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { initialVisitSections } from '@/lib/validations/initial-visit-note'
import { dischargeNoteSections } from '@/lib/validations/discharge-note'
import { visitDecisionClosing } from '@/lib/validations/visit-treatment-decision'
const { regenerate, save } = vi.hoisted(() => ({ regenerate: vi.fn(), save: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/patients/case-status-context', () => ({ useCaseStatus: () => 'active' }))
vi.mock('@/components/clinical/clinical-reset-dialog', () => ({ ClinicalResetDialog: () => null }))
vi.mock('@/components/clinical/generating-progress', () => ({ GeneratingProgress: () => null }))
vi.mock('@/components/discharge/pain-timeline-table', () => ({ PainTimelineTable: () => null }))
vi.mock('@/actions/documents', () => ({ getDocumentDownloadUrl: vi.fn() }))
vi.mock('@/actions/initial-visit-notes', () => ({ regenerateNoteSection: regenerate, saveInitialVisitNote: save, saveInitialVisitNoteToneHint: vi.fn() }))
vi.mock('@/actions/discharge-notes', () => ({ regenerateDischargeNoteSectionAction: regenerate, saveDischargeNote: save, getDischargePainTimeline: async () => ({ data: null }), saveDischargeNoteToneHint: vi.fn() }))
import { InitialVisitEditor } from '../initial-visit-editor'
import { DischargeNoteEditor } from '@/components/discharge/discharge-note-editor'
const decision = { schema_version: 1, decision: 'declined', details: null, reviewed_plan: 'Old plan', reviewed_plan_hash: 'hash', visit_date: '2026-09-10', confirmed_by: '11111111-1111-4111-8111-111111111111', confirmed_at: '2026-09-10' }
const closing = visitDecisionClosing({ decision: 'declined', details: null })
function mount(family: string) {
  const note = { ...Object.fromEntries([...initialVisitSections, ...dischargeNoteSections].map(key => [key, 'Saved narrative'])), id: 'note', status: 'draft', updated_at: 'v1', visit_date: '2026-09-10', treatment_plan: 'Old plan', plan_and_recommendations: 'Old plan', patient_education: `Saved education. ${closing}`, visit_treatment_decision: decision }
  const common = { caseId: 'case', episodeId: 'episode', note, canGenerate: true, clinicSettings: null, providerProfile: null, clinicLogoUrl: null, providerSignatureUrl: null, caseData: null, documentFilePath: null, defaultVitals: null, correctionContext: null, isStale: false, earliestDate: null }
  if (family === 'discharge') render(<DischargeNoteEditor {...common as unknown as ComponentProps<typeof DischargeNoteEditor>} />)
  else render(<InitialVisitEditor {...{ ...common, notesByVisitType: { [family]: note }, intakesByVisitType: {}, documentFilePathByVisitType: {}, defaultVisitType: family, initialVitals: null, siblingDatesByVisitType: {}, painEvalMissingPriorVitals: false } as unknown as ComponentProps<typeof InitialVisitEditor>} />)
  return note
}
async function regenerateSection(label: string) {
  const input = screen.getByRole('textbox', { name: label })
  const field = input.closest('[data-slot="form-item"]')!
  fireEvent.click(within(field as HTMLElement).getByRole('button', { name: 'Regenerate' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Regenerate' }))
  await waitFor(() => expect(regenerate).toHaveBeenCalled())
  await waitFor(() => expect((screen.getByRole('button', { name: 'Save Draft' }) as HTMLButtonElement).disabled).toBe(false))
}
beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue({ data: {} }) })
afterEach(cleanup)
describe.each(['initial_visit', 'pain_evaluation_visit', 'discharge'])('%s regeneration reconciliation', family => {
  it('retains unsaved education when another section regenerates and saves the new version', async () => {
    const note = mount(family)
    fireEvent.change(screen.getByRole('textbox', { name: 'Patient Education' }), { target: { value: 'Unsaved clinician counseling.' } })
    regenerate.mockResolvedValue({ data: { content: 'New prognosis', savedNote: { ...note, prognosis: 'New prognosis', updated_at: 'v2' } } })
    await regenerateSection('Prognosis')
    expect((screen.getByRole('textbox', { name: 'Patient Education' }) as HTMLTextAreaElement).value).toBe('Unsaved clinician counseling.')
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0].at(-1)).toMatchObject({ patient_education: 'Unsaved clinician counseling.', prognosis: 'New prognosis', expected_updated_at: 'v2' })
  })
  it('removes only the stale application closing when the plan regenerates', async () => {
    const note = mount(family)
    fireEvent.change(screen.getByRole('textbox', { name: 'Patient Education' }), { target: { value: `Unsaved counseling. ${closing}` } })
    const key = family === 'discharge' ? 'plan_and_recommendations' : 'treatment_plan'
    regenerate.mockResolvedValue({ data: { content: 'Changed plan', savedNote: { ...note, [key]: 'Changed plan', updated_at: 'v2', patient_education: 'Saved education.' } } })
    await regenerateSection(family === 'discharge' ? 'Plan and Discharge Recommendations' : 'Treatment Plan')
    expect((screen.getByRole('textbox', { name: 'Patient Education' }) as HTMLTextAreaElement).value).toBe('Unsaved counseling.')
    expect(screen.getByRole('combobox').getAttribute('value') ?? (screen.getByRole('combobox') as HTMLSelectElement).value).toBe('declined')
  })
  it('replaces education when education itself is explicitly regenerated', async () => {
    const note = mount(family)
    regenerate.mockResolvedValue({ data: { content: 'New education', savedNote: { ...note, updated_at: 'v2', patient_education: `New education ${closing}` } } })
    await regenerateSection('Patient Education')
    expect((screen.getByRole('textbox', { name: 'Patient Education' }) as HTMLTextAreaElement).value).toBe(`New education ${closing}`)
  })
})
