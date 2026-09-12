// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tables } from '@/types/database'
import { buildIntakeHistory } from '@/lib/clinical/follow-up-intake-prefill'
const { save, status, refresh, error, loadHistory } = vi.hoisted(() => ({ save: vi.fn(), status: vi.fn(), refresh: vi.fn(), error: vi.fn(), loadHistory: vi.fn() }))
vi.mock('@/actions/follow-up-intake-history', () => ({ requestFollowUpIntakeHistory: loadHistory }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error } }))
vi.mock('@/actions/clinical-encounters', () => ({ updatePainFollowUpEncounter: save, changePainFollowUpStatus: status }))
import { TelehealthIntakeCard } from '../telehealth-intake-card'
import { CaseStatusProvider } from '@/components/patients/case-status-context'

const encounter = { id: 'current', case_id: 'case', episode_id: 'episode', status: 'in_progress', modality: 'telehealth', encounter_date: '2026-09-12', provider_intake: {}, patient_reported_measurements: {} } as Tables<'clinical_encounters'>
const data = buildIntakeHistory({ id: 'note', date: '2026-09-01', label: 'Follow-up visit', complaint: 'Knee pain', plan: 'Continue therapy', painMin: 0, painMax: 4 }, [], null)
const props = { caseId: 'case', encounter, history: { data } }
const input = (name: string) => screen.getByLabelText(name) as HTMLInputElement
const saveButton = () => screen.getByRole('button', { name: 'Save encounter intake' }) as HTMLButtonElement
const review = () => fireEvent.click(screen.getByLabelText('I reviewed the historical suggestions for this visit'))
beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue({ data: { id: 'current' } }); status.mockResolvedValue({ data: {} }) })
afterEach(cleanup)

describe('historical follow-up intake', () => {
  it('prefills dated text but never saves on mount or copies current findings or consent', () => {
    render(<TelehealthIntakeCard {...props} />)
    expect(input('Chief complaint').value).toBe(data.chiefComplaint)
    expect(input('Interval history').value).toBe(data.intervalHistory)
    for (const name of ['Patient-reported pain minimum', 'Patient-reported pain maximum', 'Review of systems', 'Video-observable findings', 'Patient location (state)', 'Provider location', 'Connection method']) expect(input(name).value).toBe('')
    expect(input('Telehealth consent obtained').checked).toBe(false)
    expect(screen.getByText(/Previous patient-reported pain/).textContent).toContain('minimum 0, maximum 4')
    expect(save).not.toHaveBeenCalled()
    expect(saveButton().disabled).toBe(true)
  })
  it('saves reviewed suggestions, dated provenance and explicit empty values', async () => {
    render(<TelehealthIntakeCard {...props} />)
    review()
    fireEvent.click(saveButton())
    await waitFor(() => expect(save).toHaveBeenCalledWith('case', expect.objectContaining({
      provider_intake: expect.objectContaining({ chief_complaint: data.chiefComplaint, review_of_systems: '', video_observations: '', history_prefill: { sources: data.sources, reviewed_at: expect.any(String), visit_date: '2026-09-12' } }),
      patient_reported_pain_min: null, patient_reported_pain_max: null, telehealth_consent_obtained: false,
    })))
  })
  it('preserves unsaved edits and intentional clearing across refreshes and requires renewed review', () => {
    const { rerender } = render(<TelehealthIntakeCard {...props} />)
    review()
    fireEvent.change(input('Chief complaint'), { target: { value: '' } })
    fireEvent.change(input('Interval history'), { target: { value: 'Clinician edited history' } })
    rerender(<TelehealthIntakeCard {...props} history={{ data: { ...data, chiefComplaint: 'New source' } }} encounter={{ ...encounter, updated_at: 'new' }} />)
    expect(input('Chief complaint').value).toBe('')
    expect(input('Interval history').value).toBe('Clinician edited history')
    expect(saveButton().disabled).toBe(true)
  })
  it('never repopulates a saved blank intake on reload', () => {
    render(<TelehealthIntakeCard {...props} encounter={{ ...encounter, provider_intake: { chief_complaint: '', interval_history: '', review_of_systems: '', video_observations: '' } }} />)
    expect(input('Chief complaint').value).toBe('')
    expect(input('Interval history').value).toBe('')
    expect(screen.queryByText('Historical sources')).toBeNull()
    expect(saveButton().disabled).toBe(false)
  })
  it('explicitly fills only empty fields, preserving saved findings and requiring review without saving', async () => {
    loadHistory.mockResolvedValue({ data: { ...data, chiefComplaint: 'The patient presents for follow-up.', intervalHistory: 'Previously reported improvement.' } })
    render(<TelehealthIntakeCard {...props} encounter={{ ...encounter, patient_reported_pain_min: 6, telehealth_consent_obtained: false, provider_intake: { chief_complaint: 'My existing complaint', interval_history: '', review_of_systems: 'Current findings' } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fill empty fields from history' }))
    await waitFor(() => expect(input('Interval history').value).toBe('Previously reported improvement.'))
    expect(loadHistory).toHaveBeenCalledWith('case', 'current', '2026-09-12')
    expect(input('Chief complaint').value).toBe('My existing complaint')
    expect(input('Review of systems').value).toBe('Current findings')
    expect(input('Patient-reported pain minimum').value).toBe('6')
    expect(input('Telehealth consent obtained').checked).toBe(false)
    expect(saveButton().disabled).toBe(true)
    expect(save).not.toHaveBeenCalled()
  })
  it('allows retry after an explicit history failure without losing input', async () => {
    loadHistory.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ data })
    render(<TelehealthIntakeCard {...props} encounter={{ ...encounter, provider_intake: { chief_complaint: '' } }} />)
    const fill = screen.getByRole('button', { name: 'Fill empty fields from history' })
    fireEvent.click(fill)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('try again'))
    expect(input('Chief complaint').value).toBe('')
    fireEvent.click(fill)
    await waitFor(() => expect(input('Chief complaint').value).toBe(data.chiefComplaint))
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('retains manual data and permits saving when history loading fails', async () => {
    render(<TelehealthIntakeCard {...props} history={{ data: null, error: 'History unavailable' }} />)
    fireEvent.change(input('Chief complaint'), { target: { value: 'Current concern' } })
    expect(screen.getByRole('status').textContent).toBe('History unavailable')
    fireEvent.click(saveButton())
    await waitFor(() => expect(save).toHaveBeenCalledWith('case', expect.objectContaining({ provider_intake: expect.objectContaining({ chief_complaint: 'Current concern' }) })))
  })
  it.each([false, true])('retains input after a save failure (throws=%s)', async (throws) => {
    if (throws) save.mockRejectedValue(new Error('Network failure'))
    else save.mockResolvedValue({ error: 'Save failed' })
    render(<TelehealthIntakeCard {...props} />)
    review()
    fireEvent.click(saveButton())
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(input('Chief complaint').value).toBe(data.chiefComplaint)
    expect(refresh).not.toHaveBeenCalled()
    expect(saveButton().disabled).toBe(false)
  })
  it('blocks nonhistorical sources after backdating and allows clearing without losing current findings', async () => {
    render(<TelehealthIntakeCard {...props} />)
    fireEvent.change(input('Review of systems'), { target: { value: 'Today reported symptoms' } })
    review()
    fireEvent.change(input('Scheduled date and time'), { target: { value: '2026-09-01T10:00' } })
    expect(saveButton().disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('not all before')
    expect(screen.queryByText(/Previous patient-reported pain/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear suggested complaint and history' }))
    expect(input('Review of systems').value).toBe('Today reported symptoms')
    expect(input('Chief complaint').value).toBe('')
    fireEvent.click(saveButton())
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][1].provider_intake.history_prefill).toBeUndefined()
  })
  it('keeps saved provenance across later edits and saves', async () => {
    render(<TelehealthIntakeCard {...props} encounter={{ ...encounter, provider_intake: { chief_complaint: 'Reviewed', history_prefill: { sources: data.sources, reviewed_at: 'earlier' } } }} />)
    fireEvent.change(input('Chief complaint'), { target: { value: 'Updated complaint' } })
    expect(saveButton().disabled).toBe(true)
    review()
    fireEvent.click(saveButton())
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][1].provider_intake.history_prefill.sources).toEqual(data.sources)
  })
  it.each(['completed', 'cancelled', 'no_show'])('does not prefill or edit a %s encounter', (status) => {
    render(<TelehealthIntakeCard {...props} encounter={{ ...encounter, status }} />)
    expect(input('Chief complaint').value).toBe('')
    expect(input('Chief complaint').disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save encounter intake' })).toBeNull()
  })
  it('displays scheduled wall time without changing the saved instant', async () => {
    const start = '2026-09-12T17:00:00.000Z'
    render(<TelehealthIntakeCard {...props} history={{ data: null }} encounter={{ ...encounter, scheduled_start: start }} />)
    const local = new Date(start)
    expect(input('Scheduled date and time').value).toBe(new Date(local.getTime() - local.getTimezoneOffset() * 60_000).toISOString().slice(0, 16))
    fireEvent.click(saveButton())
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][1].scheduled_start).toBe(start)
  })
  it('honors episode and case locks', () => {
    const { rerender } = render(<TelehealthIntakeCard {...props} episodeWritable={false} />)
    expect(input('Chief complaint').disabled).toBe(true)
    rerender(<CaseStatusProvider status="closed"><TelehealthIntakeCard {...props} /></CaseStatusProvider>)
    expect(input('Chief complaint').disabled).toBe(true)
  })
})
