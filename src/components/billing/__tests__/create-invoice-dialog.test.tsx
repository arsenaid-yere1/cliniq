// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ComponentProps } from 'react'
vi.mock('@/actions/billing', () => ({ createInvoice: vi.fn(), updateInvoice: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { createInvoice, updateInvoice } from '@/actions/billing'
import { CreateInvoiceDialog } from '../create-invoice-dialog'

type Props = ComponentProps<typeof CreateInvoiceDialog>
const line = { service_date: '2026-09-01', cpt_code: '99213', description: 'Visit service', quantity: 1, unit_price: 100, total_price: 100 }
const sourceId = '550e8400-e29b-41d4-a716-446655440000'
const formData: Props['formData'] = {
  caseData: { id: 'case', accident_date: null, patient: null, attorney: null }, clinic: null, providerProfile: null,
  diagnoses: [{ icd10_code: 'M54.2', description: 'Neck pain' }], indication: 'Injury', dischargeDate: '2026-09-30',
  prePopulatedLineItems: [{ ...line, encounter_id: sourceId }],
  facilityLineItems: [{ ...line, description: 'Facility service', procedure_id: sourceId, unit_price: 200, total_price: 200 }],
  catalogItems: [{ id: 'catalog', cpt_code: '99214', description: 'Catalog service', default_price: 250, sort_order: 0 }],
}
const existing: NonNullable<Props['existingInvoice']> = {
  id: 'invoice', invoice_type: 'visit', invoice_date: '2026-09-30', claim_type: 'Personal Injury', indication: '',
  diagnoses_snapshot: formData.diagnoses, payee_name: 'Clinic', payee_address: '', notes: '',
  line_items: [{ ...line, id: sourceId, procedure_id: sourceId, encounter_id: null }],
}
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } })
const value = (name: string) => (screen.getByLabelText(name) as HTMLInputElement).value
const submit = () => fireEvent.submit(document.querySelector('form')!)
function mount(overrides: Partial<Props> = {}) {
  const close = vi.fn()
  function Harness({ data = formData, caseId = 'case', invoice = overrides.existingInvoice }: { data?: Props['formData']; caseId?: string; invoice?: Props['existingInvoice'] }) {
    const [open, setOpen] = useState(true)
    return <><button onClick={() => setOpen(true)}>Open form</button><CreateInvoiceDialog {...overrides} caseId={caseId} formData={data} existingInvoice={invoice} open={open} onOpenChange={v => { close(v); setOpen(v) }} /></>
  }
  const view = render(<Harness data={overrides.formData} />)
  return { ...view, close, Harness }
}
async function switchType(name: 'Medical Invoice' | 'Medical Facility Invoice') {
  fireEvent.click(screen.getByLabelText('Invoice Type'))
  const option = await screen.findByRole('option', { name })
  fireEvent.keyDown(option, { key: 'Enter' })
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})
beforeEach(() => {
  vi.mocked(createInvoice).mockReset().mockResolvedValue({ data: {} })
  vi.mocked(updateInvoice).mockReset().mockResolvedValue({ data: {} })
})
afterEach(() => { cleanup(); document.body.style.pointerEvents = '' })

it('shows ordered, item-numbered inline errors and focuses the first input', async () => {
  mount({ formData: { ...formData, prePopulatedLineItems: [{ ...line, service_date: '', cpt_code: '', description: '', quantity: 0, unit_price: -1, total_price: 0 }] } })
  submit()
  const summary = await screen.findByRole('alert')
  expect(document.activeElement).toBe(screen.getByLabelText('Item 1 Date'))
  expect(within(summary).getAllByRole('button').map(b => b.textContent)).toEqual([
    'Item 1 — Date: Service date is required', 'Item 1 — CPT: CPT code is required',
    'Item 1 — Description: Description is required', 'Item 1 — Quantity: Quantity must be at least 1',
    'Item 1 — Unit price: Unit price must be non-negative',
  ])
  for (const label of ['Date', 'CPT', 'Description', 'QTY', 'Unit Price']) {
    const input = screen.getByLabelText(`Item 1 ${label}`)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')!.split(' ').some(id => document.getElementById(id)?.textContent)).toBe(true)
  }
  await userEvent.click(within(summary).getByRole('button', { name: /Item 1 — CPT/ }))
  expect(document.activeElement).toBe(screen.getByLabelText('Item 1 CPT'))
  expect(createInvoice).not.toHaveBeenCalled()
})

it('focuses CPT when it is the first invalid field, then saves corrected values', async () => {
  mount({ formData: { ...formData, prePopulatedLineItems: [{ ...line, cpt_code: '', quantity: 1.5 }] } })
  submit(); await screen.findByRole('alert')
  expect(document.activeElement).toBe(screen.getByLabelText('Item 1 CPT'))
  change('Item 1 CPT', 'CUSTOM'); change('Item 1 QTY', '2')
  submit()
  await waitFor(() => expect(createInvoice).toHaveBeenCalledOnce())
  expect(vi.mocked(createInvoice).mock.calls[0][1].line_items[0]).toMatchObject({ cpt_code: 'CUSTOM', quantity: 2, total_price: 200 })
})

it('renumbers errors after moving and removing items', async () => {
  mount({ formData: { ...formData, prePopulatedLineItems: [line, { ...line, description: '' }] } })
  submit(); await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: /Item 2 — Description/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Move item 2 up' }))
  await waitFor(() => expect(screen.getByRole('button', { name: /Item 1 — Description/ })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Remove item 1' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

it.each(['returned', 'rejected', 'fields'] as const)('retains input after %s server failure and allows retry', async kind => {
  if (kind === 'returned') vi.mocked(createInvoice).mockResolvedValueOnce({ error: 'Service already billed' })
  if (kind === 'rejected') vi.mocked(createInvoice).mockRejectedValueOnce(new Error('offline'))
  if (kind === 'fields') vi.mocked(createInvoice).mockResolvedValueOnce({ error: { invoice_date: ['Invalid invoice date'], line_items: ['Conflicting service'] } })
  mount(); change('Notes', 'Keep these notes'); submit(); submit()
  const alert = await screen.findByRole('alert')
  await waitFor(() => expect(document.activeElement).toBe(alert))
  expect(createInvoice).toHaveBeenCalledOnce(); expect(value('Notes')).toBe('Keep these notes')
  if (kind === 'fields') {
    expect(screen.getByLabelText('Invoice Date').getAttribute('aria-invalid')).toBe('true')
    expect(within(alert).getByText('Items: Conflicting service')).toBeTruthy()
    expect(screen.getByLabelText('Item 1 Date').getAttribute('aria-invalid')).toBe('false')
  }
  change('Notes', 'Corrected notes')
  expect(screen.queryByRole('alert')).toBeNull()
  submit(); await waitFor(() => expect(createInvoice).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('focuses the summary for noneditable source validation errors', async () => {
  mount({ formData: { ...formData, prePopulatedLineItems: [{ ...line, encounter_id: 'invalid-source' }] } })
  submit(); const alert = await screen.findByRole('alert')
  await waitFor(() => expect(document.activeElement).toBe(alert))
  expect(createInvoice).not.toHaveBeenCalled()
})

it.each([[false, 'returned'], [true, 'returned'], [false, 'rejected'], [true, 'rejected'], [false, 'success'], [true, 'success']] as const)('freezes all controls during delayed save (edit=%s, outcome=%s)', async (editing, outcome) => {
  let resolve!: (value: { error: string } | { data: object }) => void
  let reject!: (error: Error) => void
  const action = editing ? updateInvoice : createInvoice
  vi.mocked(action).mockImplementationOnce(() => new Promise((r, j) => { resolve = r; reject = j }))
  const view = mount({ existingInvoice: editing ? existing : undefined })
  change('Item 1 CPT', ''); fireEvent.focus(screen.getByLabelText('Item 1 CPT'))
  fireEvent.click(await screen.findByRole('button', { name: /99214/ }))
  fireEvent.click(screen.getByLabelText('Item 1 CPT'))
  expect(screen.getByRole('button', { name: /99214/ })).toBeTruthy()
  submit(); submit()
  await waitFor(() => expect(action).toHaveBeenCalledOnce())
  const payload = structuredClone(vi.mocked(action).mock.calls[0].at(-1))
  expect(screen.queryByRole('button', { name: /99214/ })).toBeNull()
  const form = document.querySelector('form')!
  for (const control of form.querySelectorAll('input, textarea, button')) expect(control.matches(':disabled')).toBe(true)
  const user = userEvent.setup()
  for (const [label, text] of [['Notes', 'lost'], ['Item 1 QTY', '8'], ['Item 1 Unit Price', '99'], ['Item 1 Date', '2026-08-01'], ['Item 1 Description', 'lost']]) {
    await user.type(screen.getByLabelText(label), text)
  }
  for (const name of ['Add Line Item', 'Add Diagnosis', 'Remove item 1', 'Move item 1 up', 'Move item 1 down', 'Remove diagnosis 1', 'Cancel']) await user.click(screen.getByRole('button', { name }))
  await user.click(screen.getByLabelText('Invoice Type'))
  await user.keyboard('{Escape}')
  fireEvent.pointerDown(document.querySelector('[data-slot="dialog-overlay"]')!)
  expect(view.close).not.toHaveBeenCalled()
  expect(vi.mocked(action).mock.calls[0].at(-1)).toEqual(payload)
  expect(value('Item 1 Description')).toBe('Catalog service'); expect(value('Notes')).toBe('')
  await act(async () => {
    if (outcome === 'rejected') reject(new Error('Offline'))
    else resolve(outcome === 'success' ? { data: {} } : { error: 'Retry this save' })
  })
  if (outcome === 'success') {
    expect(view.close).toHaveBeenCalledExactlyOnceWith(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    return
  }
  await screen.findByRole('alert')
  expect(screen.getByLabelText('Notes').matches(':disabled')).toBe(false)
  expect(value('Item 1 Description')).toBe('Catalog service')
  submit(); await waitFor(() => expect(action).toHaveBeenCalledTimes(2))
  expect(vi.mocked(action).mock.calls[1].at(-1)).toEqual(payload)
  expect(view.close).toHaveBeenCalledExactlyOnceWith(false)
})

it('preserves both type drafts, order, totals, source IDs and shared fields', async () => {
  mount()
  change('Item 1 Description', 'Edited visit'); change('Item 1 QTY', '3'); change('Notes', 'Shared'); change('Make Check Payable To', 'New clinic')
  await switchType('Medical Facility Invoice')
  change('Item 1 Description', 'Edited facility')
  fireEvent.click(screen.getByRole('button', { name: 'Add Line Item' }))
  change('Item 2 Date', '2026-09-02'); change('Item 2 CPT', '99214'); await userEvent.keyboard('{Escape}'); change('Item 2 Description', 'Second'); change('Item 2 Unit Price', '50')
  fireEvent.click(screen.getByRole('button', { name: 'Move item 2 up' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add Line Item' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove item 3' }))
  await switchType('Medical Invoice')
  expect(value('Item 1 Description')).toBe('Edited visit'); expect(value('Item 1 QTY')).toBe('3')
  expect(screen.getByText('Total: $300.00')).toBeTruthy()
  await switchType('Medical Facility Invoice')
  expect(value('Item 1 Description')).toBe('Second'); expect(value('Item 2 Description')).toBe('Edited facility')
  expect(screen.getByText('Total: $250.00')).toBeTruthy()
  expect(value('Notes')).toBe('Shared'); expect(value('Make Check Payable To')).toBe('New clinic')
  expect(value('Invoice Date')).toBe('2026-09-30'); expect(value('Diagnosis 1 description')).toBe('Neck pain')
  submit(); await waitFor(() => expect(createInvoice).toHaveBeenCalledOnce())
  const saved = vi.mocked(createInvoice).mock.calls[0][1]
  expect(saved.invoice_type).toBe('facility'); expect(saved.line_items[1].procedure_id).toBe(sourceId)
  expect(saved.line_items.every(item => !item.id)).toBe(true)
})

it('keeps existing line IDs and lines on edit-mode type changes', async () => {
  mount({ existingInvoice: existing }); change('Item 1 Description', 'Edited existing')
  await switchType('Medical Facility Invoice'); expect(value('Item 1 Description')).toBe('Edited existing')
  submit(); await waitFor(() => expect(updateInvoice).toHaveBeenCalledOnce())
  expect(vi.mocked(updateInvoice).mock.calls[0][2].line_items[0]).toMatchObject({ id: sourceId, procedure_id: sourceId, description: 'Edited existing' })
})

it('preserves catalog values and encounter IDs in the visit snapshot', async () => {
  mount(); change('Item 1 CPT', '')
  fireEvent.focus(screen.getByLabelText('Item 1 CPT'))
  fireEvent.click(await screen.findByRole('button', { name: /99214/ }))
  await switchType('Medical Facility Invoice'); await switchType('Medical Invoice')
  expect(value('Item 1 Description')).toBe('Catalog service'); expect(screen.getByText('Total: $250.00')).toBeTruthy()
  submit(); await waitFor(() => expect(createInvoice).toHaveBeenCalledOnce())
  expect(vi.mocked(createInvoice).mock.calls[0][1].line_items[0]).toMatchObject({ encounter_id: sourceId, cpt_code: '99214', unit_price: 250 })
})

it('starts empty types with one fresh row and keeps open drafts across parent rerenders', async () => {
  const { rerender, Harness } = mount({ formData: { ...formData, prePopulatedLineItems: [], facilityLineItems: [] } })
  change('Item 1 Description', 'Local draft')
  rerender(<Harness data={{ ...formData }} />)
  expect(value('Item 1 Description')).toBe('Local draft')
  await switchType('Medical Facility Invoice'); expect(value('Item 1 Description')).toBe('')
  await switchType('Medical Invoice'); expect(value('Item 1 Description')).toBe('Local draft')
})

it('resets on cancel/reopen and successful create/reopen using fresh defaults', async () => {
  const { rerender, Harness } = mount()
  change('Notes', 'Discard'); change('Item 1 Description', 'Discard')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  rerender(<Harness data={{ ...formData, prePopulatedLineItems: [{ ...line, description: 'Fresh defaults' }] }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open form' }))
  expect(value('Notes')).toBe(''); expect(value('Item 1 Description')).toBe('Fresh defaults')
  submit(); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Open form' }))
  expect(value('Item 1 Description')).toBe('Fresh defaults'); expect(screen.queryByRole('alert')).toBeNull()
})

it('refreshes edit values on reopening or case/invoice identity changes', () => {
  const { rerender, Harness } = mount({ existingInvoice: existing })
  change('Notes', 'Draft')
  rerender(<Harness invoice={{ ...existing, notes: 'Server update' }} />)
  expect(value('Notes')).toBe('Draft')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); fireEvent.click(screen.getByRole('button', { name: 'Open form' }))
  expect(value('Notes')).toBe('Server update')
  rerender(<Harness invoice={{ ...existing, id: 'another', notes: 'Other invoice' }} />)
  expect(value('Notes')).toBe('Other invoice')
  rerender(<Harness caseId="other-case" invoice={null} />)
  expect(value('Notes')).toBe(''); expect(value('Item 1 Description')).toBe('Visit service')
})

it('does not replace edited lines on repeated same-type selection and revalidates a switched draft', async () => {
  mount(); change('Item 1 Description', '')
  await switchType('Medical Invoice'); expect(value('Item 1 Description')).toBe('')
  submit(); await screen.findByRole('alert')
  await switchType('Medical Facility Invoice')
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  await switchType('Medical Invoice')
  await waitFor(() => expect(screen.getByRole('button', { name: /Item 1 — Description/ })).toBeTruthy())
})
