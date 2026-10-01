// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useFormContext } from 'react-hook-form'
const { create, push } = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/actions/patients', () => ({ createPatientCase: create }))
vi.mock('../wizard-step-identity', () => ({ WizardStepIdentity: ({ identityLocked }: { identityLocked: boolean }) => {
  const form = useFormContext(); return <><input aria-label="First" disabled={identityLocked} {...form.register('first_name')} /><input aria-label="Last" {...form.register('last_name')} /><input aria-label="DOB" {...form.register('date_of_birth')} /></>
} }))
vi.mock('../wizard-step-details', () => ({ WizardStepDetails: () => {
  const form = useFormContext(); return <><input aria-label="Attorney" {...form.register('attorney_id')} /><input aria-label="Provider" {...form.register('assigned_provider_id')} /></>
} }))
vi.mock('../wizard-step-review', () => ({ WizardStepReview: ({ goToStep, onReadinessChange, disabled }: { goToStep: (n: number) => void; onReadinessChange: (b: boolean) => void; disabled: boolean }) => {
  const form = useFormContext(); return <><button disabled={disabled} onClick={() => onReadinessChange(true)}>Resolve names</button><button disabled={disabled} onClick={() => goToStep(1)}>Edit details</button><button onClick={() => form.setValue('assigned_provider_id', '')}>Invalidate provider</button></>
} }))
import { PatientWizard } from '../patient-wizard'
const id = '11111111-1111-4111-8111-111111111111'
const existing = { id, first_name: 'Synthetic', last_name: 'Example', middle_name: null, date_of_birth: '1980-01-01', gender: null }
beforeEach(() => { vi.clearAllMocks(); create.mockResolvedValue({ data: { id: 'case', case_number: 'S-1' } }) })
afterEach(cleanup)
async function details() { fireEvent.click(screen.getByRole('button', { name: 'Next' })); await screen.findByLabelText('Attorney') }
async function review() {
  await details(); fireEvent.change(screen.getByLabelText('Attorney'), { target: { value: id } }); fireEvent.change(screen.getByLabelText('Provider'), { target: { value: id } })
  fireEvent.click(screen.getByRole('button', { name: 'Next' })); await screen.findByRole('button', { name: 'Resolve names' })
  expect((screen.getByRole('button', { name: 'Create Patient Case' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Resolve names' }))
}
it('validates provider on Next and focuses the required field', async () => {
  render(<PatientWizard existingPatient={existing} />); await details()
  fireEvent.change(screen.getByLabelText('Attorney'), { target: { value: id } })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Provider')))
  expect(screen.getByRole('heading', { name: 'Step 2 of 3 — Contact & Case Details' })).toBeTruthy()
  expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('Contact & Case Details')
})
it('freezes a pending existing-patient submission and remains terminal after success', async () => {
  let resolve!: (v: unknown) => void; create.mockReturnValueOnce(new Promise(done => { resolve = done }))
  render(<PatientWizard existingPatient={existing} />); expect((screen.getByLabelText('First') as HTMLInputElement).disabled).toBe(true); await review()
  const submit = screen.getByRole('button', { name: 'Create Patient Case' }); fireEvent.click(submit); fireEvent.click(submit)
  await waitFor(() => expect(create).toHaveBeenCalledOnce())
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'existing_patient', patient_id: id, assigned_provider_id: id, lien_on_file: false, case_status: 'intake' }))
  expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Edit details' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => resolve({ data: { id: 'case', case_number: 'S-1' } }))
  expect(push).toHaveBeenCalledWith('/patients/case'); fireEvent.click(submit); expect(create).toHaveBeenCalledOnce()
})
it.each(['reported', 'rejected'])('retains values after %s failure and permits explicit retry', async kind => {
  if (kind === 'reported') create.mockResolvedValueOnce({ error: 'Unable to create' }); else create.mockRejectedValueOnce(new Error('Unable to create'))
  render(<PatientWizard existingPatient={existing} />); await review()
  fireEvent.click(screen.getByRole('button', { name: 'Create Patient Case' })); await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Create Patient Case' })); await waitFor(() => expect(push).toHaveBeenCalledOnce())
  expect(create.mock.calls[0][0]).toEqual(create.mock.calls[1][0])
})
it('redirects a final invalid field to its mounted step with focus', async () => {
  render(<PatientWizard existingPatient={existing} />); await review()
  fireEvent.click(screen.getByRole('button', { name: 'Invalidate provider' })); fireEvent.click(screen.getByRole('button', { name: 'Create Patient Case' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Provider'))); expect(create).not.toHaveBeenCalled()
})
it('creates a new patient with entered identity', async () => {
  render(<PatientWizard />)
  for (const [label, value] of [['First', 'Synthetic'], ['Last', 'Example'], ['DOB', '1980-01-01']]) fireEvent.change(screen.getByLabelText(label), { target: { value } })
  await review(); fireEvent.click(screen.getByRole('button', { name: 'Create Patient Case' }))
  await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'new_patient', first_name: 'Synthetic' })))
})
