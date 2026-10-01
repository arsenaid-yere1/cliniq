// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FormProvider, useForm } from 'react-hook-form'
import type { CreatePatientCaseValues } from '@/lib/validations/patient'
const { attorney, provider } = vi.hoisted(() => ({ attorney: vi.fn(), provider: vi.fn() }))
vi.mock('@/actions/attorneys', () => ({ getAttorney: attorney }))
vi.mock('@/actions/settings', () => ({ getProviderProfileById: provider }))
import { WizardStepReview } from '../wizard-step-review'
const ready = vi.fn()
function Harness() {
  const form = useForm<CreatePatientCaseValues>({ defaultValues: { first_name: 'Synthetic', attorney_id: 'a', assigned_provider_id: 'p', case_status: 'active', lien_on_file: false } })
  return <FormProvider {...form}><button onClick={() => form.setValue('assigned_provider_id', 'p2')}>Change provider</button><WizardStepReview goToStep={vi.fn()} onReadinessChange={ready} /></FormProvider>
}
beforeEach(() => { vi.clearAllMocks(); attorney.mockResolvedValue({ data: { last_name: 'Example', first_name: 'Attorney', firm_name: 'Firm' } }); provider.mockResolvedValue({ data: { display_name: 'Example Provider', credentials: 'MD' } }) })
afterEach(cleanup)
it('shows both identities, status and explicit false lien before becoming ready', async () => {
  render(<Harness />)
  await screen.findByText('Example Provider, MD')
  expect(screen.getByText('Example, Attorney — Firm')).toBeTruthy()
  expect(screen.getByText('Active')).toBeTruthy(); expect(screen.getByText('No')).toBeTruthy()
  await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true))
  expect(provider).toHaveBeenCalledExactlyOnceWith('p'); expect(attorney).toHaveBeenCalledExactlyOnceWith('a')
})
it.each(['reported', 'rejected'])('blocks readiness after %s lookup failure and retries explicitly', async kind => {
  if (kind === 'reported') provider.mockResolvedValueOnce({ error: 'Failed' })
  else provider.mockRejectedValueOnce(new Error('Failed'))
  render(<Harness />)
  fireEvent.click(await screen.findByRole('button', { name: 'Retry provider' }))
  await screen.findByText('Example Provider, MD')
  expect(provider).toHaveBeenCalledTimes(2); expect(ready).toHaveBeenLastCalledWith(true)
})
it('ignores an old lookup and immediately hides the old identity when selection changes', async () => {
  let resolve!: (value: unknown) => void
  provider.mockReturnValueOnce(new Promise(done => { resolve = done }))
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Change provider' }))
  await screen.findByText('Example Provider, MD')
  await act(async () => resolve({ data: { display_name: 'Stale Person' } }))
  expect(screen.queryByText('Stale Person')).toBeNull()
  expect(provider).toHaveBeenLastCalledWith('p2')
})
