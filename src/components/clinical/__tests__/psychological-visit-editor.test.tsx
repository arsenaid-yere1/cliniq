// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { defaultProviderIntake } from '@/lib/validations/initial-visit-note'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/patients/case-status-context', () => ({ useCaseStatus: () => 'active' }))
vi.mock('@/components/clinical/clinical-reset-dialog', () => ({ ClinicalResetDialog: () => null }))
vi.mock('@/components/clinical/generating-progress', () => ({ GeneratingProgress: () => <p>Generating note...</p> }))
vi.mock('@/actions/documents', () => ({ getDocumentDownloadUrl: vi.fn() }))
vi.mock('@/actions/initial-visit-notes', () => ({
  generateInitialVisitNote: vi.fn(), saveProviderIntake: vi.fn(), saveInitialVisitVitals: vi.fn(),
  saveInitialVisitNote: vi.fn(), finalizeInitialVisitNote: vi.fn(), regenerateNoteSection: vi.fn(),
  acknowledgePsychologicalReview: vi.fn(), saveInitialVisitNoteToneHint: vi.fn(),
}))
import { generateInitialVisitNote, saveProviderIntake, saveInitialVisitVitals } from '@/actions/initial-visit-notes'
import { InitialVisitEditor } from '../initial-visit-editor'

function mount() {
  return render(<InitialVisitEditor caseId="case" notesByVisitType={{ initial_visit: null, pain_evaluation_visit: null }}
    intakesByVisitType={{ initial_visit: defaultProviderIntake, pain_evaluation_visit: null }}
    documentFilePathByVisitType={{ initial_visit: null, pain_evaluation_visit: null }} defaultVisitType="initial_visit"
    canGenerate initialVitals={null} clinicSettings={null} providerProfile={null} clinicLogoUrl={null}
    providerSignatureUrl={null} caseData={null} painEvalMissingPriorVitals={false}
    siblingDatesByVisitType={{ initial_visit: null, pain_evaluation_visit: null }} />)
}

describe('psychological intake in the visit editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(saveProviderIntake).mockResolvedValue({ data: { success: true } })
    vi.mocked(saveInitialVisitVitals).mockResolvedValue({ data: { success: true } })
    vi.mocked(generateInitialVisitNote).mockResolvedValue({ data: { id: 'note' } })
  })
  afterEach(cleanup)

  it('preserves psychological edits across intake and visit-type tabs without mixing encounters', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Open assessment' }))
    fireEvent.change(screen.getByLabelText('Symptoms discussed today'), { target: { value: 'reported' } })
    fireEvent.change(screen.getByLabelText('Patient description'), { target: { value: 'Synthetic symptom description' } })
    await user.click(screen.getByRole('tab', { name: 'Exam Findings' }))
    expect(screen.queryByRole('textbox', { name: 'Patient description' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Psychological Assessment' }))
    expect((screen.getByLabelText('Patient description') as HTMLTextAreaElement).value).toBe('Synthetic symptom description')
    await user.click(screen.getByRole('tab', { name: 'Pain Evaluation Visit' }))
    expect(screen.queryByRole('tab', { name: 'Psychological Assessment' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Initial Visit' }))
    expect((screen.getByLabelText('Patient description') as HTMLTextAreaElement).value).toBe('Synthetic symptom description')
  })

  it('saves dirty chief complaints and assessment before generating', async () => {
    const user = userEvent.setup()
    mount()
    fireEvent.change(screen.getByRole('textbox', { name: 'Body Region' }), { target: { value: 'Neck' } })
    await user.click(screen.getByRole('button', { name: 'Open assessment' }))
    fireEvent.change(screen.getByLabelText('Symptoms discussed today'), { target: { value: 'none_reported' } })
    await user.click(screen.getByRole('button', { name: /Save intake and generate Initial Visit Note/ }))
    await waitFor(() => expect(generateInitialVisitNote).toHaveBeenCalledTimes(1))
    expect(vi.mocked(saveProviderIntake).mock.calls.map(call => call[3]).sort()).toEqual(['chief_complaints', 'psychological_assessment'])
    expect(Math.max(...vi.mocked(saveProviderIntake).mock.invocationCallOrder)).toBeLessThan(vi.mocked(generateInitialVisitNote).mock.invocationCallOrder[0])
  })

  it('stops generation and returns to the assessment when a required field is missing', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Open assessment' }))
    fireEvent.change(screen.getByLabelText('Symptoms discussed today'), { target: { value: 'reported' } })
    await user.click(screen.getByRole('tab', { name: 'Chief Complaints' }))
    await user.click(screen.getByRole('button', { name: /Save intake and generate Initial Visit Note/ }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Psychological Assessment' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByText('Describe the reported symptoms.')).toBeTruthy()
    expect(generateInitialVisitNote).not.toHaveBeenCalled()
  })

  it('preserves dirty vitals across tabs and saves them before generation', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('tab', { name: 'Vital Signs' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Heart Rate' }), { target: { value: '72' } })
    await user.click(screen.getByRole('tab', { name: 'Chief Complaints' }))
    await user.click(screen.getByRole('button', { name: /Save intake and generate Initial Visit Note/ }))
    await waitFor(() => expect(generateInitialVisitNote).toHaveBeenCalled())
    expect(saveInitialVisitVitals).toHaveBeenCalledWith('case', 'initial_visit', expect.objectContaining({ heart_rate: 72 }))
  })
})
