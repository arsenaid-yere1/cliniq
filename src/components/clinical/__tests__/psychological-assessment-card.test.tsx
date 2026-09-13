// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntakeDraftProvider, useIntakeDrafts } from '../intake-draft-context'
import { PsychologicalAssessmentCard } from '../psychological-assessment-card'
import { defaultProviderIntake } from '@/lib/validations/initial-visit-note'

vi.mock('@/actions/initial-visit-notes', () => ({ saveProviderIntake: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { saveProviderIntake } from '@/actions/initial-visit-notes'

function GenerateProbe() {
  const { flush, dirty } = useIntakeDrafts()
  return <button onClick={() => void flush()}>{dirty ? 'Save intake and generate' : 'Generate'}</button>
}
function mount(locked = false) {
  return render(<IntakeDraftProvider><GenerateProbe /><PsychologicalAssessmentCard caseId="case" initialIntake={defaultProviderIntake} isLocked={locked} /></IntakeDraftProvider>)
}
describe('psychological assessment form', () => {
  beforeEach(() => { vi.mocked(saveProviderIntake).mockResolvedValue({ data: { success: true } }); vi.spyOn(window, 'confirm').mockReturnValue(true) })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })
  it('starts unassessed and reveals symptoms only when reported', () => {
    mount()
    expect((screen.getByLabelText('Symptoms discussed today') as HTMLSelectElement).value).toBe('not_assessed')
    expect(screen.queryByLabelText('Nightmares')).toBeNull()
    fireEvent.change(screen.getByLabelText('Symptoms discussed today'), { target: { value: 'reported' } })
    expect(screen.getByLabelText('Nightmares')).toBeTruthy()
    expect((screen.getByLabelText('Assessment status') as HTMLSelectElement).value).toBe('not_assessed')
  })
  it('saves selected symptoms through the section-specific action', async () => {
    mount()
    fireEvent.change(screen.getByLabelText('Symptoms discussed today'), { target: { value: 'reported' } })
    fireEvent.click(screen.getByLabelText('Nightmares'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Psychological Assessment' }))
    await waitFor(() => expect(saveProviderIntake).toHaveBeenCalledWith('case', 'initial_visit', expect.objectContaining({ psychological_assessment: expect.objectContaining({ symptoms: ['Nightmares'], assessment_status: 'not_assessed', confirmed_diagnoses: '' }) }), 'psychological_assessment'))
  })
  it('flushes dirty assessment before generation', async () => {
    mount()
    fireEvent.change(screen.getByLabelText('Symptoms discussed today'), { target: { value: 'none_reported' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Save intake and generate' }))
    await waitFor(() => expect(saveProviderIntake).toHaveBeenCalledTimes(1))
  })
  it('retains entered content and offers retry when saving fails', async () => {
    vi.mocked(saveProviderIntake).mockResolvedValueOnce({ error: 'Connection failed' })
    mount()
    fireEvent.change(screen.getByLabelText('Symptoms discussed today'), { target: { value: 'reported' } })
    fireEvent.click(screen.getByLabelText('Flashbacks'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Psychological Assessment' }))
    await screen.findByRole('button', { name: 'Retry save' })
    expect((screen.getByLabelText('Flashbacks') as HTMLInputElement).checked).toBe(true)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry save' }).matches(':disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    await waitFor(() => expect(saveProviderIntake).toHaveBeenCalledTimes(2))
  })
  it('clears conflicting symptom details only after confirmation', () => {
    mount()
    fireEvent.change(screen.getByLabelText('Symptoms discussed today'), { target: { value: 'reported' } })
    fireEvent.click(screen.getByLabelText('Nightmares'))
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    fireEvent.change(screen.getByLabelText('Symptoms discussed today'), { target: { value: 'none_reported' } })
    expect((screen.getByLabelText('Nightmares') as HTMLInputElement).checked).toBe(true)
    fireEvent.change(screen.getByLabelText('Symptoms discussed today'), { target: { value: 'none_reported' } })
    fireEvent.change(screen.getByLabelText('Symptoms discussed today'), { target: { value: 'reported' } })
    expect((screen.getByLabelText('Nightmares') as HTMLInputElement).checked).toBe(false)
  })
  it('keeps safety documentation available without reported symptoms', () => {
    mount()
    fireEvent.change(screen.getByLabelText('Symptoms discussed today'), { target: { value: 'none_reported' } })
    fireEvent.change(screen.getByLabelText('Safety assessment'), { target: { value: 'concerns' } })
    expect(screen.getByLabelText('Actions taken')).toBeTruthy()
    expect(screen.getByLabelText('Disposition and follow-up')).toBeTruthy()
  })
  it('renders finalized intake without a save action', () => {
    mount(true)
    expect(screen.queryByRole('button', { name: 'Save Psychological Assessment' })).toBeNull()
    expect(screen.getByLabelText('Symptoms discussed today').closest('fieldset')?.disabled).toBe(true)
  })
})
