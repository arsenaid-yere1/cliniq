// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { defaultProviderIntake, initialVisitSections } from '@/lib/validations/initial-visit-note'
import type { ComponentProps } from 'react'

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
import { generateInitialVisitNote, saveProviderIntake, saveInitialVisitVitals, regenerateNoteSection } from '@/actions/initial-visit-notes'
import { InitialVisitEditor } from '../initial-visit-editor'

function mount(overrides: Partial<ComponentProps<typeof InitialVisitEditor>> = {}) {
  return render(<InitialVisitEditor caseId="case" notesByVisitType={{ initial_visit: null, pain_evaluation_visit: null }}
    intakesByVisitType={{ initial_visit: defaultProviderIntake, pain_evaluation_visit: null }}
    documentFilePathByVisitType={{ initial_visit: null, pain_evaluation_visit: null }} defaultVisitType="initial_visit"
    canGenerate initialVitals={null} clinicSettings={null} providerProfile={null} clinicLogoUrl={null}
    providerSignatureUrl={null} caseData={null} painEvalMissingPriorVitals={false}
    siblingDatesByVisitType={{ initial_visit: null, pain_evaluation_visit: null }} {...overrides} />)
}

describe('psychological intake in the visit editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(saveProviderIntake).mockResolvedValue({ data: { success: true } })
    vi.mocked(saveInitialVisitVitals).mockResolvedValue({ data: { success: true } })
    vi.mocked(generateInitialVisitNote).mockResolvedValue({ data: { id: 'note' } })
  })
  afterEach(cleanup)

  it('populates from the latest unsaved complaints independently for both visits and flushes before generation', async () => {
    const user = userEvent.setup(); mount()
    fireEvent.change(screen.getByRole('combobox', { name: 'Body Region' }), { target: { value: 'Neck' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Severity Max (0-10)' }), { target: { value: '2' } })
    // A second edit while already dirty must be read at click time.
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Severity Max (0-10)' }), { target: { value: '8' } })
    await user.click(screen.getByRole('tab', { name: 'Exam Findings' }))
    await user.click(screen.getByRole('button', { name: 'Generate Example Findings' }))
    expect((screen.getByRole('textbox', { name: 'Palpation Findings' }) as HTMLTextAreaElement).value).toContain('Marked tenderness over the cervical')
    expect(saveProviderIntake).not.toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: 'Pain Evaluation Visit' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Body Region' }), { target: { value: 'Left knee' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Severity Min (0-10)' }), { target: { value: '3' } })
    await user.click(screen.getByRole('tab', { name: 'Exam Findings' }))
    await user.click(screen.getByRole('button', { name: 'Generate Example Findings' }))
    expect((screen.getByRole('textbox', { name: 'Palpation Findings' }) as HTMLTextAreaElement).value).toBe('Mild tenderness over the left knee.')
    await user.click(screen.getByRole('tab', { name: 'Initial Visit' }))
    expect((screen.getByRole('textbox', { name: 'Palpation Findings' }) as HTMLTextAreaElement).value).toContain('Marked tenderness over the cervical')
    await user.click(screen.getByRole('button', { name: /Save intake and generate Initial Visit Note/ }))
    await waitFor(() => expect(generateInitialVisitNote).toHaveBeenCalledTimes(1))
    expect(vi.mocked(saveProviderIntake).mock.calls.map(call => [call[1], call[3]])).toEqual([
      ['initial_visit', 'chief_complaints'], ['initial_visit', 'exam_findings'],
    ])
    expect(Math.max(...vi.mocked(saveProviderIntake).mock.invocationCallOrder)).toBeLessThan(vi.mocked(generateInitialVisitNote).mock.invocationCallOrder[0])
  })

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
    fireEvent.change(screen.getByRole('combobox', { name: 'Body Region' }), { target: { value: 'Neck' } })
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

  it('keeps selected factors separate by complaint and encounter, and saves only this encounter before generation', async () => {
    const user = userEvent.setup()
    mount()
    fireEvent.change(screen.getByRole('combobox', { name: 'Body Region' }), { target: { value: 'Neck' } })
    await user.click(screen.getByRole('button', { name: 'Turning the head' }))
    await user.click(screen.getByRole('button', { name: 'Add Complaint' }))
    const second = within(screen.getByRole('region', { name: 'Complaint 2' }))
    fireEvent.change(second.getByRole('combobox', { name: 'Body Region' }), { target: { value: 'Knee' } })
    await user.click(second.getByRole('button', { name: 'Stairs' }))
    await user.click(screen.getByRole('tab', { name: 'Pain Evaluation Visit' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Body Region' }), { target: { value: 'Lower back' } })
    await user.click(screen.getByRole('button', { name: 'Bending' }))
    await user.click(screen.getByRole('tab', { name: 'Initial Visit' }))
    expect((screen.getAllByRole('textbox', { name: 'Aggravating Factors' }) as HTMLTextAreaElement[]).map(field => field.value)).toEqual(['Turning the head', 'Stairs'])
    await user.click(screen.getByRole('button', { name: /Save intake and generate Initial Visit Note/ }))
    await waitFor(() => expect(generateInitialVisitNote).toHaveBeenCalledTimes(1))
    expect(saveProviderIntake).toHaveBeenCalledTimes(1)
    const saved = vi.mocked(saveProviderIntake).mock.calls[0]
    expect(saved[1]).toBe('initial_visit')
    expect(saved[2].chief_complaints.complaints.map(row => [row.aggravating_factors, row.alleviating_factors])).toEqual([['Turning the head', ''], ['Stairs', '']])
    expect(vi.mocked(saveProviderIntake).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(generateInitialVisitNote).mock.invocationCallOrder[0])
  })

  it('retains factors and blocks generation when saving fails', async () => {
    const user = userEvent.setup()
    mount()
    vi.mocked(saveProviderIntake).mockResolvedValueOnce({ error: 'The note changed. Retry saving.' })
    await user.click(screen.getByRole('button', { name: 'Rest' }))
    await user.click(screen.getByRole('tab', { name: 'Exam Findings' }))
    await user.click(screen.getByRole('button', { name: /Save intake and generate Initial Visit Note/ }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Retry saving'))
    expect(generateInitialVisitNote).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox', { name: 'Alleviating Factors' }) as HTMLTextAreaElement).value).toBe('Rest')
  })

  it('retains generated-draft guards until changed factors are saved', async () => {
    const user = userEvent.setup()
    const note = { ...Object.fromEntries(initialVisitSections.map(section => [section, 'Saved narrative'])),
      id: 'note', status: 'draft', updated_at: 'v1', visit_date: '2026-09-14', tone_hint: null, provider_intake: defaultProviderIntake }
    mount({ notesByVisitType: { initial_visit: note, pain_evaluation_visit: null } })
    await user.click(screen.getByRole('tab', { name: 'Chief Complaints' }))
    await user.click(screen.getByRole('button', { name: 'Rest' }))
    expect((screen.getByRole('button', { name: 'Finalize' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('tab', { name: 'Note Sections' }))
    const field = screen.getByRole('textbox', { name: 'Chief Complaint' }).closest('[data-slot="form-item"]') as HTMLElement
    await user.click(within(field).getByRole('button', { name: 'Regenerate' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Regenerate' }))
    expect(regenerateNoteSection).not.toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: 'Chief Complaints' }))
    await user.click(screen.getByRole('button', { name: 'Save Chief Complaints' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Finalize' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByRole('button', { name: 'Rest' }).getAttribute('aria-pressed')).toBe('true')
  })

  it.each(['draft', 'finalized'])('does not introduce complaint editing in pain-evaluation %s notes', async status => {
    const note = { ...Object.fromEntries(initialVisitSections.map(section => [section, 'Saved narrative'])),
      id: 'note', status, updated_at: 'v1', visit_date: '2026-09-14', tone_hint: null, provider_intake: defaultProviderIntake }
    mount({ defaultVisitType: 'pain_evaluation_visit', notesByVisitType: { initial_visit: null, pain_evaluation_visit: note } })
    expect(screen.queryByRole('tab', { name: 'Chief Complaints' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Alleviating Factors' })).toBeNull()
    if (status === 'finalized') await waitFor(() => expect(screen.getByText('Finalized')).toBeTruthy())
  })

  it('keeps nullable exam intake and encounter drafts separate, then flushes the active exam', async () => {
    const user = userEvent.setup()
    const stored = { ...structuredClone(defaultProviderIntake), exam_findings: {
      general_appearance: 'Legacy appearance', neurological_notes: null,
      regions: [{ region: 'Left knee', palpation_findings: 'Existing finding', muscle_spasm: null, additional_findings: null }],
    } }
    mount({ intakesByVisitType: { initial_visit: stored, pain_evaluation_visit: null } })
    await user.click(screen.getByRole('tab', { name: 'Exam Findings' }))
    expect((screen.getByRole('textbox', { name: 'General Appearance' }) as HTMLTextAreaElement).value).toBe('Legacy appearance')
    expect((screen.getByLabelText('Not assessed') as HTMLInputElement).checked).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Palpation Findings' }), { target: { value: 'Initial visit observation' } })
    await user.click(screen.getByRole('tab', { name: 'Pain Evaluation Visit' }))
    await user.click(screen.getByRole('tab', { name: 'Exam Findings' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'General Appearance' }), { target: { value: 'Pain evaluation observation' } })
    await user.click(screen.getByRole('tab', { name: 'Initial Visit' }))
    expect((screen.getByRole('textbox', { name: 'Palpation Findings' }) as HTMLTextAreaElement).value).toBe('Initial visit observation')
    await user.click(screen.getByRole('button', { name: /Save intake and generate Initial Visit Note/ }))
    await waitFor(() => expect(generateInitialVisitNote).toHaveBeenCalledTimes(1))
    expect(saveProviderIntake).toHaveBeenCalledTimes(1)
    expect(vi.mocked(saveProviderIntake).mock.calls[0]).toEqual(['case', 'initial_visit', expect.objectContaining({ exam_findings: {
      ...stored.exam_findings, regions: [{ ...stored.exam_findings.regions[0], palpation_findings: 'Initial visit observation' }],
    } }), 'exam_findings'])
    expect(vi.mocked(saveProviderIntake).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(generateInitialVisitNote).mock.invocationCallOrder[0])
  })

  it('returns to Exam Findings on a failed flush and retains the exam', async () => {
    const user = userEvent.setup(); mount()
    await user.click(screen.getByRole('tab', { name: 'Exam Findings' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'General Appearance' }), { target: { value: 'Observed appearance' } })
    await user.click(screen.getByRole('tab', { name: 'Chief Complaints' }))
    vi.mocked(saveProviderIntake).mockResolvedValueOnce({ error: 'Exam save failed' })
    await user.click(screen.getByRole('button', { name: /Save intake and generate Initial Visit Note/ }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Exam Findings' }).getAttribute('aria-selected')).toBe('true'))
    expect((screen.getByRole('textbox', { name: 'General Appearance' }) as HTMLTextAreaElement).value).toBe('Observed appearance')
    expect(generateInitialVisitNote).not.toHaveBeenCalled()
  })

  it.each(['initial_visit', 'pain_evaluation_visit'] as const)('does not add exam intake to generated %s notes', visitType => {
    const note = { ...Object.fromEntries(initialVisitSections.map(section => [section, 'Saved narrative'])),
      id: 'note', status: 'draft', updated_at: 'v1', visit_date: '2026-09-14', provider_intake: defaultProviderIntake }
    mount({ defaultVisitType: visitType, notesByVisitType: { initial_visit: null, pain_evaluation_visit: null, [visitType]: note } })
    expect(screen.queryByRole('tab', { name: 'Exam Findings' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'General Appearance' })).toBeNull()
  })

  it('keeps finalized Initial Visit notes read-only', async () => {
    const note = { ...Object.fromEntries(initialVisitSections.map(section => [section, 'Saved narrative'])),
      id: 'note', status: 'finalized', updated_at: 'v1', visit_date: '2026-09-14', provider_intake: defaultProviderIntake }
    mount({ notesByVisitType: { initial_visit: note, pain_evaluation_visit: null } })
    await waitFor(() => expect(screen.getByText('Finalized')).toBeTruthy())
    expect(screen.queryByRole('tab', { name: 'Chief Complaints' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Alleviating Factors' })).toBeNull()
  })
})
