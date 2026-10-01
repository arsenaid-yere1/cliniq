// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FormProvider, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createPatientCaseSchema, type CreatePatientCaseValues } from '@/lib/validations/patient'
vi.mock('@/components/providers/provider-select', async original => {
  const { ProviderSelect } = await original<typeof import('@/components/providers/provider-select')>()
  return { ProviderSelect: (props: React.ComponentProps<typeof ProviderSelect>) => <ProviderSelect {...props} initialProviders={[]} /> }
})
vi.mock('@/components/attorneys/attorney-select', async original => {
  const { AttorneySelect } = await original<typeof import('@/components/attorneys/attorney-select')>()
  return { AttorneySelect: (props: React.ComponentProps<typeof AttorneySelect>) => <AttorneySelect {...props} initialAttorneys={[]} /> }
})
vi.mock('@/actions/settings', () => ({ listProviderProfiles: vi.fn(), createProviderProfile: vi.fn() }))
vi.mock('@/actions/attorneys', () => ({ listAttorneys: vi.fn(), createAttorney: vi.fn() }))
vi.mock('@/components/attorneys/attorney-form', () => ({ AttorneyForm: () => null }))
import { WizardStepDetails } from '../wizard-step-details'
function Harness({ disabled = false }: { disabled?: boolean }) {
  const form = useForm<CreatePatientCaseValues>({ resolver: zodResolver(createPatientCaseSchema), mode: 'onBlur', defaultValues: { attorney_id: '', assigned_provider_id: '', lien_on_file: false } })
  return <FormProvider {...form}><WizardStepDetails goToStep={vi.fn()} disabled={disabled} /><button onClick={() => form.setFocus('assigned_provider_id')}>Focus provider</button><button onClick={() => form.setFocus('attorney_id')}>Focus attorney</button></FormProvider>
}
afterEach(cleanup)
it.each([['Assigned Provider', 'provider', 'Assigned provider is required'], ['Attorney', 'attorney', 'Attorney is required']])('associates %s trigger, blur error and forwarded ref', async (label, field, error) => {
  render(<Harness />)
  const trigger = screen.getByRole('combobox', { name: label })
  fireEvent.click(screen.getByRole('button', { name: `Focus ${field}` })); await waitFor(() => expect(document.activeElement).toBe(trigger))
  fireEvent.blur(trigger); await screen.findByText(error)
  await waitFor(() => expect(trigger.getAttribute('aria-invalid')).toBe('true'))
  expect(trigger.getAttribute('aria-describedby')?.split(' ').map(id => document.getElementById(id)?.textContent).join(' ')).toContain(error)
})
it('disables both portalled selectors and add-record controls', () => {
  render(<Harness disabled />)
  for (const label of ['Attorney', 'Assigned Provider']) expect((screen.getByRole('combobox', { name: label }) as HTMLButtonElement).disabled).toBe(true)
  for (const label of ['Add attorney', 'Add provider']) expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(true)
})
