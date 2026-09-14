// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { defaultProviderIntake, type ProviderIntakeValues } from '@/lib/validations/initial-visit-note'
import { IntakeDraftProvider } from '../intake-draft-context'
import { ChiefComplaintsCard } from '../chief-complaints-card'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/actions/initial-visit-notes', () => ({ saveProviderIntake: vi.fn() }))
import { saveProviderIntake } from '@/actions/initial-visit-notes'

function intake(...regions: string[]): ProviderIntakeValues {
  return { ...structuredClone(defaultProviderIntake), chief_complaints: {
    ...defaultProviderIntake.chief_complaints,
    complaints: regions.map(body_region => ({ ...defaultProviderIntake.chief_complaints.complaints[0], body_region })),
  } }
}
function mount(initialIntake: ProviderIntakeValues | null = intake('Neck'), locked = false) {
  return render(<IntakeDraftProvider><ChiefComplaintsCard caseId="case" visitType="initial_visit" initialIntake={initialIntake} isLocked={locked} /></IntakeDraftProvider>)
}
const factors = (label = 'Alleviating Factors') => screen.getByRole('textbox', { name: label }) as HTMLTextAreaElement
const examples = (label = 'Alleviating Factors') => within(screen.getByRole('group', { name: `${label} examples` }))
const radiates = (label = 'Pain Radiates To') => screen.getByRole('textbox', { name: label }) as HTMLTextAreaElement
const radiateExamples = (label = 'Pain Radiates To') => within(screen.getByRole('group', { name: `${label} examples` }))
const bodyRegion = () => screen.getByRole('combobox', { name: 'Body Region' }) as HTMLInputElement

describe('chief complaint hints', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(saveProviderIntake).mockResolvedValue({ data: { success: true } }) })
  afterEach(cleanup)

  it('shows examples without writing findings and changes aliases/side without touching prose', async () => {
    const user = userEvent.setup()
    mount()
    expect(factors().value).toBe('')
    expect(examples().getByRole('button', { name: 'Rest' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.change(factors(), { target: { value: 'Patient’s own wording\n  remains.' } })
    fireEvent.change(bodyRegion(), { target: { value: 'Lt. lumbar spine' } })
    expect(examples('Aggravating Factors').getByRole('button', { name: 'Bending' })).toBeTruthy()
    expect((screen.getByLabelText('Side') as HTMLSelectElement).value).toBe('left')
    await user.selectOptions(screen.getByLabelText('Side'), 'bilateral')
    expect((bodyRegion()).value).toBe('Bilateral lumbar spine')
    expect(factors().value).toBe('Patient’s own wording\n  remains.')
    fireEvent.change(bodyRegion(), { target: { value: 'Neck and shoulder' } })
    expect(screen.getAllByText('General examples')).toHaveLength(3)
    expect((screen.getByLabelText('Side') as HTMLSelectElement).disabled).toBe(true)
    expect(factors().value).toBe('Patient’s own wording\n  remains.')
  })

  it('toggles standalone examples and reflects manual edits without deleting custom text', async () => {
    const user = userEvent.setup()
    mount()
    fireEvent.change(factors(), { target: { value: 'rest did not help' } })
    await user.click(examples().getByRole('button', { name: 'Rest' }))
    expect(factors().value).toBe('rest did not help; Rest')
    await user.click(examples().getByRole('button', { name: 'Rest' }))
    expect(factors().value).toBe('rest did not help')
    fireEvent.change(factors(), { target: { value: 'Rest' } })
    expect(examples().getByRole('button', { name: 'Rest' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(factors(), { target: { value: 'Rest only sometimes' } })
    expect(examples().getByRole('button', { name: 'Rest' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('requires explicit replacement, allows Undo, and invalidates stale transient state', async () => {
    const user = userEvent.setup()
    mount()
    fireEvent.change(factors(), { target: { value: 'Custom\n notes' } })
    await user.click(examples().getByRole('button', { name: 'None reported' }))
    expect(factors().value).toBe('Custom\n notes')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(factors().value).toBe('Custom\n notes')
    await user.click(examples().getByRole('button', { name: 'Not assessed' }))
    await user.click(screen.getByRole('button', { name: 'Replace' }))
    expect(factors().value).toBe('Not assessed')
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(factors().value).toBe('Custom\n notes')
    await user.click(examples().getByRole('button', { name: 'Not assessed' }))
    fireEvent.change(factors(), { target: { value: 'Newer text' } })
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull()
    await user.click(examples().getByRole('button', { name: 'Not assessed' }))
    await user.click(screen.getByRole('button', { name: 'Replace' }))
    await user.click(examples().getByRole('button', { name: 'Rest' }))
    expect(factors().value).toBe('Rest')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('clears pending replacement and Undo on region change and save reset', async () => {
    const user = userEvent.setup()
    mount()
    fireEvent.change(factors(), { target: { value: 'Notes' } })
    await user.click(examples().getByRole('button', { name: 'Not assessed' }))
    fireEvent.change(bodyRegion(), { target: { value: 'Knee' } })
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull()
    await user.click(examples().getByRole('button', { name: 'Not assessed' }))
    await user.click(screen.getByRole('button', { name: 'Replace' }))
    await user.click(screen.getByRole('button', { name: 'Save Chief Complaints' }))
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(factors().value).toBe('Not assessed')
  })

  it('keeps disclosures independent and does not dirty the form for presentation changes', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Complaint 1 details' }))
    expect(screen.queryByRole('textbox', { name: 'Alleviating Factors' })).toBeNull()
    expect(screen.getByText('Saved')).toBeTruthy()
    expect(saveProviderIntake).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Complaint 1 details' }))
    expect(factors().value).toBe('')
  })

  it('shows region-mapped radiating destinations and supports more/less', async () => {
    const user = userEvent.setup()
    mount()
    fireEvent.change(bodyRegion(), { target: { value: 'Elbow' } })
    expect(radiateExamples().getByRole('button', { name: 'Forearm' })).toBeTruthy()
    expect(radiateExamples().queryByRole('button', { name: 'Wrist' })).toBeTruthy()
    if (radiateExamples().queryByRole('button', { name: 'More examples' })) {
      await user.click(radiateExamples().getByRole('button', { name: 'More examples' }))
      expect(radiateExamples().getByRole('button', { name: 'Fingers' })).toBeTruthy()
    }
  })

  it('uses explicit radiation statuses and keeps replacement state localized', async () => {
    const user = userEvent.setup()
    mount()
    fireEvent.change(radiates(), { target: { value: 'Patient wording only' } })
    await user.click(radiateExamples().getByRole('button', { name: 'No radiation' }))
    await user.click(within(screen.getByRole('group', { name: /replace pain radiates to/i })).getByRole('button', { name: 'Replace' }))
    expect(radiates().value).toBe('No radiation')
  })

  it('preserves row values/state on deletion and focuses new rows', async () => {
    const user = userEvent.setup()
    mount(intake('Neck', 'Knee'))
    const second = within(screen.getByRole('region', { name: 'Complaint 2' }))
    await user.click(second.getByRole('button', { name: 'Stairs' }))
    await user.click(screen.getByRole('button', { name: 'Remove complaint 1' }))
    expect((bodyRegion()).value).toBe('Knee')
    expect(factors('Aggravating Factors').value).toBe('Stairs')
    expect(examples('Aggravating Factors').getByRole('button', { name: 'Stairs' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Complaint 1 details' }))
    await user.click(screen.getByRole('button', { name: 'Add Complaint' }))
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('region', { name: 'Complaint 2' })).getByRole('combobox', { name: 'Body Region' })))
  })

  it('saves the original fields and selected strings, then reconstructs chips on reset', async () => {
    const user = userEvent.setup()
    const data = intake('Neck')
    Object.assign(data.chief_complaints.complaints[0], { pain_character: 'burning', severity_min: 2, severity_max: 7, is_persistent: false, radiates_to: 'Left arm' })
    mount(data)
    await user.click(examples().getByRole('button', { name: 'Rest' }))
    await user.click(screen.getByRole('button', { name: 'Save Chief Complaints' }))
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
    expect(saveProviderIntake).toHaveBeenCalledWith('case', 'initial_visit', expect.objectContaining({ chief_complaints: {
      ...data.chief_complaints, complaints: [{ ...data.chief_complaints.complaints[0], alleviating_factors: 'Rest' }],
    } }), 'chief_complaints')
    expect(examples().getByRole('button', { name: 'Rest' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('retains failed edits and permits retry; shows Not saved yet for new intake', async () => {
    const user = userEvent.setup()
    mount(null)
    expect(screen.getByText('Not saved yet')).toBeTruthy()
    vi.mocked(saveProviderIntake).mockResolvedValueOnce({ error: 'Please retry saving.' })
    await user.click(examples().getByRole('button', { name: 'Rest' }))
    await user.click(screen.getByRole('button', { name: 'Save Chief Complaints' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Please retry saving.'))
    expect(factors().value).toBe('Rest')
    await user.click(screen.getByRole('button', { name: 'Retry Save Chief Complaints' }))
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
  })

  it('disables all mutations when locked', async () => {
    const user = userEvent.setup()
    mount(intake('Neck', 'Knee'), true)
    for (const button of screen.getAllByRole('button').filter(button => !/details|More examples/.test(button.getAttribute('aria-label') ?? button.textContent ?? ''))) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
    await user.click(screen.getAllByRole('button', { name: 'Rest' })[0])
    expect(saveProviderIntake).not.toHaveBeenCalled()
    expect((screen.getAllByRole('textbox', { name: 'Alleviating Factors' })[0] as HTMLTextAreaElement).value).toBe('')
  })

  it('disables native and portaled controls while a save is pending', async () => {
    const user = userEvent.setup()
    let finish!: (value: { data: { success: boolean } }) => void
    vi.mocked(saveProviderIntake).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    mount()
    await user.click(examples().getByRole('button', { name: 'Rest' }))
    await user.click(screen.getByRole('button', { name: 'Save Chief Complaints' }))
    await waitFor(() => expect(screen.getByText('Saving…')).toBeTruthy())
    expect((screen.getByRole('combobox', { name: 'Pain Character' }) as HTMLButtonElement).disabled).toBe(true)
    expect((examples().getByRole('button', { name: 'Heat' }) as HTMLButtonElement).disabled).toBe(true)
    finish({ data: { success: true } })
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
  })
})
