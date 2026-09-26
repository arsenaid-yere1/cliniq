// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { defaultProviderIntake, initialVisitSections } from '@/lib/validations/initial-visit-note'
import type { ReturnIntakeSource } from '@/lib/clinical/load-return-intake'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/patients/case-status-context', () => ({ useCaseStatus: () => 'active' }))
vi.mock('@/components/clinical/clinical-reset-dialog', () => ({ ClinicalResetDialog: () => null }))
vi.mock('@/components/clinical/generating-progress', () => ({ GeneratingProgress: () => <p>Generating note...</p> }))
vi.mock('@/actions/documents', () => ({ getDocumentDownloadUrl: vi.fn() }))
vi.mock('@/actions/clinical-orders', () => ({ getClinicalOrders: vi.fn(async () => ({ data: [] })) }))
vi.mock('@/actions/initial-visit-notes', () => ({
  generateInitialVisitNote: vi.fn(), saveProviderIntake: vi.fn(), saveInitialVisitVitals: vi.fn(),
  saveInitialVisitNote: vi.fn(), finalizeInitialVisitNote: vi.fn(), regenerateNoteSection: vi.fn(),
  acknowledgePsychologicalReview: vi.fn(), saveInitialVisitNoteToneHint: vi.fn(),
}))
import { generateInitialVisitNote, saveProviderIntake, saveInitialVisitVitals } from '@/actions/initial-visit-notes'
import { InitialVisitEditor } from '../initial-visit-editor'

const carryover: ReturnIntakeSource[] = ['accident_details', 'past_medical_history', 'social_history'].map(section => ({
  section: section as ReturnIntakeSource['section'], episodeNumber: 1, visitDate: '2026-07-14',
}))
const intake = {
  ...structuredClone(defaultProviderIntake),
  accident_details: { ...defaultProviderIntake.accident_details, narrative: 'Prior collision details' },
  past_medical_history: { ...defaultProviderIntake.past_medical_history, medical_conditions: 'Prior recorded history' },
  social_history: { ...defaultProviderIntake.social_history, occupation: 'Teacher' },
}

function mount(overrides: Partial<ComponentProps<typeof InitialVisitEditor>> = {}) {
  return render(<InitialVisitEditor caseId="case" episodeId="return-episode" episodeNumber={2} painEvaluationOnly
    intakeCarryover={carryover} notesByVisitType={{ initial_visit: null, pain_evaluation_visit: null }}
    intakesByVisitType={{ initial_visit: null, pain_evaluation_visit: intake }}
    documentFilePathByVisitType={{ initial_visit: null, pain_evaluation_visit: null }} defaultVisitType="pain_evaluation_visit"
    canGenerate initialVitals={null} clinicSettings={null} providerProfile={null} clinicLogoUrl={null}
    providerSignatureUrl={null} caseData={null} painEvalMissingPriorVitals={false}
    siblingDatesByVisitType={{ initial_visit: null, pain_evaluation_visit: null }} {...overrides} />)
}

describe('return evaluation intake carryover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(saveProviderIntake).mockResolvedValue({ data: { success: true } })
    vi.mocked(generateInitialVisitNote).mockResolvedValue({ data: { id: 'note' } })
  })
  afterEach(cleanup)

  it('shows sources and saves unchanged history before generation without saving current findings', async () => {
    const user = userEvent.setup()
    mount()
    expect(screen.getByText('Accident Details · Episode 1 · 07/14/2026')).toBeTruthy()
    expect(screen.getByText('Past Medical History · Episode 1 · 07/14/2026')).toBeTruthy()
    expect(screen.getByText('Social History · Episode 1 · 07/14/2026')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Body Region' }) as HTMLSelectElement).value).toBe('')
    await user.click(screen.getByRole('tab', { name: 'Exam Findings' }))
    expect((screen.getByRole('textbox', { name: 'General Appearance' }) as HTMLTextAreaElement).value).toBe('')
    await user.click(screen.getByRole('tab', { name: 'Vital Signs' }))
    expect((screen.getByRole('spinbutton', { name: 'Heart Rate' }) as HTMLInputElement).value).toBe('')
    expect(saveProviderIntake).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save intake and generate Pain Evaluation Visit Note' }))
    await waitFor(() => expect(generateInitialVisitNote).toHaveBeenCalledTimes(1))
    expect(vi.mocked(saveProviderIntake).mock.calls.map(call => [call[1], call[3], call[4]])).toEqual([
      ['pain_evaluation_visit', 'accident_details', 'return-episode'],
      ['pain_evaluation_visit', 'past_medical_history', 'return-episode'],
      ['pain_evaluation_visit', 'social_history', 'return-episode'],
    ])
    expect(vi.mocked(saveProviderIntake).mock.calls[0][2].accident_details.narrative).toBe('Prior collision details')
    expect(vi.mocked(saveProviderIntake).mock.calls[1][2].past_medical_history.medical_conditions).toBe('Prior recorded history')
    expect(vi.mocked(saveProviderIntake).mock.calls[2][2].social_history.occupation).toBe('Teacher')
    expect(Math.max(...vi.mocked(saveProviderIntake).mock.invocationCallOrder)).toBeLessThan(vi.mocked(generateInitialVisitNote).mock.invocationCallOrder[0])
    expect(saveInitialVisitVitals).not.toHaveBeenCalled()
  })

  it('saves clinician edits to the prefilled history', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('tab', { name: 'Social History' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Occupation' }), { target: { value: 'Retired teacher' } })
    await user.click(screen.getByRole('button', { name: 'Save intake and generate Pain Evaluation Visit Note' }))
    await waitFor(() => expect(generateInitialVisitNote).toHaveBeenCalledTimes(1))
    const saved = vi.mocked(saveProviderIntake).mock.calls.find(call => call[3] === 'social_history')
    expect(saved?.[2].social_history.occupation).toBe('Retired teacher')
  })

  it('retains pending history after a failed save and retries before generation', async () => {
    const user = userEvent.setup()
    mount()
    vi.mocked(saveProviderIntake).mockResolvedValueOnce({ error: 'Unable to save history' })
    await user.click(screen.getByRole('button', { name: 'Save intake and generate Pain Evaluation Visit Note' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Accident Details' }).getAttribute('aria-selected')).toBe('true'))
    expect(generateInitialVisitNote).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox', { name: 'Additional Narrative' }) as HTMLTextAreaElement).value).toBe('Prior collision details')
    await user.click(screen.getByRole('button', { name: 'Save intake and generate Pain Evaluation Visit Note' }))
    await waitFor(() => expect(generateInitialVisitNote).toHaveBeenCalledTimes(1))
    expect(saveProviderIntake).toHaveBeenCalledTimes(4)
  })

  it('clears pending status after an explicit unchanged section save', async () => {
    const user = userEvent.setup()
    mount({ intakeCarryover: [carryover[0]] })
    await user.click(screen.getByRole('tab', { name: 'Accident Details' }))
    await user.click(screen.getByRole('button', { name: 'Save Accident Details' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate Pain Evaluation Visit Note' })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'Generate Pain Evaluation Visit Note' }))
    await waitFor(() => expect(generateInitialVisitNote).toHaveBeenCalledTimes(1))
    expect(saveProviderIntake).toHaveBeenCalledTimes(1)
  })

  it('does not mark read-only episodes pending or expose a carryover notice', () => {
    mount({ episodeWritable: false })
    expect(screen.queryByText('History carried over from earlier care')).toBeNull()
    expect((screen.getByRole('button', { name: 'Generate Pain Evaluation Visit Note' }) as HTMLButtonElement).disabled).toBe(true)
    expect(saveProviderIntake).not.toHaveBeenCalled()
  })

  it('does not change generated draft contents or add a pending carryover', () => {
    const note = { ...Object.fromEntries(initialVisitSections.map(section => [section, 'Saved narrative'])),
      id: 'note', status: 'draft', updated_at: 'v1', visit_date: '2026-09-14', provider_intake: defaultProviderIntake }
    mount({ notesByVisitType: { initial_visit: null, pain_evaluation_visit: note } })
    expect(screen.queryByText('History carried over from earlier care')).toBeNull()
    expect((screen.getByRole('textbox', { name: 'History of the Accident' }) as HTMLTextAreaElement).value).toBe('Saved narrative')
    expect((screen.getByRole('button', { name: 'Finalize' }) as HTMLButtonElement).disabled).toBe(false)
    expect(saveProviderIntake).not.toHaveBeenCalled()
  })
})
