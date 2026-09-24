// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { initialVisitSections } from '@/lib/validations/initial-visit-note'
import { dischargeNoteSections } from '@/lib/validations/discharge-note'
import { visitDecisionClosing } from '@/lib/validations/visit-treatment-decision'
const { regenerate, save, tone, finalize, error } = vi.hoisted(() => ({ regenerate: vi.fn(), save: vi.fn(), tone: vi.fn(), finalize: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error } }))
vi.mock('@/components/patients/case-status-context', () => ({ useCaseStatus: () => 'active' }))
vi.mock('@/components/clinical/clinical-reset-dialog', () => ({ ClinicalResetDialog: () => null }))
vi.mock('@/components/clinical/generating-progress', () => ({ GeneratingProgress: () => null }))
vi.mock('@/components/discharge/pain-timeline-table', () => ({ PainTimelineTable: () => null }))
vi.mock('@/actions/documents', () => ({ getDocumentDownloadUrl: vi.fn() }))
vi.mock('@/actions/initial-visit-notes', () => ({ regenerateNoteSection: regenerate, saveInitialVisitNote: save, saveInitialVisitNoteToneHint: tone, finalizeInitialVisitNote: finalize }))
vi.mock('@/actions/discharge-notes', () => ({ regenerateDischargeNoteSectionAction: regenerate, saveDischargeNote: save, getDischargePainTimeline: async () => ({ data: null }), saveDischargeNoteToneHint: tone, finalizeDischargeNote: finalize }))
import { InitialVisitEditor } from '../initial-visit-editor'
import { DischargeNoteEditor } from '@/components/discharge/discharge-note-editor'
const decision = { schema_version: 1, decision: 'declined', details: null, reviewed_plan: 'Old plan', reviewed_plan_hash: 'hash', visit_date: '2026-09-10', confirmed_by: '11111111-1111-4111-8111-111111111111', confirmed_at: '2026-09-10' }
const closing = visitDecisionClosing({ decision: 'declined', details: null })
function mount(family: string) {
  const note = { ...Object.fromEntries([...initialVisitSections, ...dischargeNoteSections].map(key => [key, 'Saved narrative'])), id: 'note', status: 'draft', updated_at: 'v1', tone_hint: null, pain_score_max: 5, visit_date: '2026-09-10', treatment_plan: 'Old plan', plan_and_recommendations: 'Old plan', patient_education: `Saved education. ${closing}`, visit_treatment_decision: decision }
  const common = { caseId: 'case', episodeId: 'episode', note, canGenerate: true, clinicSettings: null, providerProfile: null, clinicLogoUrl: null, providerSignatureUrl: null, caseData: null, documentFilePath: null, defaultVitals: null, correctionContext: null, isStale: false, earliestDate: null }
  if (family === 'discharge') render(<DischargeNoteEditor {...common as unknown as ComponentProps<typeof DischargeNoteEditor>} />)
  else render(<InitialVisitEditor {...{ ...common, notesByVisitType: { [family]: note }, intakesByVisitType: {}, documentFilePathByVisitType: {}, defaultVisitType: family, initialVitals: null, siblingDatesByVisitType: {}, painEvalMissingPriorVitals: false } as unknown as ComponentProps<typeof InitialVisitEditor>} />)
  save.mockImplementation(async (...args: unknown[]) => ({ data: { savedNote: { ...note, ...(family === 'discharge' ? args.at(-1) : args[2]) as object, updated_at: 'v3' } } }))
  return note
}

function deferredTone() {
  let resolve!: (result: { data?: { updated_at: string; tone_hint: string | null }; error?: string }) => void
  const promise = new Promise<Parameters<typeof resolve>[0]>((done) => { resolve = done })
  tone.mockReturnValueOnce(promise)
  return resolve
}
function toneInput() { return screen.getByRole('textbox', { name: 'Tone & Direction (optional)' }) }
beforeEach(() => {
  vi.clearAllMocks()
  tone.mockResolvedValue({ data: { updated_at: 'v2', tone_hint: 'Concise' } })
  finalize.mockResolvedValue({ data: { success: true } })
})
afterEach(cleanup)

describe.each(['initial_visit', 'pain_evaluation_visit', 'discharge'])('%s save/finalize coordination', (family) => {
  it('keeps the direct blur-to-Save click and uses the tone response version', async () => {
    const user = userEvent.setup()
    mount(family)
    const resolveTone = deferredTone()
    await user.type(toneInput(), 'Concise')
    await user.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(tone).toHaveBeenCalledTimes(1))
    expect(save).not.toHaveBeenCalled()
    resolveTone({ data: { updated_at: 'v2', tone_hint: 'Concise' } })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect((family === 'discharge' ? tone.mock.calls[0].at(-1) : tone.mock.calls[0][3])).toEqual({ noteId: 'note', expectedUpdatedAt: 'v1' })
    expect((family === 'discharge' ? save.mock.calls[0].at(-1) : save.mock.calls[0][2]).expected_updated_at).toBe('v2')
    expect(tone).toHaveBeenCalledTimes(1)
    if (family !== 'discharge') {
      expect(tone.mock.calls[0].at(-1)).toBe('episode')
      expect(save.mock.calls[0].at(-1)).toBe('episode')
    }
  })

  it('waits for tone before saving and signing the saved version', async () => {
    const user = userEvent.setup()
    mount(family)
    const resolveTone = deferredTone()
    await user.type(toneInput(), 'Concise')
    await user.click(screen.getByRole('button', { name: 'Finalize' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Finalize' }))
    expect(save).not.toHaveBeenCalled()
    expect(finalize).not.toHaveBeenCalled()
    resolveTone({ data: { updated_at: 'v2', tone_hint: 'Concise' } })
    await waitFor(() => expect(finalize).toHaveBeenCalledTimes(1))
    expect((family === 'discharge' ? save.mock.calls[0].at(-1) : save.mock.calls[0][2]).expected_updated_at).toBe('v2')
    expect((family === 'discharge' ? finalize.mock.calls[0].at(-1) : finalize.mock.calls[0][2])).toBe('v3')
  })

  it('keeps unsaved prose and decision details after a tone-only save', async () => {
    mount(family)
    fireEvent.change(screen.getByRole('textbox', { name: 'Patient Education' }), { target: { value: 'Unsaved counseling' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'partially_accepted' } })
    fireEvent.change(screen.getByLabelText('Accepted treatments and limitations (required)'), { target: { value: 'Exercise only' } })
    fireEvent.change(toneInput(), { target: { value: 'Concise' } })
    fireEvent.blur(toneInput())
    await waitFor(() => expect(tone).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect((family === 'discharge' ? save.mock.calls[0].at(-1) : save.mock.calls[0][2])).toMatchObject({
      patient_education: 'Unsaved counseling',
      treatment_decision: { decision: 'partially_accepted', details: 'Exercise only' },
      expected_updated_at: 'v2',
    })
  })

  it('aborts the waiting Save after tone failure and only retries on another click', async () => {
    const user = userEvent.setup()
    mount(family)
    const resolveTone = deferredTone()
    await user.type(toneInput(), 'Concise')
    await user.click(screen.getByRole('button', { name: 'Save Draft' }))
    resolveTone({ error: 'Note changed. Reload before saving' })
    await waitFor(() => expect(error).toHaveBeenCalledWith('Note changed. Reload before saving'))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save Draft' }) as HTMLButtonElement).disabled).toBe(false))
    expect(save).not.toHaveBeenCalled()
    expect(finalize).not.toHaveBeenCalled()
    expect(tone).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(tone).toHaveBeenCalledTimes(2)
    expect((family === 'discharge' ? tone.mock.calls[1].at(-1) : tone.mock.calls[1][3]).expectedUpdatedAt).toBe('v1')
  })

  it('does not write an unchanged tone and chains consecutive draft saves', async () => {
    mount(family)
    fireEvent.focus(toneInput())
    fireEvent.blur(toneInput())
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save Draft' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(tone).not.toHaveBeenCalled()
    expect((family === 'discharge' ? save.mock.calls[1].at(-1) : save.mock.calls[1][2]).expected_updated_at).toBe('v3')
  })

  it('flushes tone before regeneration, then saves the regenerated version', async () => {
    const user = userEvent.setup()
    const note = mount(family)
    const resolveTone = deferredTone()
    regenerate.mockResolvedValue({ data: { content: 'New prognosis', savedNote: { ...note, prognosis: 'New prognosis', updated_at: 'v4' } } })
    await user.type(toneInput(), 'Concise')
    const field = screen.getByRole('textbox', { name: 'Prognosis' }).closest('[data-slot="form-item"]')!
    await user.click(within(field as HTMLElement).getByRole('button', { name: 'Regenerate' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Regenerate' }))
    expect(regenerate).not.toHaveBeenCalled()
    resolveTone({ data: { updated_at: 'v2', tone_hint: 'Concise' } })
    await waitFor(() => expect(regenerate).toHaveBeenCalledTimes(1))
    expect((family === 'discharge' ? regenerate.mock.calls[0].at(-1) : regenerate.mock.calls[0][4])).toBe('v2')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save Draft' }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect((family === 'discharge' ? save.mock.calls[0].at(-1) : save.mock.calls[0][2]).expected_updated_at).toBe('v4')
  })
})
