// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { defaultProviderIntake, type ProviderIntakeValues } from '@/lib/validations/initial-visit-note'
import { IntakeDraftProvider, useIntakeDrafts } from '../intake-draft-context'
import { ExamFindingsCard } from '../exam-findings-card'
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/actions/initial-visit-notes', () => ({ saveProviderIntake: vi.fn() }))
import { saveProviderIntake } from '@/actions/initial-visit-notes'
function intake(...names: string[]): ProviderIntakeValues {
  return { ...structuredClone(defaultProviderIntake), exam_findings: { general_appearance: null, neurological_notes: null,
    regions: names.map(region => ({ region, palpation_findings: '', muscle_spasm: null, additional_findings: null })) } }
}
function Generate() { const { flush } = useIntakeDrafts(); const [result, setResult] = React.useState(''); return <><button onClick={async () => setResult(await flush() ? 'Generated' : 'Blocked')}>Generate</button><span>{result}</span></> }
import React from 'react'
function mount(data: ProviderIntakeValues | null = intake('Knee'), locked = false, visitType: 'initial_visit' | 'pain_evaluation_visit' = 'initial_visit') {
  return render(<IntakeDraftProvider><ExamFindingsCard caseId="case" visitType={visitType} initialIntake={data} isLocked={locked} /><Generate /></IntakeDraftProvider>)
}
const text = (name = 'Palpation Findings') => screen.getByRole('textbox', { name }) as HTMLTextAreaElement
const chip = (name: RegExp, label = 'Palpation Findings') => within(screen.getByRole('group', { name: `${label} examples` })).getByRole('button', { name })
async function tenderness(user: ReturnType<typeof userEvent.setup>, side = 'Left', site = 'knee') {
  await user.click(chip(/Localized tenderness/))
  await user.selectOptions(screen.getByLabelText('Side'), side)
  fireEvent.change(screen.getByLabelText('Examined location'), { target: { value: site } })
}
describe('ExamFindingsCard', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(saveProviderIntake).mockResolvedValue({ data: { success: true } }) })
  afterEach(cleanup)
  it.each(['initial_visit', 'pain_evaluation_visit'] as const)('populates and saves paragraphs directly in %s without replacing existing text', async visitType => {
    const user = userEvent.setup()
    const data = intake('Neck')
    data.exam_findings.regions[0].additional_findings = 'Existing movement observation'
    data.chief_complaints.complaints = [{ ...defaultProviderIntake.chief_complaints.complaints[0], body_region: 'Cervical', severity_min: 4, severity_max: 6 }]
    mount(data, false, visitType)
    await user.click(screen.getByRole('button', { name: 'Generate Example Findings' }))
    expect(text('General Appearance').value).toContain('Alert and oriented')
    expect(text('Neurological Notes').value).toBe('Upper-extremity motor and sensory examination grossly intact.')
    expect(text().value).toContain('Moderate tenderness')
    expect(text('Additional Findings').value).toBe('Existing movement observation')
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    expect(saveProviderIntake).not.toHaveBeenCalled()
    fireEvent.change(text(), { target: { value: 'Clinician edit' } })
    fireEvent.change(text('Neurological Notes'), { target: { value: 'Clinician neurological observation' } })
    await user.click(screen.getByRole('button', { name: 'Generate Example Findings' }))
    expect(text().value).toBe('Clinician edit')
    expect(text('Neurological Notes').value).toBe('Clinician neurological observation')
    expect(screen.getAllByRole('region')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Save Exam Findings' }))
    await waitFor(() => expect(saveProviderIntake).toHaveBeenCalledWith('case', visitType, expect.objectContaining({
      exam_findings: expect.objectContaining({ neurological_notes: 'Clinician neurological observation', regions: [expect.objectContaining({ palpation_findings: 'Clinician edit', muscle_spasm: null })] }),
    }), 'exam_findings'))
  })
  it('provides actionable feedback for missing complaints without dirtying fields', async () => {
    const user = userEvent.setup(); mount(null)
    await user.click(screen.getByRole('button', { name: 'Generate Example Findings' }))
    expect(screen.getByText('Add a body region in Chief Complaints first.')).toBeTruthy()
    expect(screen.getByText('Not saved yet')).toBeTruthy()
    expect(text('General Appearance').value).toBe('')
  })
  it('blocks population while locked', async () => {
    const user = userEvent.setup(); mount(intake(), true)
    const button = screen.getByRole('button', { name: 'Generate Example Findings' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await user.click(button)
    expect(text('General Appearance').value).toBe('')
  })
  it('adds missing regions only once and disables population during a pending save', async () => {
    const user = userEvent.setup()
    const data = intake()
    data.chief_complaints.complaints = [{ ...defaultProviderIntake.chief_complaints.complaints[0], body_region: 'Right shoulder', severity_min: 2, severity_max: 5 }]
    mount(data)
    await user.click(screen.getByRole('button', { name: 'Generate Example Findings' }))
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(text().value).toBe('Moderate tenderness over the right shoulder.')
    await user.click(screen.getByRole('button', { name: 'Generate Example Findings' }))
    expect(screen.getAllByRole('region')).toHaveLength(1)
    let finish!: (value: { error: string }) => void
    vi.mocked(saveProviderIntake).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await user.click(screen.getByRole('button', { name: 'Save Exam Findings' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Generate Example Findings' }) as HTMLButtonElement).disabled).toBe(true))
    finish({ error: 'Save failed; retry.' })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Save failed; retry.'))
    expect(text().value).toBe('Moderate tenderness over the right shoulder.')
  })
  it.each([[8, 3], [2, 11]])('rejects invalid pain ranges (%s, %s) before applying any text', async (min, max) => {
    const user = userEvent.setup()
    const data = intake()
    data.chief_complaints.complaints = [{ ...defaultProviderIntake.chief_complaints.complaints[0], body_region: 'Knee', severity_min: min, severity_max: max }]
    mount(data)
    await user.click(screen.getByRole('button', { name: 'Generate Example Findings' }))
    expect(screen.getByText(/Check Chief Complaints pain levels/)).toBeTruthy()
    expect(text('General Appearance').value).toBe('')
    expect(screen.queryByRole('region')).toBeNull()
    expect(screen.getByText('Saved')).toBeTruthy()
  })
  it('starts empty and adds a named region with no invented findings', async () => {
    const user = userEvent.setup(); mount(null)
    expect(text('General Appearance').value).toBe('')
    expect(text('Neurological Notes').value).toBe('')
    expect(screen.queryByRole('region')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add Exam Region' }))
    fireEvent.change(screen.getByLabelText('Region to examine'), { target: { value: 'Left knee' } })
    await user.click(screen.getByRole('button', { name: 'Add region' }))
    expect(text().value).toBe('')
    expect((screen.getByLabelText('Not assessed') as HTMLInputElement).checked).toBe(true)
    await waitFor(() => expect(document.activeElement).toBe(text()))
  })
  it('requires completion, previews without writing, cancels with Escape and inserts editable text', async () => {
    const user = userEvent.setup(); mount()
    await user.click(chip(/Localized tenderness/)); await user.click(screen.getByRole('button', { name: 'Insert finding' }))
    expect(text().value).toBe('')
    expect(screen.getAllByText('Complete this field before inserting.')).toHaveLength(2)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'Insert finding' })).toBeNull()
    expect(document.activeElement).toBe(chip(/Localized tenderness/))
    await tenderness(user)
    expect(screen.getByText('Tenderness at Left knee')).toBeTruthy()
    expect(text().value).toBe('')
    await user.click(screen.getByRole('button', { name: 'Insert finding' }))
    expect(text().value).toBe('Tenderness at Left knee')
    await user.click(screen.getByRole('button', { name: 'Undo' })); expect(text().value).toBe('')
  })
  it('requires Replace for a scoped contradiction and restores exact text with Undo', async () => {
    const user = userEvent.setup(); mount()
    const original = 'Custom\n  wording; No focal tenderness in Left knee; No focal tenderness in Right knee'
    fireEvent.change(text(), { target: { value: original } })
    await tenderness(user); await user.click(screen.getByRole('button', { name: 'Insert finding' }))
    expect(text().value).toBe(original)
    await user.click(screen.getByRole('button', { name: 'Replace' }))
    expect(text().value).toBe('Custom\n  wording; No focal tenderness in Right knee; Tenderness at Left knee')
    await user.click(screen.getByRole('button', { name: 'Undo' })); expect(text().value).toBe(original)
  })
  it('searches regional tests and requires result, side, and response', async () => {
    const user = userEvent.setup(); mount()
    const additional = text('Additional Findings').closest('[data-slot="form-item"]')!
    await user.click(within(additional as HTMLElement).getByRole('button', { name: /More examples/ }))
    fireEvent.change(screen.getByLabelText('Search additional findings examples'), { target: { value: 'Lachman' } })
    await user.click(screen.getByRole('button', { name: /Lachman/ }))
    await user.selectOptions(screen.getByLabelText('Side'), 'Right')
    await user.selectOptions(screen.getByLabelText('Result'), 'Negative')
    fireEvent.change(screen.getByLabelText('Observed response / location, or reason not performed'), { target: { value: 'firm endpoint' } })
    await user.click(screen.getByRole('button', { name: 'Insert finding' }))
    expect(text('Additional Findings').value).toBe('Lachman test, Right: Negative — firm endpoint')
  })
  it('does not infer examples for custom/composite regions and clears stale completion on rename', async () => {
    const user = userEvent.setup(); mount()
    await tenderness(user)
    fireEvent.change(screen.getByRole('combobox', { name: 'Region' }), { target: { value: 'Knee and ankle' } })
    expect(screen.queryByRole('button', { name: 'Insert finding' })).toBeNull()
    expect(screen.getAllByText('No specific examples for this region. You can enter your findings below.')).toHaveLength(2)
    await user.click(screen.getAllByRole('button', { name: 'Show general examples' })[0])
    expect(chip(/Localized tenderness/)).toBeTruthy()
    expect(text().value).toBe('')
  })
  it('keeps Undo when a chip toggle returns the form to its saved baseline', async () => {
    const user = userEvent.setup(); mount()
    const appearance = chip(/No acute distress/, 'General Appearance')
    await user.click(appearance); await user.click(appearance)
    expect(text('General Appearance').value).toBe('')
    expect(screen.getByText('Saved')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(text('General Appearance').value).toBe('No acute distress')
  })
  it.each(['initial_visit', 'pain_evaluation_visit'] as const)('saves only the exam section for %s, preserving nullable states', async visitType => {
    const user = userEvent.setup(); mount(intake('Knee'), false, visitType)
    await user.click(screen.getByLabelText('Absent'))
    await user.click(screen.getByRole('button', { name: 'Save Exam Findings' }))
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
    expect(saveProviderIntake).toHaveBeenCalledWith('case', visitType, expect.objectContaining({ exam_findings: {
      general_appearance: null, neurological_notes: null, regions: [{ region: 'Knee', palpation_findings: '', muscle_spasm: false, additional_findings: null }],
    } }), 'exam_findings')
  })
  it('retains edits on failed save, clears transient work, and supports retry', async () => {
    const user = userEvent.setup(); mount()
    vi.mocked(saveProviderIntake).mockResolvedValueOnce({ error: 'Retry this save.' })
    await user.click(chip(/No acute distress/, 'General Appearance'))
    await tenderness(user)
    await user.click(screen.getByRole('button', { name: 'Save Exam Findings' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Retry this save.'))
    expect(text('General Appearance').value).toBe('No acute distress')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Insert finding' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Retry Save Exam Findings' }))
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
  })
  it('clears completion even when saving the unchanged baseline', async () => {
    const user = userEvent.setup(); mount(); await tenderness(user)
    await user.click(screen.getByRole('button', { name: 'Save Exam Findings' }))
    await waitFor(() => expect(saveProviderIntake).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Insert finding' })).toBeNull()
    expect(text().value).toBe('')
  })
  it('preserves surviving row identity and local state after deletion', async () => {
    const user = userEvent.setup(); mount(intake('Neck', 'Knee'))
    expect(screen.getByRole('button', { name: 'Exam region 2 details' }).getAttribute('aria-expanded')).toBe('false')
    await user.click(screen.getByRole('button', { name: 'Exam region 2 details' }))
    const row = within(screen.getByRole('region', { name: 'Exam region 2' }))
    fireEvent.change(row.getByRole('textbox', { name: 'Palpation Findings' }), { target: { value: 'Custom knee' } })
    await user.click(row.getByRole('button', { name: /Localized tenderness/ }))
    await user.click(screen.getByRole('button', { name: 'Remove exam region 1' }))
    expect(text().value).toBe('Custom knee')
    expect(screen.getByRole('button', { name: 'Insert finding' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Exam region 1 details' }))
  })
  it('collapses saved later rows after reset and still opens subsequently added rows', async () => {
    const user = userEvent.setup(); mount(intake('Neck', 'Knee'))
    await user.click(screen.getByRole('button', { name: 'Save Exam Findings' }))
    await waitFor(() => expect(saveProviderIntake).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Exam region 2 details' }).getAttribute('aria-expanded')).toBe('false')
    await user.click(screen.getByRole('button', { name: 'Add Exam Region' }))
    fireEvent.change(screen.getByLabelText('Region to examine'), { target: { value: 'Elbow' } })
    await user.click(screen.getByRole('button', { name: 'Add region' }))
    expect(screen.getByRole('button', { name: 'Exam region 3 details' }).getAttribute('aria-expanded')).toBe('true')
  })
  it('blocks all mutations while locked but allows reading collapsed regions', async () => {
    const user = userEvent.setup(); mount(intake('Knee', 'Elbow'), true)
    expect(text().disabled).toBe(true)
    expect((chip(/Localized tenderness/) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByLabelText('Not assessed')[0].closest('fieldset')?.disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Exam region 2 details' }))
    expect(screen.getAllByRole('textbox', { name: 'Palpation Findings' })).toHaveLength(2)
    expect(saveProviderIntake).not.toHaveBeenCalled()
  })
  it('flushes dirty findings before generation and blocks generation after failed save', async () => {
    const user = userEvent.setup(); mount()
    fireEvent.change(text(), { target: { value: 'Observed tenderness' } })
    vi.mocked(saveProviderIntake).mockResolvedValueOnce({ error: 'Failed' })
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(screen.getByText('Blocked')).toBeTruthy())
    expect(text().value).toBe('Observed tenderness')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' }).closest('fieldset')?.disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(screen.getByText('Generated')).toBeTruthy())
    expect(saveProviderIntake).toHaveBeenCalledTimes(2)
  })
})
